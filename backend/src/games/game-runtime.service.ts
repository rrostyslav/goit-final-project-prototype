import { randomInt } from 'node:crypto'
import {
  type ActionContext,
  createRng,
  type Effect,
  type GameDefinition,
  getGameDefinition,
  InvalidActionError,
} from '@gp/game-core'
import type {
  GameAction,
  GameId,
  Locale,
  PlayerId,
  PlayerView,
  RoomDto,
  RoomId,
  ServerToClientEvents,
  SessionId,
  UserId,
} from '@gp/shared'
import { getGameMeta } from '@gp/shared'
import { BadRequestException, Injectable, Logger, type OnModuleDestroy } from '@nestjs/common'
import { InjectModel } from '@nestjs/sequelize'
import { GameResult } from '../database/models/game-result.model'
import { GameSession } from '../database/models/game-session.model'
import { RedisService } from '../redis/redis.service'
import { RoomsService } from '../rooms/rooms.service'
import { GameTimerService } from './game-timer.service'
import { WordDeckService } from './word-deck.service'

/** How long the `results` room status stays up before `GameRuntimeService`
 * returns the room to `lobby` on its own. Named per the brief so the value
 * is documented in exactly one place. */
export const RESULTS_TO_LOBBY_MS = 8_000

/**
 * Session guard against a game that can, in principle, run forever. Durak's
 * own property test (Task 13) already proved every legal game at 2-6
 * players finishes well inside a 4000-action cap; Task 13's report also
 * documents a genuine periodic orbit a non-adaptive strategy can enter
 * (period 48 at one seed/player-count combination) — legal play, no
 * reducer bug, just a game that never reaches `finished`. Rather than a
 * wall-clock cap (which lets a fast, tight loop burn CPU/Redis/Postgres
 * for the full duration before it trips), this counts *dispatched client
 * actions* per session and force-finishes once the count matches the same
 * ceiling already validated as more than enough for a real game — so a
 * genuinely stuck room is force-ended almost immediately after crossing
 * into "no real game looks like this" territory, not after some arbitrary
 * wall-clock timeout. Word games can never reach this ceiling under normal
 * play (they are turn-capped by `totalTurns`); this guard only ever matters
 * for the two card games.
 */
export const MAX_ACTIONS_PER_SESSION = 4_000

const DEFAULT_LOCALE: Locale = 'uk'
/** `crypto.randomInt`'s exclusive upper bound for both the session seed and
 * every per-action seed — kept within 2^31 so it round-trips cleanly through
 * `createRng`'s `seed >>> 0` and stays a safe integer everywhere it is
 * serialized (Redis JSON, Postgres jsonb). */
const SEED_UPPER_BOUND = 0x7fff_ffff
/** `ActionContext.actorId` for a system-triggered transition (a timer firing,
 * or a disconnect-driven pause/resume) that no real player initiated. None
 * of the five registered games currently read `ctx.actorId` outside
 * `reduce()` (see `onTimer`'s `_ctx` parameters), but the contract still
 * requires a value. */
const SYSTEM_ACTOR: PlayerId = 'system'

function stateKey(sessionId: SessionId): string {
  return `game:state:${sessionId}`
}

function sessionKey(roomId: RoomId): string {
  return `room:session:${roomId}`
}

/** Same key convention `RealtimeGateway`'s exported `lockKey` uses for every
 * `room:*` mutation (`room:join`, `room:leave`, `room:kick`, `room:ban`,
 * `room:transfer_host`) — duplicated here as a plain string builder rather
 * than importing from the gateway, for the same reason `votesKey` below is
 * duplicated rather than imported: the dependency runs gateway -> this
 * service, not the reverse (see `GameSocketGateway`'s doc comment). Every
 * method here that runs a load -> reduce -> persist -> broadcast sequence
 * against a room's game state (`start`, `dispatch`, `handleTimer`,
 * `pauseForDisconnect`, `resumeAfterReconnect`) takes this same lock, so a
 * concurrent `game:action`/`game:start`/timer-fire/disconnect/reconnect for
 * one room can never interleave its read and write with another's — see
 * this task's fix report for the lost-update race this closes. The lock is
 * acquired at exactly one level (these five entry points) and nowhere
 * inside them, so none of them can ever nest a second acquisition of their
 * own room's lock and stall waiting on themselves. */
function lockKey(roomId: RoomId): string {
  return `room:${roomId}`
}

