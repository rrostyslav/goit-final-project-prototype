import type { GameId, RoomDto, RoomStatus, ServerToClientEvents, WordGameView } from '@gp/shared'
import { BadRequestException, ForbiddenException } from '@nestjs/common'
import type { GameResult } from '../src/database/models/game-result.model'
import type { GameSession } from '../src/database/models/game-session.model'
import { GameRuntimeService, MAX_ACTIONS_PER_SESSION } from '../src/games/game-runtime.service'
import type { GameTimerService } from '../src/games/game-timer.service'
import type { WordDeckService } from '../src/games/word-deck.service'
import type { RedisService } from '../src/redis/redis.service'
import type { RoomsService } from '../src/rooms/rooms.service'

// ---------------------------------------------------------------------------
// Fakes — minimal in-memory stand-ins, mirroring the style already used in
// rooms.service.spec.ts / friends.service.spec.ts: rows are plain mutable
// objects held by reference, so `.save()`/`.update()` can just mutate them.
// ---------------------------------------------------------------------------

interface FakeRoom {
  id: string
  hostId: string
  memberIds: string[]
  selectedGameId: GameId | null
  status: RoomStatus
}

function createFakeRoomsService(room: FakeRoom) {
  return {
    assertHost: jest.fn(async (_roomId: string, userId: string) => {
      if (userId !== room.hostId) {
        throw new ForbiddenException('Only the host can perform this action')
      }
    }),
    toDto: jest.fn(
      async (): Promise<RoomDto> => ({
        id: room.id,
        code: 'ABC123',
        visibility: 'public',
        status: room.status,
        hostId: room.hostId,
        maxPlayers: 10,
        selectedGameId: room.selectedGameId,
        members: room.memberIds.map((id) => ({
          user: { id, nickname: id, avatarUrl: null, isGuest: true },
          isHost: id === room.hostId,
          isReady: true,
          connection: 'online' as const,
          joinedAt: new Date(0).toISOString(),
        })),
        createdAt: new Date(0).toISOString(),
      }),
    ),
    setStatus: jest.fn(async (_roomId: string, status: RoomStatus) => {
      room.status = status
    }),
  }
}

interface FakeSessionRow {
  id: string
  roomId: string
  gameId: string
  state: Record<string, unknown>
  startedAt: Date
  endedAt: Date | null
}

function createFakeGameSessionModel() {
  const rows: FakeSessionRow[] = []
  let counter = 0
  return {
    rows,
    async create(attrs: { roomId: string; gameId: string; state: Record<string, unknown> }) {
      counter += 1
      const row: FakeSessionRow = {
        id: `session-${counter}`,
        roomId: attrs.roomId,
        gameId: attrs.gameId,
        state: attrs.state,
        startedAt: new Date(),
        endedAt: null,
      }
      rows.push(row)
      return row
    },
    async update(values: Partial<FakeSessionRow>, opts: { where: { id: string } }) {
      const row = rows.find((r) => r.id === opts.where.id)
      if (row) Object.assign(row, values)
      return [row ? 1 : 0]
    },
    async findByPk(id: string) {
      return rows.find((r) => r.id === id) ?? null
    },
  }
}

interface FakeResultRow {
  id: string
  sessionId: string
  userId: string
  score: number
  placement: number
}

function createFakeGameResultModel() {
  const rows: FakeResultRow[] = []
  let counter = 0
  return {
    rows,
    async create(attrs: { sessionId: string; userId: string; score: number; placement: number }) {
      counter += 1
      const row: FakeResultRow = { id: `result-${counter}`, ...attrs }
      rows.push(row)
      return row
    },
  }
}

function createFakeRedisClient() {
  const store = new Map<string, string>()
  return {
    store,
    async get(key: string): Promise<string | null> {
      return store.get(key) ?? null
    },
    async set(key: string, value: string): Promise<'OK'> {
      store.set(key, value)
      return 'OK'
    },
    async del(key: string): Promise<number> {
      return store.delete(key) ? 1 : 0
    },
  }
}

function createFakeRedisService() {
  return { client: createFakeRedisClient() }
}

function createFakeGameTimerService() {
  const clearAllCalls: string[] = []
  return {
    set: jest.fn(),
    clear: jest.fn(),
    clearAll: jest.fn((sessionId: string) => {
      clearAllCalls.push(sessionId)
    }),
    clearAllCalls,
  }
}

function createFakeWordDeckService(words: string[]) {
  return { loadDeck: jest.fn(async () => words) }
}

interface EmittedEntry {
  userId?: string
  event: string
  payload: unknown
}

function createStubGateway() {
  const emitted: EmittedEntry[] = []
  return {
    emitted,
    async emitToUser<E extends keyof ServerToClientEvents>(
      userId: string,
      event: E,
      payload: Parameters<ServerToClientEvents[E]>[0],
    ): Promise<void> {
      emitted.push({ userId, event, payload })
    },
    async broadcastRoomState(roomId: string): Promise<RoomDto> {
      emitted.push({ event: 'room:state', payload: { roomId } })
      return {
        id: roomId,
        code: 'ABC123',
        visibility: 'public',
        status: 'lobby',
        hostId: 'host',
        maxPlayers: 10,
        selectedGameId: null,
        members: [],
        createdAt: new Date(0).toISOString(),
      }
    },
  }
}

