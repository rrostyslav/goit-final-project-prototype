import type {
  Ack,
  ChatMessageDto,
  ClientToServerEvents,
  DrawStroke,
  GameAction,
  GameEvent,
  GameId,
  NotificationDto,
  PlayerId,
  PlayerView,
  RoomDto,
  RoomId,
  VoiceCredentials,
} from '@gp/shared'
import { create } from 'zustand'
import { refreshAccessToken } from '../api'
import { type AppSocket, createSocket, SocketAckError } from '../socket'
import { useAuthStore } from './auth-store'

// Bounds on the client-side history the store keeps for chat/game-event/
// notification streams -- none of these are ever paginated from the server
// (it only ever pushes new ones), so without a cap a very long session would
// grow these arrays unbounded for the lifetime of the tab.
const MAX_MESSAGES = 200
const MAX_EVENTS = 50
const MAX_NOTIFICATIONS = 20

export interface GameStanding {
  playerId: PlayerId
  score: number
  placement: number
}

interface RoomState {
  room: RoomDto | null
  messages: ChatMessageDto[]
  view: PlayerView | null
  standings: GameStanding[] | null
  votes: Record<string, PlayerId[]>
  events: GameEvent[]
  notifications: NotificationDto[]
  gameId: GameId | null
  sessionId: string | null
  /** Crocodile's drawing log for the room's current game, in the order
   * strokes were drawn -- a full replace on `draw:sync` (initial catch-up on
   * join, and the empty-array broadcast a clear or a fresh round produces),
   * an append on every incoming `draw:stroke`. Reset when a new game starts
   * (see `game:started` below) so a leftover drawing never bleeds into the
   * next session before the first `draw:sync` of that session arrives. */
  strokes: DrawStroke[]
  /** The most recent `error` event pushed to this socket -- almost always a
   * rejected `game:action` (an `InvalidActionError` the reducer threw; see
   * `RealtimeGateway.onGameAction`'s doc comment for why that never surfaces
   * through `game:action`'s own ack) or a rejected `draw:stroke`/`draw:clear`
   * authorization check. Task 22's word-game screens are the intended
   * consumer -- see `clearGameError` for how a screen dismisses a stale one
   * once it has shown it. */
  gameError: { code: string; message: string } | null
  /** Live Socket.IO transport state -- distinct from LiveKit's own
   * connection state (see use-voice.ts), tracked here so any room-page UI
   * can show a "reconnecting..." banner independent of voice. */
  socketConnected: boolean
  joinError: string | null
  /** Set when the server pushes `room:kicked`. The room page watches this to
   * route away with a translated explanation -- see that component. */
  kickedReason: 'kick' | 'ban' | null

  join: (roomId: RoomId) => Promise<void>
  leave: () => Promise<void>
  setReady: (isReady: boolean) => Promise<void>
  sendChat: (text: string) => Promise<void>
  selectGame: (gameId: GameId) => Promise<void>
  voteGame: (gameId: GameId) => Promise<void>
  startGame: () => Promise<void>
  sendAction: (action: GameAction) => Promise<void>
  kick: (userId: PlayerId) => Promise<void>
  ban: (userId: PlayerId) => Promise<void>
  transferHost: (userId: PlayerId) => Promise<void>
  requestVoiceToken: (roomId: RoomId) => Promise<VoiceCredentials>
  clearKicked: () => void
  /** Fire-and-forget, like the wire event itself (`ClientToServerEvents`'s
   * `draw:stroke` takes no ack) -- appends optimistically to `strokes` so
   * the drawing explainer's own canvas has a single source of truth (the
   * store) to redraw from on resize, exactly like every other client's,
   * since the server's broadcast deliberately excludes the sender (see
   * `RealtimeGateway.onDrawStroke`'s `socket.to(roomId)`, not `.to`). */
  sendStroke: (stroke: DrawStroke) => void
  /** Also fire-and-forget. Never applied optimistically -- unlike
   * `sendStroke`, a rejected `draw:clear` (rate-limited, or neither the
   * explainer nor the host) must not show a cleared canvas that the server
   * never actually cleared; this waits for the room-wide `draw:sync` the
   * server broadcasts once the clear actually happens (see
   * `RealtimeGateway.clearDrawing`), the same way every other viewer's
   * canvas clears. */
  clearDrawing: () => void
  clearGameError: () => void
}