/** Same key convention `RealtimeGateway` uses for its `votes:{roomId}` Redis
 * hash (see that file's `votesKey`) — duplicated here as a plain string
 * builder rather than importing from the gateway, to avoid a module-level
 * dependency from this service back onto the realtime layer (the dependency
 * runs the other way: `RealtimeModule` imports `GamesModule`, wiring itself
 * into `GameRuntimeService` via `setGateway`, not the reverse). Both sides
 * are covered by the end-to-end smoke test in this task's report. */
function votesKey(roomId: RoomId): string {
  return `votes:${roomId}`
}

/**
 * The envelope actually stored at `game:state:{sessionId}` in Redis. Bundles
 * `gameId` and `state` together in the one JSON blob a session's state is
 * ever read from or written to — see `loadGame` below for why that is the
 * whole point.
 */
interface StoredSnapshot {
  roomId: RoomId
  gameId: GameId
  playerIds: PlayerId[]
  actionCount: number
  state: unknown
}

/**
 * Everything one game-engine call needs, sourced from exactly one place.
 * `definition` and `state` always come from the *same* `loadGame` call — see
 * that method for why this is what makes cross-game contamination
 * structurally impossible rather than merely avoided by convention.
 */
interface LoadedGame {
  sessionId: SessionId
  roomId: RoomId
  gameId: GameId
  playerIds: PlayerId[]
  actionCount: number
  definition: GameDefinition
  state: unknown
}

/** The minimal slice of `RealtimeGateway` this service needs: pushing a
 * personalised event to one user's sockets, and re-broadcasting the shared
 * room DTO. Kept as a small structural interface (not a dependency on the
 * concrete `RealtimeGateway` class) so `GamesModule` never has to import
 * `RealtimeModule` — the dependency runs the other way, exactly like
 * `PresenceService.setEvictionHandler` / `NotificationsService
 * .setDeliveryHandler` from Task 15: `RealtimeModule.onModuleInit` calls
 * `setGateway(this.gateway)`, since `RealtimeGateway` already structurally
 * satisfies this interface. */
export interface GameSocketGateway {
  emitToUser<E extends keyof ServerToClientEvents>(
    userId: PlayerId,
    event: E,
    payload: Parameters<ServerToClientEvents[E]>[0],
  ): Promise<void>
  broadcastRoomState(roomId: RoomId): Promise<RoomDto>
  /** Empties `roomId`'s drawing log and broadcasts `draw:sync` with `[]` to
   * everyone still in the room — called below whenever a Crocodile round
   * starts (see `applyEffect`'s `round_started` handling), so the next
   * explainer's canvas starts blank for every viewer, not just future
   * joiners. Implemented by `RealtimeGateway` (Task 18), which owns both the
   * `DrawingService` this delegates to and the socket broadcast — kept off
   * this service on purpose: drawing strokes are deliberately outside the
   * reducer/game-state this file owns (see Task 18's report). */
  clearDrawing(roomId: RoomId): Promise<void>
}

/**
 * The authoritative game-session runtime: the only thing that ever calls a
 * `@gp/game-core` reducer. Loads state, calls `init`/`reduce`/`onTimer`/
 * `pause`/`resume`, persists the result, and pushes a per-player `view()` —
 * never raw state, never one shared view — over the socket via whatever
 * `GameSocketGateway` has been wired in.
 */
@Injectable()
export class GameRuntimeService implements OnModuleDestroy {
  private readonly logger = new Logger(GameRuntimeService.name)
  private gateway: GameSocketGateway | null = null
  /** Pending `results -> lobby` timers, keyed by room id — deliberately NOT
   * inside `GameTimerService` (that service is keyed by *session* id, and by
   * the time this timer matters the session has already been torn down by
   * `finish`). See `handleRoomEmptied` for why a room emptying during the
   * 8s window must be able to cancel this without an orphaned timer. */
  private readonly lobbyReturnTimers = new Map<RoomId, ReturnType<typeof setTimeout>>()

  constructor(
    @InjectModel(GameSession) private readonly gameSessionModel: typeof GameSession,
    @InjectModel(GameResult) private readonly gameResultModel: typeof GameResult,
    private readonly roomsService: RoomsService,
    private readonly redisService: RedisService,
    private readonly gameTimerService: GameTimerService,
    private readonly wordDeckService: WordDeckService,
  ) {}

