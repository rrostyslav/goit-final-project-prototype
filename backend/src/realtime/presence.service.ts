import type { ConnectionState } from '@gp/shared'
import { RECONNECT_GRACE_MS } from '@gp/shared'
import { Injectable, Logger } from '@nestjs/common'

type EvictionHandler = (roomId: string, userId: string) => Promise<void>

interface PresenceEntry {
  state: ConnectionState
  lastSocketId: string
  timer: ReturnType<typeof setTimeout> | null
}

/** Tracks live socket presence per (room, user) pair and runs the
 * reconnect-grace eviction described in Task 15's brief: a socket drop
 * marks the member `'disconnected'` but keeps them in the room for
 * `RECONNECT_GRACE_MS`, giving the eviction callback a chance to be
 * cancelled by a timely reconnect.
 *
 * This service intentionally has no knowledge of sockets or rooms-with-
 * multiple-tabs — `markOnline`/`markDisconnected` take no socket id beyond
 * bookkeeping, so it is `RealtimeGateway`'s job to decide, across a user's
 * possibly-multiple open sockets in one room, when the *last* one has
 * actually dropped before calling `markDisconnected`. Wholly in-memory and
 * per-process: presence is not shared across horizontally-scaled gateway
 * instances (see Task 15's report for the reasoning). */
@Injectable()
export class PresenceService {
  private readonly logger = new Logger(PresenceService.name)
  private readonly entries = new Map<string, PresenceEntry>()
  private evictionHandler: EvictionHandler = async () => {}

  /** Wired by `RealtimeModule` (not by this service) so the handler can
   * depend on `RoomsService` and `RealtimeGateway` without a circular
   * dependency back into this module. */
  setEvictionHandler(fn: EvictionHandler): void {
    this.evictionHandler = fn
  }

  markOnline(roomId: string, userId: string, socketId: string): void {
    const key = presenceKey(roomId, userId)
    this.clearTimer(key)
    this.entries.set(key, { state: 'online', lastSocketId: socketId, timer: null })
  }

  /** Starts a `RECONNECT_GRACE_MS` timer; if it is not cancelled by a
   * subsequent `markOnline` or `cancelEviction` before it fires, the
   * eviction handler is invoked with `(roomId, userId)`. */
  markDisconnected(roomId: string, userId: string): void {
    const key = presenceKey(roomId, userId)
    this.clearTimer(key)
    const existing = this.entries.get(key)
    const timer = setTimeout(() => {
      this.entries.delete(key)
      Promise.resolve(this.evictionHandler(roomId, userId)).catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err)
        this.logger.error(`eviction handler failed for room ${roomId}, user ${userId}: ${message}`)
      })
    }, RECONNECT_GRACE_MS)
    this.entries.set(key, {
      state: 'disconnected',
      lastSocketId: existing?.lastSocketId ?? '',
      timer,
    })
  }

  /** Cancels any pending eviction timer for this pair without asserting a
   * particular resulting state — used when a member is removed from the
   * room through some other path (explicit leave, kick, ban) so no stray
   * timer lingers behind. */
  cancelEviction(roomId: string, userId: string): void {
    const key = presenceKey(roomId, userId)
    this.clearTimer(key)
    this.entries.delete(key)
  }

  getConnection(roomId: string, userId: string): ConnectionState {
    return this.entries.get(presenceKey(roomId, userId))?.state ?? 'online'
  }

  private clearTimer(key: string): void {
    const existing = this.entries.get(key)
    if (existing?.timer) {
      clearTimeout(existing.timer)
    }
  }
}

function presenceKey(roomId: string, userId: string): string {
  return `${roomId}:${userId}`
}