const initialState = {
  room: null,
  messages: [],
  view: null,
  standings: null,
  votes: {},
  events: [],
  notifications: [],
  gameId: null,
  sessionId: null,
  strokes: [],
  gameError: null,
  socketConnected: false,
  joinError: null,
  kickedReason: null,
} satisfies Omit<
  RoomState,
  | 'join'
  | 'leave'
  | 'setReady'
  | 'sendChat'
  | 'selectGame'
  | 'voteGame'
  | 'startGame'
  | 'sendAction'
  | 'kick'
  | 'ban'
  | 'transferHost'
  | 'requestVoiceToken'
  | 'clearKicked'
  | 'sendStroke'
  | 'clearDrawing'
  | 'clearGameError'
>

// ---------------------------------------------------------------------------
// Socket singleton
//
// "One socket per session, created once and reused" (task-21 brief): the
// connection lives here, at module scope, not inside any component or
// effect. Every action below (and the room page's own join-on-mount effect)
// calls `ensureSocket()`, which creates the connection at most once and
// hands back the same instance forever after -- including across React
// Strict Mode's dev-only double-invocation of effects, which recreates
// component state but never re-evaluates this module. The `join` action
// below adds one more layer on top (`pendingJoin` dedup) so even two
// concurrent `join(sameRoomId)` calls -- exactly what Strict Mode produces --
// only ever emit one `room:join`.
// ---------------------------------------------------------------------------

let socket: AppSocket | null = null
let listenersAttached = false
let pendingJoin: { roomId: RoomId; promise: Promise<void> } | null = null

type PayloadOf<E extends keyof ClientToServerEvents> = Parameters<ClientToServerEvents[E]>[0]
type AckDataOf<E extends keyof ClientToServerEvents> = Parameters<
  ClientToServerEvents[E]
>[1] extends (r: Ack<infer T>) => void
  ? T
  : never

/** Socket.IO-client's typed `emit` overloads don't resolve through a generic
 * `E` parameter -- the exact same problem (and fix) as the backend's own
 * `emitToUser`/e2e `emit` helper (see realtime.gateway.ts and
 * backend/test/e2e/helpers.ts): narrow the target to a small single-purpose
 * interface instead of reaching for `any`. */
interface AckEmittable<E extends keyof ClientToServerEvents> {
  emit(event: E, payload: PayloadOf<E>, ack: (response: Ack<AckDataOf<E>>) => void): boolean
}

function emitWithAck<E extends keyof ClientToServerEvents>(
  s: AppSocket,
  event: E,
  payload: PayloadOf<E>,
): Promise<AckDataOf<E>> {
  return new Promise((resolve, reject) => {
    const target = s as unknown as AckEmittable<E>
    target.emit(event, payload, (response) => {
      if (!response.ok) {
        reject(new SocketAckError(response.error?.code ?? 'unknown', response.error?.message ?? ''))
        return
      }
      resolve(response.data as AckDataOf<E>)
    })
  })
}

function doJoin(s: AppSocket, roomId: RoomId): Promise<RoomDto> {
  return emitWithAck(s, 'room:join', { roomId })
}

function ensureSocket(): AppSocket {
  if (socket) return socket
  const token = useAuthStore.getState().accessToken
  if (!token) {
    throw new Error('Cannot open a realtime connection while signed out')
  }
  // Reads the store fresh on every (re)connect attempt -- see socket.ts's
  // own doc comment on `createSocket` for why a plain captured string here
  // was the Task 21 review finding's root cause.
  const s = createSocket(() => useAuthStore.getState().accessToken ?? '')
  attachListeners(s)
  socket = s
  return s
}