  /** Wired once by `RealtimeModule.onModuleInit`. See `GameSocketGateway`'s
   * doc comment for why this is a settable hook rather than a constructor
   * dependency. */
  setGateway(gateway: GameSocketGateway): void {
    this.gateway = gateway
  }

  // -------------------------------------------------------------------
  // start / dispatch / handleTimer / finish
  // -------------------------------------------------------------------

  /** Locked for its ENTIRE body, not just the Redis writes at the end: two
   * concurrent `game:start` calls for the same room (a double-click, or two
   * hosts racing after a transfer) must not both pass the `room.status !==
   * 'lobby'` check and both create a session — the whole
   * check-then-create-then-persist sequence is the read-modify-write this
   * lock protects, exactly like `dispatch` below. */
  async start(roomId: RoomId, requesterId: UserId): Promise<void> {
    await this.redisService.withLock(lockKey(roomId), () => this.doStart(roomId, requesterId))
  }

  private async doStart(roomId: RoomId, requesterId: UserId): Promise<void> {
    await this.roomsService.assertHost(roomId, requesterId)
    const room = await this.roomsService.toDto(roomId)

    if (room.status !== 'lobby') {
      throw new BadRequestException('This room is not in the lobby')
    }
    if (!room.selectedGameId) {
      throw new BadRequestException('This room has no game selected')
    }

    const meta = getGameMeta(room.selectedGameId)
    const playerIds = room.members.map((m) => m.user.id)
    if (playerIds.length < meta.minPlayers || playerIds.length > meta.maxPlayers) {
      throw new BadRequestException(
        `${meta.id} needs between ${meta.minPlayers} and ${meta.maxPlayers} players ` +
          `(room has ${playerIds.length})`,
      )
    }

    const definition = getGameDefinition(meta.id)
    const seed = this.nextSeed()
    const now = this.now()
    const deck = await this.buildDeck(meta.id, meta.engine, seed)

    const state = definition.init({ players: playerIds, seed, options: {}, deck, now })

    const session = await this.gameSessionModel.create({
      roomId,
      gameId: meta.id,
      state: state as Record<string, unknown>,
    })

    const snapshot: StoredSnapshot = {
      roomId,
      gameId: meta.id,
      playerIds,
      actionCount: 0,
      state,
    }
    await this.redisService.client.set(stateKey(session.id), JSON.stringify(snapshot))
    await this.redisService.client.set(sessionKey(roomId), session.id)
    // Ephemeral game-selection votes stop meaning anything once a game has
    // actually started — clear the same `votes:{roomId}` hash
    // `RealtimeGateway` clears when the room empties (see that file's
    // comment on `votesKey`).
    await this.redisService.client.del(votesKey(roomId))

    await this.roomsService.setStatus(roomId, 'in_game')

    await this.broadcastToPlayers(playerIds, 'game:started', {
      gameId: meta.id,
      sessionId: session.id,
    })
    await this.broadcastStateToPlayers(playerIds, definition, state)
    await this.requireGateway().broadcastRoomState(roomId)
  }

  /** Locked for its entire body — see `lockKey`'s doc comment. This is the
   * fix for the review finding: two concurrent `game:action` dispatches for
   * the same room used to each run their own unsynchronized load -> reduce
   * -> persist -> broadcast, so the second `persistState` silently
   * clobbered the first (both broadcast their own event, only one
   * survived in storage). Locked, the second call's `tryLoadActiveGame`
   * cannot run until the first call's `applyEffect` (persist included) has
   * fully finished, so it reduces against the FIRST call's already-persisted
   * state rather than a stale copy. */
  async dispatch(roomId: RoomId, actorId: UserId, action: GameAction): Promise<void> {
    await this.redisService.withLock(lockKey(roomId), () =>
      this.doDispatch(roomId, actorId, action),
    )
  }