const WORDS = Array.from({ length: 50 }, (_, i) => `word-${i}`)

// `finish()` schedules a real `setTimeout` (the results -> lobby delay) —
// tracking every runtime created by a test here lets a single afterEach
// clear all of them via `onModuleDestroy`, so no test leaves a real 8s
// timer running past the test that created it (which is what was making
// Jest report "did not exit one second after the test run").
const createdRuntimes: GameRuntimeService[] = []
afterEach(() => {
  for (const runtime of createdRuntimes) {
    runtime.onModuleDestroy()
  }
  createdRuntimes.length = 0
})

function createRuntime(room: FakeRoom) {
  const fakeRoomsService = createFakeRoomsService(room)
  const gameSessionModel = createFakeGameSessionModel()
  const gameResultModel = createFakeGameResultModel()
  const fakeRedisService = createFakeRedisService()
  const fakeGameTimerService = createFakeGameTimerService()
  const fakeWordDeckService = createFakeWordDeckService(WORDS)
  const gateway = createStubGateway()

  const runtime = new GameRuntimeService(
    gameSessionModel as unknown as typeof GameSession,
    gameResultModel as unknown as typeof GameResult,
    fakeRoomsService as unknown as RoomsService,
    fakeRedisService as unknown as RedisService,
    fakeGameTimerService as unknown as GameTimerService,
    fakeWordDeckService as unknown as WordDeckService,
  )
  runtime.setGateway(gateway)
  createdRuntimes.push(runtime)

  return {
    runtime,
    gateway,
    room,
    fakeRoomsService,
    gameSessionModel,
    gameResultModel,
    fakeGameTimerService,
    fakeRedisService,
  }
}

/** Mirrors the `game:state:{sessionId}` convention documented in the task
 * brief and implemented by `GameRuntimeService` — used only to reach
 * directly into the fake Redis store for the action-count guard test below,
 * without exposing any test-only method on the service itself. */
function stateKey(sessionId: string): string {
  return `game:state:${sessionId}`
}

function wordView(payload: unknown): WordGameView {
  const view = payload as { kind: string }
  if (view.kind !== 'word') throw new Error('expected a word game view')
  return payload as WordGameView
}

function sessionIdFrom(gateway: { emitted: EmittedEntry[] }): string {
  const started = gateway.emitted.find((e) => e.event === 'game:started')
  if (!started) throw new Error('expected a game:started event')
  return (started.payload as { sessionId: string }).sessionId
}

function latestGameState(gateway: { emitted: EmittedEntry[] }, playerId: string): WordGameView {
  const entry = [...gateway.emitted]
    .reverse()
    .find((e) => e.event === 'game:state' && e.userId === playerId)
  if (!entry) throw new Error(`expected a game:state emitted to ${playerId}`)
  return wordView(entry.payload)
}

function currentExplainer(gateway: { emitted: EmittedEntry[] }, anyPlayer: string): string {
  const explainerId = latestGameState(gateway, anyPlayer).explainerId
  if (!explainerId) throw new Error('expected an explainer')
  return explainerId
}

async function playFullAliasGame(
  runtime: GameRuntimeService,
  gateway: ReturnType<typeof createStubGateway>,
  roomId: string,
  anyPlayer: string,
): Promise<void> {
  // DEFAULT_OPTIONS on the alias reducer: totalRounds 4 * teamCount 2 = 8
  // turns. Each iteration drives exactly one turn to completion.
  for (let i = 0; i < 8; i++) {
    const explainer = currentExplainer(gateway, anyPlayer)
    await runtime.dispatch(roomId, explainer, { type: 'word/start_round' })
    await runtime.dispatch(roomId, explainer, { type: 'word/end_round' })
  }
}

