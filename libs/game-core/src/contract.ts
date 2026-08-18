import type { GameAction, GameEvent, GameId, GameMeta, PlayerId, PlayerView } from '@gp/shared'

/** Input to a definition's init(). Everything a reducer needs, supplied by the caller. */
export interface InitContext {
  players: PlayerId[]
  seed: number
  options: Record<string, unknown>
  deck?: string[]
  now: number
}

/** Input to a definition's reduce()/onTimer(). No hidden clocks or randomness. */
export interface ActionContext {
  actorId: PlayerId
  now: number
  seed: number
}

export interface TimerOp {
  op: 'set' | 'clear'
  id: string
  delayMs?: number
}

export interface Effect<S> {
  state: S
  events: GameEvent[]
  timers?: TimerOp[]
  finished?: boolean
}

export interface GameResultRow {
  playerId: PlayerId
  score: number
  placement: number
}

/**
 * Contract every game engine implements. Reducers must be pure: no Date.now(),
 * no Math.random(), no I/O. Time and randomness arrive only through InitContext /
 * ActionContext, which keeps rules unit-testable and consistent across backend
 * instances.
 */
export interface GameDefinition<S = unknown, A = GameAction> {
  id: GameId
  meta: GameMeta
  init(ctx: InitContext): S
  reduce(state: S, action: A, ctx: ActionContext): Effect<S>
  onTimer(state: S, timerId: string, ctx: ActionContext): Effect<S>
  /** The only channel from state to a client. Must hide what viewerId must not see. */
  view(state: S, viewerId: PlayerId): PlayerView
  results(state: S): GameResultRow[]
  /**
   * Optional: freezes/restores whatever clock this game runs (e.g. a word
   * game's round timer) when the player it is waiting on disconnects or
   * reconnects (Task 16's `GameRuntimeService.pauseForDisconnect` /
   * `resumeAfterReconnect`). Games with no clock (Durak, Nine — turn-based,
   * no timeout) do not implement these; a caller must treat a missing
   * `pause`/`resume` pair as "this game has nothing to pause", not an error.
   * Still pure — `now` arrives from the caller, same as every other method
   * here — and still returns an `Effect<S>` so timers/events flow through
   * the same pipeline as `reduce`/`onTimer`.
   */
  pause?(state: S, now: number): Effect<S>
  resume?(state: S, now: number): Effect<S>
}

/** Thrown by a reducer for a rejected action. `code` is machine-readable. */
export class InvalidActionError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'InvalidActionError'
  }
}