  private async doDispatch(roomId: RoomId, actorId: UserId, action: GameAction): Promise<void> {
    const loaded = await this.tryLoadActiveGame(roomId)
    if (!loaded) {
      await this.requireGateway().emitToUser(actorId, 'error', {
        code: 'no_active_game',
        message: 'No game is currently running in this room',
      })
      return
    }

    if (loaded.actionCount >= MAX_ACTIONS_PER_SESSION) {
      await this.doFinish(loaded.sessionId)
      await this.requireGateway().emitToUser(actorId, 'error', {
        code: 'session_action_limit',
        message: 'This game session hit its action limit and was ended',
      })
      return
    }

    const ctx: ActionContext = { actorId, now: this.now(), seed: this.nextSeed() }
    let effect: Effect<unknown>
    try {
      effect = loaded.definition.reduce(loaded.state, action, ctx)
    } catch (err) {
      if (err instanceof InvalidActionError) {
        // The central invariant: a rejected action becomes an `error` event
        // to the acting socket ONLY, and nothing below this point ever
        // runs — no persist, no broadcast, no timer change. State is
        // untouched because we simply never call `persistState`/
        // `applyEffect` on this path.
        await this.requireGateway().emitToUser(actorId, 'error', {
          code: err.code,
          message: err.message,
        })
        return
      }
      throw err
    }

    await this.applyEffect(loaded, effect, 1)
  }

  /** Locked for its entire body, same as `dispatch`/`start` — a timer firing
   * (turn clock running out) is exactly as much a read-modify-write against
   * a room's game state as a client action is, and must be serialized
   * against a concurrent `game:action`/`game:start` for the same room the
   * same way. `roomId` is passed in by `applyTimers` below (captured from
   * the `LoadedGame` that armed the timer) rather than re-derived from
   * `sessionId` here, so picking the lock key never needs a read before the
   * lock is held. */
  async handleTimer(roomId: RoomId, sessionId: SessionId, timerId: string): Promise<void> {
    await this.redisService.withLock(lockKey(roomId), () => this.doHandleTimer(sessionId, timerId))
  }

  private async doHandleTimer(sessionId: SessionId, timerId: string): Promise<void> {
    const loaded = await this.loadGame(sessionId).catch(() => null)
    // The session may already be gone (finished, or its room emptied) by
    // the time an in-flight timer actually fires — a stale timer callback
    // is a no-op, not an error.
    if (!loaded) return

    const ctx: ActionContext = { actorId: SYSTEM_ACTOR, now: this.now(), seed: this.nextSeed() }
    const effect = loaded.definition.onTimer(loaded.state, timerId, ctx)
    await this.applyEffect(loaded, effect)
  }

  /** Private and unlocked on purpose: every path that reaches this method —
   * `doDispatch`'s action-count guard, and `applyEffect`'s `effect.finished`
   * branch (itself only ever called from `doDispatch`/`doHandleTimer`/
   * `pauseForDisconnect`/`resumeAfterReconnect`) — is already running inside
   * one of those methods' `withLock(lockKey(roomId), ...)`. Taking the same
   * room's lock again here would be a nested acquisition of a non-reentrant
   * mutex: `RedisService.withLock` has no notion of "the current holder is
   * me", so it would just retry against its own still-held lock until
   * `LOCK_ACQUIRE_TIMEOUT_MS` and then proceed anyway — a multi-second stall
   * on every single game finish, for no correctness benefit. The lock is
   * acquired at exactly one level (the five entry points named on `lockKey`)
   * and this is deliberately not one of them. */
  private async doFinish(sessionId: SessionId): Promise<void> {
    const loaded = await this.loadGame(sessionId)
    const results = loaded.definition.results(loaded.state)

    await Promise.all(
      results.map((r) =>
        this.gameResultModel.create({
          sessionId,
          userId: r.playerId,
          score: r.score,
          placement: r.placement,
        }),
      ),
    )
    await this.gameSessionModel.update({ endedAt: new Date() }, { where: { id: sessionId } })
    await this.roomsService.setStatus(loaded.roomId, 'results')

    this.gameTimerService.clearAll(sessionId)
    await this.redisService.client.del(stateKey(sessionId))
    await this.redisService.client.del(sessionKey(loaded.roomId))

    const standings = results.map((r) => ({
      playerId: r.playerId,
      score: r.score,
      placement: r.placement,
    }))
    await this.broadcastToPlayers(loaded.playerIds, 'game:ended', { sessionId, standings })
    await this.requireGateway().broadcastRoomState(loaded.roomId)

    this.scheduleReturnToLobby(loaded.roomId)
  }

  // -------------------------------------------------------------------
  // Disconnect / reconnect (called by presence via RealtimeGateway)
  // -------------------------------------------------------------------