/** Registered exactly once, when the socket is first created -- these are
 * the "global" listeners the whole app shares, as opposed to anything a
 * particular component subscribes to. Guarded by `listenersAttached` so a
 * hot-reload or a stray second `ensureSocket()` call can never double them
 * up (Socket.IO would otherwise call a handler twice per event). */
function attachListeners(s: AppSocket): void {
  if (listenersAttached) return
  listenersAttached = true

  s.on('connect', () => {
    useRoomStore.setState({ socketConnected: true })
    // Reconnect case only: a brand-new Socket.IO handshake has no memory of
    // this user's previous room membership (assertMember checks
    // socket.rooms, which starts empty again), so re-join whatever room we
    // were last in. On the very first connect `room` is still null (the
    // page's own join() call is what populates it), so this is a no-op then.
    const roomId = useRoomStore.getState().room?.id
    if (roomId) {
      doJoin(s, roomId)
        .then((data) => useRoomStore.setState({ room: data }))
        .catch(() => {
          // Best-effort: if this also fails, the user is still looking at
          // the last known room state and can retry via a page refresh.
          // Nothing here should crash the app over a transient reconnect.
        })
    }
  })

  s.on('disconnect', () => {
    useRoomStore.setState({ socketConnected: false })
  })

  // Review finding (Task 21 fix-up): a handshake rejected for an expired
  // access token (the common case once `JWT_ACCESS_TTL`, 15 minutes,
  // elapses on an otherwise-idle socket) used to retry forever with the
  // SAME stale token -- socket.ts's `auth` becoming a function fixes
  // reconnects that happen AFTER some other REST call has already
  // refreshed the store's token, but an idle session with no REST traffic
  // needs this handler to actually trigger that refresh itself. See
  // `handleConnectError` below for the recovery/give-up logic.
  s.on('connect_error', () => {
    void handleConnectError(s)
  })

  s.on('room:state', (dto) => useRoomStore.setState({ room: dto }))
  s.on('room:votes', (votes) => useRoomStore.setState({ votes }))
  s.on('chat:message', (message) =>
    useRoomStore.setState((state) => ({
      messages: [...state.messages, message].slice(-MAX_MESSAGES),
    })),
  )
  s.on('game:started', ({ gameId, sessionId }) =>
    // `strokes`/`gameError` reset here too: a leftover drawing or a stale
    // rejection from the PREVIOUS game in this room must never bleed into
    // the next one. For Crocodile specifically the server also clears the
    // drawing log itself on the first `word/start_round` (see
    // `GameRuntimeService.applyEffect`'s `round_started` handling) and
    // broadcasts a fresh `draw:sync` then -- this reset just covers the
    // window between `game:started` and that first round actually starting.
    useRoomStore.setState({
      gameId,
      sessionId,
      view: null,
      standings: null,
      strokes: [],
      gameError: null,
    }),
  )
  s.on('game:state', (view) => useRoomStore.setState({ view }))
  s.on('game:event', (event) =>
    useRoomStore.setState((state) => ({ events: [...state.events, event].slice(-MAX_EVENTS) })),
  )
  s.on('game:ended', ({ standings }) => useRoomStore.setState({ standings, view: null }))
  s.on('room:kicked', ({ reason }) => useRoomStore.setState({ kickedReason: reason }))
  s.on('notification', (notification) =>
    useRoomStore.setState((state) => ({
      notifications: [...state.notifications, notification].slice(-MAX_NOTIFICATIONS),
    })),
  )
  // Task 18's Crocodile drawing channel: `draw:sync` is a full replace (the
  // catch-up a joining/reconnecting socket receives, and the empty-array
  // broadcast `RealtimeGateway.clearDrawing` sends on an explicit clear or a
  // fresh round), `draw:stroke` is an incremental append for everyone
  // EXCEPT the sender (who already drew it locally -- see `sendStroke`).
  s.on('draw:sync', (strokes) => useRoomStore.setState({ strokes }))
  s.on('draw:stroke', (stroke) =>
    useRoomStore.setState((state) => ({ strokes: [...state.strokes, stroke] })),
  )
  // Room-scoped write rejections with no ack to report through (rate
  // limits, `draw:*`/`game:action` authorization failures -- see those
  // handlers' own doc comments in realtime.gateway.ts) surface here. Task
  // 22's word-game screens read `gameError` off the store to show the last
  // one -- see `clearGameError` for how a screen dismisses it again.
  s.on('error', (payload) => useRoomStore.setState({ gameError: payload }))
}

