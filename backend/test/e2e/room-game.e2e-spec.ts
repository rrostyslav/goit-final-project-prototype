import type { GameId, PlayerId, RoomDto, WordGameView } from '@gp/shared'
import {
  type AppTestSocket,
  closeAllSockets,
  connect,
  createRoom,
  emit,
  expectNoEvent,
  findGameResults,
  type GuestSession,
  guest,
  joinRoom,
  setupTestEnvironment,
  startApp,
  stopApp,
  waitFor,
  waitForRoomStatus,
} from './helpers'

// ---------------------------------------------------------------------------
// End-to-end: auth -> REST room creation -> socket handshake -> gateway ->
// game runtime -> reducer -> per-player broadcast -> Postgres persistence,
// as one path, against the real backend (real Postgres, real Redis). See
// backend/test/e2e/helpers.ts for the database/Redis isolation strategy and
// backend/test/e2e/room-game.e2e-spec.ts's report entry in
// .superpowers/sdd/task-17-report.md for the full write-up.
// ---------------------------------------------------------------------------

const SETUP_TIMEOUT_MS = 60_000
const LIFECYCLE_TEST_TIMEOUT_MS = 45_000
const GAME_END_TIMEOUT_MS = 20_000
const LOBBY_RETURN_TIMEOUT_MS = 15_000

/**
 * Safety cap on the "play the whole game" turn loop in scenario 1. Alias's
 * default options (`totalRounds: 4, teamCount: 2` — see `AliasState`'s
 * `DEFAULT_OPTIONS` in `@gp/game-core`'s `alias.ts`, which is always what
 * `GameRuntimeService.doStart` uses since it never forwards per-room
 * options) always plays exactly `totalRounds * teamCount` = 8 turns for this
 * 4-player room. This cap is only a guard against a future regression
 * turning that into an infinite loop — not an expected turn count — so it is
 * set well above 8.
 */
const MAX_TURNS = 20

function asWordView(view: unknown, context: string): WordGameView {
  const candidate = view as { kind?: unknown } | null
  if (candidate?.kind !== 'word') {
    throw new Error(`expected a word-game view (${context}), got: ${JSON.stringify(view)}`)
  }
  return view as WordGameView
}

interface FourPlayerRoom {
  players: GuestSession[]
  room: RoomDto
  sockets: AppTestSocket[]
}

/** Four guests -> host creates a room -> the other three join over REST ->
 * everyone opens a socket and joins the room over the socket too. Mirrors
 * the task-17 brief's own scenario code (guest/createRoom/joinRoom/connect
 * REST+socket sequence), factored out since all three scenarios start here. */
async function setUpFourPlayerRoom(
  names: [string, string, string, string],
): Promise<FourPlayerRoom> {
  const players = await Promise.all(names.map((n) => guest(n)))
  const [host] = players
  if (!host) throw new Error('unreachable: names always has 4 entries')

  const room = await createRoom(host)
  for (const p of players.slice(1)) {
    await joinRoom(p, room.id)
  }

  const sockets = await Promise.all(players.map((p) => connect(p.accessToken)))
  for (const s of sockets) {
    await emit(s, 'room:join', { roomId: room.id })
  }

  return { players, room, sockets }
}

/**
 * Selects Alias and starts it, returning the `game:started` payload plus
 * every player's own initial `game:state`.
 *
 * IMPORTANT ordering: `GameRuntimeService.doStart` broadcasts `game:started`
 * and then every player's personalised `game:state` — both synchronously,
 * both BEFORE the `game:start` handler returns and its ack is sent. By the
 * time a bare `await emit(hostSocket, 'game:start', ...)` resolves, every
 * one of those events has already been sent over the wire; a `waitFor`
 * registered only after that ack would silently miss them (Socket.IO does
 * not replay past events to a listener added later). So every listener this
 * helper needs is registered BEFORE the `game:start` emit, not after.
 */
async function startAliasAndCollectInitialViews(
  sockets: AppTestSocket[],
  roomId: string,
): Promise<{ gameId: GameId; sessionId: string; views: WordGameView[] }> {
  const [hostSocket] = sockets
  if (!hostSocket) throw new Error('unreachable')

  await emit(hostSocket, 'room:select_game', { roomId, gameId: 'alias' })

  const started = waitFor(hostSocket, 'game:started')
  const statePromises = sockets.map((s) => waitFor(s, 'game:state'))
  await emit(hostSocket, 'game:start', { roomId })

  const startedPayload = await started
  const rawViews = await Promise.all(statePromises)
  const views = rawViews.map((v, i) => asWordView(v, `initial state for player ${i}`))
  return { gameId: startedPayload.gameId, sessionId: startedPayload.sessionId, views }
}