  /** Locked for its entire body, same as `dispatch`/`start`/`handleTimer` —
   * `pauseForDisconnect` is its own load -> reduce -> persist -> broadcast
   * sequence and must not interleave with a concurrent `game:action` (or
   * another disconnect/reconnect) for the same room. Called from
   * `RealtimeGateway.markDisconnectedIfLastSocket`, which does NOT hold
   * `lockKey(roomId)` itself when it calls this — so acquiring it here is
   * the only place it happens for this path, not a nested second
   * acquisition of a lock some caller up the stack already holds. */
  async pauseForDisconnect(roomId: RoomId, userId: UserId): Promise<void> {
    await this.redisService.withLock(lockKey(roomId), () =>
      this.doPauseForDisconnect(roomId, userId),
    )
  }

  private async doPauseForDisconnect(roomId: RoomId, userId: UserId): Promise<void> {
    const loaded = await this.tryLoadActiveGame(roomId)
    if (!loaded?.definition.pause) return // no active game, or nothing this game can pause

    const view = loaded.definition.view(loaded.state, userId)
    if (!this.isWaitingOn(view, userId)) return

    const effect = loaded.definition.pause(loaded.state, this.now())
    await this.applyEffect(loaded, effect)
  }

  /** Locked for its entire body — see `pauseForDisconnect`'s doc comment.
   * Called from `RealtimeGateway.onRoomJoin` AFTER that handler's own
   * `withLock(lockKey(roomId), () => this.roomsService.join(...))` call has
   * already resolved and released — not nested inside it — so acquiring the
   * same room's lock again here is a fresh, sequential acquisition, never a
   * re-entrant one. */
  async resumeAfterReconnect(roomId: RoomId, userId: UserId): Promise<void> {
    await this.redisService.withLock(lockKey(roomId), () =>
      this.doResumeAfterReconnect(roomId, userId),
    )
  }

  private async doResumeAfterReconnect(roomId: RoomId, userId: UserId): Promise<void> {
    const loaded = await this.tryLoadActiveGame(roomId)
    if (!loaded?.definition.resume) return

    // Gated the same way as pauseForDisconnect, on purpose: `view()` still
    // reports the paused turn's explainer as `explainerId` (pausing only
    // touches the round's clock, not who is explaining), so this correctly
    // resumes only when the RECONNECTING player is the one the game was
    // actually waiting on — not on every unrelated join/reconnect in the
    // room, which would otherwise resume a turn while the player it is
    // actually waiting on is still disconnected.
    const view = loaded.definition.view(loaded.state, userId)
    if (!this.isWaitingOn(view, userId)) return

    const effect = loaded.definition.resume(loaded.state, this.now())
    await this.applyEffect(loaded, effect)
  }

  /** Called by `RealtimeGateway.handleMemberRemoved` once a room's member
   * list is empty (self-leave, kick, ban, or a presence-grace eviction all
   * funnel through that one method). Cancels a pending `results -> lobby`
   * timer if one was scheduled, and — if a game session is still active for
   * this room — clears its in-process timers and Redis state without
   * writing `GameResult` rows (an emptied room did not "finish" its game
   * the way `finish()` means it; it was abandoned). */
  async handleRoomEmptied(roomId: RoomId): Promise<void> {
    this.cancelLobbyReturn(roomId)

    const sessionId = await this.redisService.client.get(sessionKey(roomId))
    if (!sessionId) return

    this.gameTimerService.clearAll(sessionId)
    await this.redisService.client.del(stateKey(sessionId))
    await this.redisService.client.del(sessionKey(roomId))
    await this.gameSessionModel.update(
      { endedAt: new Date() },
      { where: { id: sessionId, endedAt: null } },
    )
  }

  /** Public so a snapshot can be read for diagnostics/tests without
   * exposing the whole `LoadedGame` shape. Returns just the reducer's own
   * `state` (not the envelope) — that is the value the "state unchanged
   * after a rejected action" invariant is actually about. */
  async snapshot(sessionId: SessionId): Promise<unknown> {
    const loaded = await this.loadGame(sessionId)
    return loaded.state
  }