/** Review finding (Task 21 fix-up): recovers from a rejected handshake, or
 * gives up cleanly instead of leaving Socket.IO's own reconnection backoff
 * spinning against the server forever.
 *
 * `connect_error` fires for two very different reasons and this handler
 * must tell them apart:
 *   1. A genuine namespace rejection (`RealtimeGateway.authenticate` threw
 *      -- expired/invalid token). Socket.IO has ALREADY given up its own
 *      retry loop by the time this fires (a rejected namespace handshake
 *      destroys the client-side namespace socket, which -- being the only
 *      namespace this app ever opens -- tears down the whole Manager with
 *      `skipReconnect: true`); nothing will retry unless this handler
 *      explicitly calls `s.connect()` again.
 *   2. A low-level transport failure (offline, DNS, a proxy blip) with a
 *      still-valid token. Socket.IO's own backoff is still running in this
 *      case and needs no help from here.
 * Both look identical from this listener alone, so it always attempts the
 * SAME shared refresh (`refreshAccessToken`, api.ts's own 401-retry path --
 * no second refresh implementation) and then branches on the outcome:
 *   - New token: no longer distinguishes the two cases at all --
 *     reconnecting is safe and correct either way, so just do it.
 *   - No token, but the store still has one: the refresh call itself
 *     couldn't complete (case 2) -- `doRefresh` in api.ts only clears the
 *     session on an explicit non-2xx response, never on a network
 *     exception -- so leave Socket.IO's still-running backoff alone.
 *   - No token, and the store's is gone too: `doRefresh` got an explicit
 *     rejection and already cleared the session -- the refresh token
 *     itself is invalid, not just the access token, so there is nothing
 *     left to retry with. Stop for good and surface a translated
 *     "sign in again" state instead of a banner that spins forever.
 */
async function handleConnectError(s: AppSocket): Promise<void> {
  const token = await refreshAccessToken()
  if (token) {
    if (!s.connected) s.connect()
    return
  }
  if (!useAuthStore.getState().accessToken) {
    s.io.reconnection(false)
    s.disconnect()
    useAuthStore.getState().markSessionExpired()
  }
}

// ---------------------------------------------------------------------------
// Session end: close the socket when the user's session goes away
//
// Review finding (Task 21 fix-up): `auth-store.ts`'s `logout` has no way to
// reach the socket directly -- importing this module there would be exactly
// the circular dependency this module's own header comment warns about (the
// store already depends on auth-store.ts, not the other way around). Solved
// from THIS side instead: this module already imports `useAuthStore`, so it
// subscribes to it and reacts whenever `user` transitions from signed-in to
// signed-out -- logout, or `markSessionExpired` above after a failed
// refresh. No new import anywhere, no cycle.
// ---------------------------------------------------------------------------

useAuthStore.subscribe((state, prevState) => {
  if (prevState.user && !state.user) {
    closeSocket()
  }
})

