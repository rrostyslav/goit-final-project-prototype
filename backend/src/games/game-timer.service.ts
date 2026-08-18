import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common'

/**
 * In-process timer bookkeeping for game sessions. A reducer's `Effect.timers`
 * only ever says "set/clear a timer named `id` for this session" — it never
 * touches `setTimeout` itself (reducers must stay pure, no I/O). This service
 * is the one place that turns those declarative ops into real timers, and the
 * one place that owns clearing them.
 *
 * Timers live in process memory, keyed by session id, then by the reducer's
 * own timer id (e.g. `'round'` for a word game's turn clock) so two
 * unrelated sessions — or two differently-named timers on the same session —
 * never collide or clear each other.
 *
 * KNOWN LIMITATION (documented, not hidden): this is plain in-memory
 * bookkeeping. It does not survive a process restart, and it is not shared
 * across horizontally-scaled backend instances — a timer set on one instance
 * only ever fires on that same instance. Acceptable for this prototype
 * (mirrors `PresenceService`'s same in-memory, single-instance limitation
 * from Task 15); a production build would need a durable/shared scheduler
 * (e.g. a Redis-backed delayed job queue) instead.
 */
@Injectable()
export class GameTimerService implements OnModuleDestroy {
  private readonly logger = new Logger(GameTimerService.name)
  private readonly timers = new Map<string, Map<string, NodeJS.Timeout>>()

  /** Arms a timer named `timerId` for `sessionId`, firing `cb` after
   * `delayMs`. Replaces any existing timer of the same (sessionId, timerId)
   * pair first — a reducer that emits `{ op: 'set', id: 'round', ... }`
   * twice for the same turn (e.g. a defensive re-arm) must never leave the
   * first timer still ticking alongside the second. */
  set(sessionId: string, timerId: string, delayMs: number, cb: () => void): void {
    this.clear(sessionId, timerId)
    const timer = setTimeout(() => {
      this.timers.get(sessionId)?.delete(timerId)
      cb()
    }, delayMs)
    let sessionTimers = this.timers.get(sessionId)
    if (!sessionTimers) {
      sessionTimers = new Map()
      this.timers.set(sessionId, sessionTimers)
    }
    sessionTimers.set(timerId, timer)
  }

  /** Cancels one named timer for one session. A no-op if it was never set
   * (already fired, or `clear` for a timer id the reducer never armed) —
   * callers are not expected to check existence first. */
  clear(sessionId: string, timerId: string): void {
    const sessionTimers = this.timers.get(sessionId)
    const timer = sessionTimers?.get(timerId)
    if (timer) {
      clearTimeout(timer)
      sessionTimers?.delete(timerId)
    }
  }

  /** Cancels every timer for `sessionId`. Called by `GameRuntimeService` when
   * a session ends (naturally via `finish`, or abandoned when its room
   * empties) so nothing keeps a finished/abandoned session's callbacks
   * pending. */
  clearAll(sessionId: string): void {
    const sessionTimers = this.timers.get(sessionId)
    if (!sessionTimers) return
    for (const timer of sessionTimers.values()) {
      clearTimeout(timer)
    }
    this.timers.delete(sessionId)
  }

  /** Cancels every timer for every session on application shutdown, so a
   * `pnpm test` / dev-server restart never leaves a stray `setTimeout`
   * keeping the process alive or firing into a torn-down app context. */
  onModuleDestroy(): void {
    const sessionIds = [...this.timers.keys()]
    for (const sessionId of sessionIds) {
      this.clearAll(sessionId)
    }
    if (sessionIds.length > 0) {
      this.logger.log(`cleared timers for ${sessionIds.length} session(s) on shutdown`)
    }
  }
}