  /** Task 18's one hook into this service's session state: tells
   * `RealtimeGateway` whether `roomId` currently has a running Crocodile
   * session and, if so, who is explaining right now — the entire
   * authorization boundary for `draw:stroke` (only the returned
   * `explainerId`, and only while `active` is true) and the trigger for
   * `draw:sync` on `room:join` (any non-null result, active or not: a
   * between-rounds/preparing joiner should still catch up on strokes drawn
   * so far, even though nobody may draw again until the round becomes
   * active). Returns `null` for "no Crocodile session is running in this
   * room" — no session at all, a different game, or the session already
   * finished — which covers every one of the brief's "not accepted" cases
   * (not a member of an active session, another game running, still in the
   * lobby) in one check: none of those states ever produces a `LoadedGame`
   * with `gameId === 'crocodile'` here.
   *
   * `explainerId` on a word view is visible to every viewer (unlike
   * `secretWord`, which is masked per-player — see `buildWordGameView`), so
   * this can safely read it off any one of `loaded.playerIds`' own view
   * rather than needing the specific caller's id. */
  async getCrocodileDrawContext(
    roomId: RoomId,
  ): Promise<{ active: boolean; explainerId: PlayerId | null } | null> {
    const loaded = await this.tryLoadActiveGame(roomId)
    if (loaded?.gameId !== 'crocodile') return null
    const anyPlayerId = loaded.playerIds[0] ?? SYSTEM_ACTOR
    const view = loaded.definition.view(loaded.state, anyPlayerId)
    if (view.kind !== 'word') return null
    return { active: view.phase === 'active', explainerId: view.explainerId }
  }

  onModuleDestroy(): void {
    for (const timer of this.lobbyReturnTimers.values()) {
      clearTimeout(timer)
    }
    this.lobbyReturnTimers.clear()
  }

  // -------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------

  /**
   * The ONLY place this service calls `getGameDefinition`. Every other
   * method that needs to run a reducer receives a `LoadedGame` — `definition`
   * and `state` bundled together, both sourced from the one JSON blob this
   * method just parsed — rather than independently looking up "a
   * definition" and "some state" from two different variables that could,
   * through a future edit, drift apart. That is what makes a session's
   * state reaching the wrong game's reducer structurally impossible rather
   * than merely something later code is expected to get right: there is no
   * second code path in this file that could pair them incorrectly, because
   * there is no second place a `GameDefinition` value comes from at all.
   */
  private async loadGame(sessionId: SessionId): Promise<LoadedGame> {
    const raw = await this.redisService.client.get(stateKey(sessionId))
    if (!raw) {
      throw new Error(`No active game state for session ${sessionId}`)
    }
    const snapshot = JSON.parse(raw) as StoredSnapshot
    const definition = getGameDefinition(snapshot.gameId)
    return {
      sessionId,
      roomId: snapshot.roomId,
      gameId: snapshot.gameId,
      playerIds: snapshot.playerIds,
      actionCount: snapshot.actionCount,
      definition,
      state: snapshot.state,
    }
  }

  /** Resolves `roomId -> active sessionId -> LoadedGame`, or `null` if
   * either hop comes up empty (no session recorded for this room, or its
   * Redis snapshot has already been cleared) — the common "is a game even
   * running here" check shared by `dispatch`/`pauseForDisconnect`/
   * `resumeAfterReconnect`. */
  private async tryLoadActiveGame(roomId: RoomId): Promise<LoadedGame | null> {
    const sessionId = await this.redisService.client.get(sessionKey(roomId))
    if (!sessionId) return null
    return this.loadGame(sessionId).catch(() => null)
  }

  private async applyEffect(
    loaded: LoadedGame,
    effect: Effect<unknown>,
    actionCountDelta = 0,
  ): Promise<void> {
    await this.persistState(loaded, effect.state, actionCountDelta)
    this.applyTimers(loaded.roomId, loaded.sessionId, effect.timers)

    for (const event of effect.events) {
      await this.broadcastToPlayers(loaded.playerIds, 'game:event', event)
      // Task 18's drawing channel is deliberately outside this reducer's own
      // state (see `GameSocketGateway.clearDrawing`'s doc comment) — a new
      // Crocodile turn starting is the one moment that channel must be
      // wiped for every viewer, not just future joiners, so the next
      // explainer starts on a blank canvas rather than the previous
      // explainer's leftover lines.
      if (loaded.gameId === 'crocodile' && event.type === 'round_started') {
        await this.requireGateway().clearDrawing(loaded.roomId)
      }
    }
    await this.broadcastStateToPlayers(loaded.playerIds, loaded.definition, effect.state)

    if (effect.finished) {
      await this.doFinish(loaded.sessionId)
    }
  }

  private async persistState(
    loaded: LoadedGame,
    newState: unknown,
    actionCountDelta: number,
  ): Promise<void> {
    const snapshot: StoredSnapshot = {
      roomId: loaded.roomId,
      gameId: loaded.gameId,
      playerIds: loaded.playerIds,
      actionCount: loaded.actionCount + actionCountDelta,
      state: newState,
    }
    await this.redisService.client.set(stateKey(loaded.sessionId), JSON.stringify(snapshot))
    await this.gameSessionModel.update(
      { state: newState as Record<string, unknown> },
      { where: { id: loaded.sessionId } },
    )
  }