function findPlayerSocket(
  players: GuestSession[],
  sockets: AppTestSocket[],
  playerId: PlayerId,
): AppTestSocket {
  const index = players.findIndex((p) => p.user.id === playerId)
  const socket = index >= 0 ? sockets[index] : undefined
  if (!socket) throw new Error(`no connected socket for player ${playerId}`)
  return socket
}

describe('End-to-end: room -> Alias game -> results (real Postgres + Redis)', () => {
  beforeAll(async () => {
    await setupTestEnvironment()
    await startApp()
  }, SETUP_TIMEOUT_MS)

  afterEach(async () => {
    await closeAllSockets()
  })

  afterAll(async () => {
    await stopApp()
  }, SETUP_TIMEOUT_MS)

  it(
    'runs a full room lifecycle: create -> join -> start alias -> score -> finish',
    async () => {
      const { players, room, sockets } = await setUpFourPlayerRoom(['Host', 'P2', 'P3', 'P4'])
      const [hostSocket] = sockets
      if (!hostSocket) throw new Error('unreachable')

      const { gameId, views } = await startAliasAndCollectInitialViews(sockets, room.id)
      expect(gameId).toBe('alias')
      // Exactly one player is the explainer, and nobody sees a word yet —
      // the explainer has not called word/start_round to draw one.
      expect(views.filter((v) => v.secretWord !== null)).toHaveLength(0)

      const firstExplainerId = views[0]?.explainerId ?? null
      expect(firstExplainerId).not.toBeNull()
      if (!firstExplainerId) throw new Error('unreachable')

      let explainerSocket = findPlayerSocket(players, sockets, firstExplainerId)

      const afterStart = waitFor(explainerSocket, 'game:state')
      await emit(explainerSocket, 'game:action', {
        roomId: room.id,
        action: { type: 'word/start_round' },
      })
      const startedView = asWordView(await afterStart, 'after word/start_round')
      expect(startedView.phase).toBe('active')
      expect(startedView.secretWord).not.toBeNull()

      const afterCorrect = waitFor(explainerSocket, 'game:state')
      await emit(explainerSocket, 'game:action', {
        roomId: room.id,
        action: { type: 'word/correct' },
      })
      const scored = asWordView(await afterCorrect, 'after word/correct')
      expect(scored.teams.reduce((sum, t) => sum + t.score, 0)).toBe(1)

      // Play the rest of the game out (word games are turn-capped, not
      // clock-capped for this test — see MAX_TURNS's comment) so this
      // scenario can assert on `game:ended`, persisted `GameResult` rows,
      // and the room's return to `lobby`.
      const gameEnded = waitFor(hostSocket, 'game:ended', GAME_END_TIMEOUT_MS)
      let explainerId: PlayerId = firstExplainerId
      let finished = false

      for (let turn = 0; !finished; turn++) {
        if (turn >= MAX_TURNS) {
          throw new Error(`alias did not finish within ${MAX_TURNS} turns — possible reducer bug`)
        }

        const acting = findPlayerSocket(players, sockets, explainerId)
        const afterEnd = waitFor(hostSocket, 'game:state')
        await emit(acting, 'game:action', {
          roomId: room.id,
          action: { type: 'word/end_round' },
        })
        const view = asWordView(await afterEnd, `after word/end_round (turn ${turn})`)
        finished = view.phase === 'finished'

        if (!finished) {
          const nextExplainerId = view.explainerId
          if (!nextExplainerId) throw new Error('no explainer for the next turn')
          explainerId = nextExplainerId
          explainerSocket = findPlayerSocket(players, sockets, explainerId)

          const afterNextStart = waitFor(hostSocket, 'game:state')
          await emit(explainerSocket, 'game:action', {
            roomId: room.id,
            action: { type: 'word/start_round' },
          })
          await afterNextStart
        }
      }

      const ended = await gameEnded
      expect(ended.standings).toHaveLength(players.length)

      const results = await findGameResults(ended.sessionId)
      expect(results).toHaveLength(players.length)
      for (const player of players) {
        expect(results.some((r) => r.userId === player.user.id)).toBe(true)
      }

      const lobbyDto = await waitForRoomStatus(hostSocket, 'lobby', LOBBY_RETURN_TIMEOUT_MS)
      expect(lobbyDto.status).toBe('lobby')
    },
    LIFECYCLE_TEST_TIMEOUT_MS,
  )

  it('rejects a game action from a player whose turn it is not, without breaking the session', async () => {
    const { players, room, sockets } = await setUpFourPlayerRoom(['Host', 'P2', 'P3', 'P4'])
    const [hostSocket] = sockets
    if (!hostSocket) throw new Error('unreachable')

    const { views } = await startAliasAndCollectInitialViews(sockets, room.id)
    const explainerId = views[0]?.explainerId ?? null
    expect(explainerId).not.toBeNull()
    if (!explainerId) throw new Error('unreachable')

    const explainerIndex = players.findIndex((p) => p.user.id === explainerId)
    const impostorIndex = (explainerIndex + 1) % players.length
    const impostorSocket = sockets[impostorIndex]
    if (!impostorSocket) throw new Error('unreachable')
    const bystanderSockets = sockets.filter((_, i) => i !== impostorIndex)

    const errorPromise = waitFor(impostorSocket, 'error')
    const silencePromises = bystanderSockets.map((s) => expectNoEvent(s, 'game:state'))

    // Not the explainer, so this must be rejected — but per
    // RealtimeGateway.onGameAction's own doc comment, the ack still resolves
    // `{ ok: true }`; the rejection is a separate `error` event to the actor.
    await emit(impostorSocket, 'game:action', {
      roomId: room.id,
      action: { type: 'word/start_round' },
    })

    const err = await errorPromise
    expect(err.code).toBe('not_explainer')
    // No bystander — including the real explainer — saw a game:state update
    // for a turn that never actually started.
    await Promise.all(silencePromises)

    // The session must keep working afterwards: the real explainer's own
    // word/start_round succeeds and broadcasts normally.
    const explainerSocket = findPlayerSocket(players, sockets, explainerId)
    const afterStart = waitFor(hostSocket, 'game:state')
    await emit(explainerSocket, 'game:action', {
      roomId: room.id,
      action: { type: 'word/start_round' },
    })
    const view = asWordView(await afterStart, 'after the real explainer starts the round')
    expect(view.phase).toBe('active')
  })

  it('a reconnecting client receives the current room and game state', async () => {
    const { players, room, sockets } = await setUpFourPlayerRoom(['Host', 'P2', 'P3', 'P4'])
    const [hostSocket] = sockets
    if (!hostSocket) throw new Error('unreachable')

    const { views } = await startAliasAndCollectInitialViews(sockets, room.id)
    const explainerId = views[0]?.explainerId ?? null
    expect(explainerId).not.toBeNull()
    if (!explainerId) throw new Error('unreachable')

    const explainerIndex = players.findIndex((p) => p.user.id === explainerId)
    const explainerPlayer = players[explainerIndex]
    const explainerSocket = findPlayerSocket(players, sockets, explainerId)
    if (!explainerPlayer) throw new Error('unreachable')

    // Put the explainer mid-turn (started, clock running) before dropping
    // their connection: a disconnect only pauses anything the game is
    // actually waiting on (GameRuntimeService.pauseForDisconnect /
    // isWaitingOn), and only the current explainer of an active word-game
    // turn qualifies — this is what makes the reconnect below produce a
    // resumed `game:state` push, not a silent no-op.
    const afterStart = waitFor(explainerSocket, 'game:state')
    await emit(explainerSocket, 'game:action', {
      roomId: room.id,
      action: { type: 'word/start_round' },
    })
    await afterStart

    const bystanderIndex = (explainerIndex + 1) % players.length
    const bystanderSocket = sockets[bystanderIndex]
    if (!bystanderSocket) throw new Error('unreachable')

    // Wait for the server to fully process the drop (presence + game pause)
    // before reconnecting, so the reconnect below is not racing the
    // disconnect's own async cleanup.
    const disconnectedRoomState = waitFor(bystanderSocket, 'room:state')
    explainerSocket.disconnect()
    const roomAfterDisconnect = await disconnectedRoomState
    const disconnectedMember = roomAfterDisconnect.members.find(
      (m) => m.user.id === explainerPlayer.user.id,
    )
    expect(disconnectedMember?.connection).toBe('disconnected')

    // Reconnect: a brand new socket.io-client connection for the same user,
    // well within RECONNECT_GRACE_MS (45s) — no eviction should have run.
    const reconnectedSocket = await connect(explainerPlayer.accessToken)
    const ownGameState = waitFor(reconnectedSocket, 'game:state')
    const roomStateEvent = waitFor(reconnectedSocket, 'room:state')

    const ack = await emit(reconnectedSocket, 'room:join', { roomId: room.id })
    const memberFromAck = ack.members.find((m) => m.user.id === explainerPlayer.user.id)
    expect(memberFromAck?.connection).toBe('online')

    const roomStateAfterReconnect = await roomStateEvent
    const memberFromEvent = roomStateAfterReconnect.members.find(
      (m) => m.user.id === explainerPlayer.user.id,
    )
    expect(memberFromEvent?.connection).toBe('online')

    const resumedView = asWordView(await ownGameState, 'own state after reconnect')
    expect(resumedView.phase).toBe('active')
    expect(resumedView.roundPaused).toBe(false)
    // The reconnecting player is the explainer, so — unlike every other
    // player — they see the word again.
    expect(resumedView.secretWord).not.toBeNull()
  })
})