describe('GameRuntimeService', () => {
  it('refuses to start when the requester is not the host', async () => {
    const { runtime } = createRuntime({
      id: 'room1',
      hostId: 'host',
      memberIds: ['host', 'g1', 'g2', 'g3'],
      selectedGameId: 'alias',
      status: 'lobby',
    })

    await expect(runtime.start('room1', 'g1')).rejects.toThrow(ForbiddenException)
  })

  it('refuses to start with fewer players than the game minimum', async () => {
    // alias.meta.minPlayers === 4 (see @gp/shared's GAME_CATALOG).
    const { runtime } = createRuntime({
      id: 'room1',
      hostId: 'host',
      memberIds: ['host', 'g1'],
      selectedGameId: 'alias',
      status: 'lobby',
    })

    await expect(runtime.start('room1', 'host')).rejects.toThrow(BadRequestException)
  })

  it('emits a personalised game:state to every player, and only the current explainer receives a secretWord', async () => {
    const { runtime, gateway } = createRuntime({
      id: 'room1',
      hostId: 'host',
      memberIds: ['host', 'g1', 'g2', 'g3'],
      selectedGameId: 'alias',
      status: 'lobby',
    })

    await runtime.start('room1', 'host')

    // Right after start(): init() has not drawn a word yet (word/start_round
    // is a distinct, explainer-initiated action per the word-engine
    // contract — see createWordRound's own docs: "the clock is genuinely
    // unset"), so every player's initial view has secretWord: null. This is
    // a deliberate adaptation of the brief's literal pseudocode (`await
    // runtime.start(...)` then checking for one non-null secretWord): the
    // reducer never draws a word until the explainer explicitly starts the
    // turn, for turn 1 same as every turn after it, so the assertion is
    // checked after that explicit action instead.
    const initialStates = gateway.emitted.filter((e) => e.event === 'game:state')
    expect(initialStates).toHaveLength(4)
    expect(initialStates.every((e) => wordView(e.payload).secretWord === null)).toBe(true)

    // Grab the explainer while the initial game:state broadcasts are still
    // in `emitted`, then clear the log to isolate what start_round emits.
    const explainerId = currentExplainer(gateway, 'host')
    gateway.emitted.length = 0
    await runtime.dispatch('room1', explainerId, { type: 'word/start_round' })

    const afterStart = gateway.emitted.filter((e) => e.event === 'game:state')
    expect(afterStart).toHaveLength(4)
    const words = afterStart.map((e) => wordView(e.payload).secretWord)
    expect(words.filter(Boolean)).toHaveLength(1)
    const explainerView = afterStart.find((e) => e.userId === explainerId)
    expect(wordView(explainerView?.payload).secretWord).toBeTruthy()
  })

  it('an invalid action emits error to the actor and leaves state unchanged', async () => {
    const { runtime, gateway } = createRuntime({
      id: 'room1',
      hostId: 'host',
      memberIds: ['host', 'g1', 'g2', 'g3'],
      selectedGameId: 'alias',
      status: 'lobby',
    })
    await runtime.start('room1', 'host')
    const sessionId = sessionIdFrom(gateway)

    const explainerId = currentExplainer(gateway, 'host')
    const notExplainer = ['host', 'g1', 'g2', 'g3'].find((p) => p !== explainerId)
    if (!notExplainer) throw new Error('expected a non-explainer player')

    const before = await runtime.snapshot(sessionId)
    await runtime.dispatch('room1', notExplainer, { type: 'word/correct' })

    expect(gateway.emitted.at(-1)).toMatchObject({ userId: notExplainer, event: 'error' })
    expect(await runtime.snapshot(sessionId)).toEqual(before)
  })

  it('writes GameResult rows and sets the room to results when the game finishes', async () => {
    const { runtime, gateway, gameResultModel, fakeRoomsService, room } = createRuntime({
      id: 'room1',
      hostId: 'host',
      memberIds: ['host', 'g1', 'g2', 'g3'],
      selectedGameId: 'alias',
      status: 'lobby',
    })
    await runtime.start('room1', 'host')

    await playFullAliasGame(runtime, gateway, 'room1', 'host')

    expect(gameResultModel.rows).toHaveLength(4)
    expect(fakeRoomsService.setStatus).toHaveBeenCalledWith('room1', 'results')
    expect(room.status).toBe('results')
    expect(gateway.emitted.some((e) => e.event === 'game:ended')).toBe(true)
  })

  it('clears all session timers when the game finishes', async () => {
    const { runtime, gateway, fakeGameTimerService } = createRuntime({
      id: 'room1',
      hostId: 'host',
      memberIds: ['host', 'g1', 'g2', 'g3'],
      selectedGameId: 'alias',
      status: 'lobby',
    })
    await runtime.start('room1', 'host')
    const sessionId = sessionIdFrom(gateway)

    await playFullAliasGame(runtime, gateway, 'room1', 'host')

    expect(fakeGameTimerService.clearAllCalls).toContain(sessionId)
  })

  it('force-finishes a session once it hits the action-count guard (Durak forever-loop protection)', async () => {
    const { runtime, gateway, room, fakeRedisService } = createRuntime({
      id: 'room1',
      hostId: 'host',
      memberIds: ['host', 'g1', 'g2', 'g3'],
      selectedGameId: 'alias',
      status: 'lobby',
    })
    await runtime.start('room1', 'host')
    const sessionId = sessionIdFrom(gateway)

    // Simulate a session that has already dispatched MAX_ACTIONS_PER_SESSION
    // actions, without actually driving that many real turns — reach
    // directly into the fake Redis store rather than adding a test-only
    // method to the service's public surface.
    const raw = fakeRedisService.client.store.get(stateKey(sessionId))
    if (!raw) throw new Error('expected a stored snapshot')
    const envelope = JSON.parse(raw) as Record<string, unknown>
    fakeRedisService.client.store.set(
      stateKey(sessionId),
      JSON.stringify({ ...envelope, actionCount: MAX_ACTIONS_PER_SESSION }),
    )

    const explainerId = currentExplainer(gateway, 'host')
    await runtime.dispatch('room1', explainerId, { type: 'word/start_round' })

    expect(room.status).toBe('results')
    expect(gateway.emitted.some((e) => e.event === 'error' && e.userId === explainerId)).toBe(true)
  })
})