/** Also resets the module-level socket/listener bookkeeping (not just the
 * live connection) so a subsequent login -- same tab, e.g. the guest
 * upgrade or a plain re-login after `sessionExpired` -- gets a genuinely
 * fresh `ensureSocket()` rather than reusing this now-disconnected
 * instance forever. Room state is cleared too: it belongs to the session
 * that just ended, and must not leak into whichever session (possibly a
 * different user, on a shared tab) opens next. */
function closeSocket(): void {
  useRoomStore.setState({ ...initialState })
  if (!socket) return
  socket.io.reconnection(false)
  socket.disconnect()
  socket = null
  listenersAttached = false
}

export const useRoomStore = create<RoomState>((set, get) => ({
  ...initialState,

  join: async (roomId) => {
    if (pendingJoin && pendingJoin.roomId === roomId) {
      return pendingJoin.promise
    }
    const s = ensureSocket()
    const promise = doJoin(s, roomId)
      .then((data) => {
        set({ room: data, joinError: null, kickedReason: null })
      })
      .catch((err: unknown) => {
        set({ joinError: err instanceof Error ? err.message : 'Failed to join room' })
        throw err
      })
      .finally(() => {
        if (pendingJoin?.roomId === roomId) pendingJoin = null
      })
    pendingJoin = { roomId, promise }
    return promise
  },

  leave: async () => {
    const roomId = get().room?.id
    if (!roomId) return
    const s = ensureSocket()
    await emitWithAck(s, 'room:leave', { roomId })
    set({ ...initialState })
  },

  setReady: async (isReady) => {
    const roomId = requireRoomId(get)
    const s = ensureSocket()
    await emitWithAck(s, 'room:ready', { roomId, isReady })
  },

  sendChat: async (text) => {
    const roomId = requireRoomId(get)
    const s = ensureSocket()
    await emitWithAck(s, 'room:chat', { roomId, text })
  },

  selectGame: async (gameId) => {
    const roomId = requireRoomId(get)
    const s = ensureSocket()
    await emitWithAck(s, 'room:select_game', { roomId, gameId })
  },

  voteGame: async (gameId) => {
    const roomId = requireRoomId(get)
    const s = ensureSocket()
    await emitWithAck(s, 'room:vote_game', { roomId, gameId })
  },

  startGame: async () => {
    const roomId = requireRoomId(get)
    const s = ensureSocket()
    await emitWithAck(s, 'game:start', { roomId })
  },

  sendAction: async (action) => {
    const roomId = requireRoomId(get)
    const s = ensureSocket()
    await emitWithAck(s, 'game:action', { roomId, action })
  },

  kick: async (userId) => {
    const roomId = requireRoomId(get)
    const s = ensureSocket()
    await emitWithAck(s, 'room:kick', { roomId, userId })
  },

  ban: async (userId) => {
    const roomId = requireRoomId(get)
    const s = ensureSocket()
    await emitWithAck(s, 'room:ban', { roomId, userId })
  },

  transferHost: async (userId) => {
    const roomId = requireRoomId(get)
    const s = ensureSocket()
    await emitWithAck(s, 'room:transfer_host', { roomId, userId })
  },

  requestVoiceToken: async (roomId) => {
    const s = ensureSocket()
    return emitWithAck(s, 'voice:token', { roomId })
  },

  clearKicked: () => set({ kickedReason: null }),

  sendStroke: (stroke) => {
    const roomId = requireRoomId(get)
    const s = ensureSocket()
    s.emit('draw:stroke', { roomId, stroke })
    set((state) => ({ strokes: [...state.strokes, stroke] }))
  },

  clearDrawing: () => {
    const roomId = requireRoomId(get)
    const s = ensureSocket()
    s.emit('draw:clear', { roomId })
  },

  clearGameError: () => set({ gameError: null }),
}))

function requireRoomId(get: () => RoomState): RoomId {
  const roomId = get().room?.id
  if (!roomId) {
    throw new Error('Not currently joined to a room')
  }
  return roomId
}