  private applyTimers(
    roomId: RoomId,
    sessionId: SessionId,
    timers: Effect<unknown>['timers'],
  ): void {
    if (!timers) return
    for (const op of timers) {
      if (op.op === 'set') {
        this.gameTimerService.set(sessionId, op.id, op.delayMs ?? 0, () => {
          this.handleTimer(roomId, sessionId, op.id).catch((err: unknown) => {
            this.logger.error(`handleTimer failed for session ${sessionId}: ${errorMessage(err)}`)
          })
        })
      } else {
        this.gameTimerService.clear(sessionId, op.id)
      }
    }
  }

  private async broadcastToPlayers<E extends keyof ServerToClientEvents>(
    playerIds: PlayerId[],
    event: E,
    payload: Parameters<ServerToClientEvents[E]>[0],
  ): Promise<void> {
    const gateway = this.requireGateway()
    await Promise.all(playerIds.map((playerId) => gateway.emitToUser(playerId, event, payload)))
  }

  /** Pushes a personalised `view(state, playerId)` to every player — never
   * the raw state, never one shared payload every player receives alike. */
  private async broadcastStateToPlayers(
    playerIds: PlayerId[],
    definition: GameDefinition,
    state: unknown,
  ): Promise<void> {
    const gateway = this.requireGateway()
    await Promise.all(
      playerIds.map((playerId) =>
        gateway.emitToUser(playerId, 'game:state', definition.view(state, playerId)),
      ),
    )
  }

  private async buildDeck(
    gameId: GameId,
    engine: 'word' | 'card',
    seed: number,
  ): Promise<string[] | undefined> {
    if (engine !== 'word') return undefined
    // Ambiguity resolution (see this task's report): word games take the
    // 'general' deck except Crocodile, which takes 'crocodile'. Language
    // comes from the room in principle, but there is no per-room locale yet
    // — defaults to 'uk' until a future task surfaces one.
    const category = gameId === 'crocodile' ? 'crocodile' : 'general'
    const words = await this.wordDeckService.loadDeck(category, DEFAULT_LOCALE)
    // The word-engine's own contract: "the deck is supplied already
    // shuffled by the caller" — this service is that caller, using the same
    // seed handed to `definition.init` so a session's deck order is
    // reproducible from its own seed.
    return createRng(seed).shuffle(words)
  }

  private isWaitingOn(view: PlayerView, userId: PlayerId): boolean {
    if (view.kind === 'word') {
      return view.phase === 'active' && view.explainerId === userId
    }
    return view.turnPlayerId === userId || view.defenderId === userId
  }

  private scheduleReturnToLobby(roomId: RoomId): void {
    this.cancelLobbyReturn(roomId)
    const timer = setTimeout(() => {
      this.lobbyReturnTimers.delete(roomId)
      this.returnToLobby(roomId).catch((err: unknown) => {
        this.logger.error(`returnToLobby failed for room ${roomId}: ${errorMessage(err)}`)
      })
    }, RESULTS_TO_LOBBY_MS)
    this.lobbyReturnTimers.set(roomId, timer)
  }

  /** Cancels a pending `results -> lobby` timer without firing it — called
   * both by `handleRoomEmptied` (a room that empties during the 8s results
   * window must not leave this timer orphaned, trying to broadcast state to
   * a room nobody is in) and internally before scheduling a fresh one. */
  private cancelLobbyReturn(roomId: RoomId): void {
    const existing = this.lobbyReturnTimers.get(roomId)
    if (existing) {
      clearTimeout(existing)
      this.lobbyReturnTimers.delete(roomId)
    }
  }

  private async returnToLobby(roomId: RoomId): Promise<void> {
    await this.roomsService.setStatus(roomId, 'lobby')
    await this.requireGateway().broadcastRoomState(roomId)
  }

  private requireGateway(): GameSocketGateway {
    if (!this.gateway) {
      throw new Error('GameRuntimeService: gateway not wired — call setGateway() first')
    }
    return this.gateway
  }

  private now(): number {
    return Date.now()
  }

  private nextSeed(): number {
    return randomInt(SEED_UPPER_BOUND)
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
