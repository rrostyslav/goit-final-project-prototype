import { randomUUID } from 'node:crypto'
import { Injectable, Logger, type OnApplicationShutdown } from '@nestjs/common'
import Redis from 'ioredis'
import { AppConfigService } from '../config/env.config'

const LOCK_KEY_PREFIX = 'lock:'
const LOCK_TTL_MS = 10_000
const LOCK_ACQUIRE_TIMEOUT_MS = 5_000
const LOCK_RETRY_DELAY_MS = 50

// Only releases the lock if it is still held by the caller that acquired
// it (token match) — without this a slow caller whose lock already expired
// could delete a different caller's now-active lock.
const RELEASE_LOCK_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end
`

// Minimal Redis wiring for Task 9's rate limiter, extended by Task 15 with
// a dedicated `subscriber` connection (for the Socket.IO Redis adapter) and
// a `withLock` helper (for serializing room mutations across gateway
// instances) — additive on top of Task 9's `client` + `rateLimit`.
@Injectable()
export class RedisService implements OnApplicationShutdown {
  private readonly logger = new Logger(RedisService.name)

  readonly client: Redis
  /** Dedicated connection for the Socket.IO Redis adapter's subscribe side.
   * Kept separate from `client` because a connection actively SUBSCRIBEd
   * cannot issue ordinary commands — `client` remains free for `rateLimit`,
   * `withLock` and the adapter's own publish side. */
  readonly subscriber: Redis

  constructor(config: AppConfigService) {
    this.client = new Redis(config.redisUrl)
    this.subscriber = this.client.duplicate()
  }

  /** Fixed-window rate limiter: allows up to `max` calls per `key` within a
   * rolling `windowMs` window, using a single INCR + PEXPIRE per call.
   * Returns `true` when the caller is within the limit (the action may
   * proceed), `false` once `max` has been exceeded for the current window.
   *
   * Deliberate choice: fails OPEN. This limiter only guards a non-critical
   * action (room-creation spam); with ioredis's default retry behaviour, an
   * unhandled Redis outage would surface as an uncaught 500 on room
   * creation. Losing the ability to rate-limit for the duration of a Redis
   * outage is a far smaller problem than losing the ability to create rooms
   * at all, so a Redis error is logged and treated as "allow". */
  async rateLimit(key: string, max: number, windowMs: number): Promise<boolean> {
    try {
      const count = await this.client.incr(key)
      if (count === 1) {
        await this.client.pexpire(key, windowMs)
      }
      return count <= max
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this.logger.warn(`rateLimit: Redis error, failing open for key "${key}": ${message}`)
      return true
    }
  }

  /** Best-effort distributed mutex: serializes concurrent callers across
   * every gateway instance sharing the same `key` (callers pass a plain
   * semantic key, e.g. `room:${roomId}`; this method adds the `lock:`
   * namespace prefix itself). Mirrors `rateLimit`'s fail-open philosophy —
   * if the lock cannot be acquired within `LOCK_ACQUIRE_TIMEOUT_MS` (heavy
   * contention, or Redis itself unreachable), `fn` still runs rather than
   * the caller hanging or the request failing outright; for a prototype-
   * scale room action, a rare missed lock is a smaller problem than every
   * room mutation becoming unavailable whenever Redis hiccups. */
  async withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const lockKey = `${LOCK_KEY_PREFIX}${key}`
    const token = randomUUID()
    const acquired = await this.acquireLock(lockKey, token)
    try {
      return await fn()
    } finally {
      if (acquired) {
        await this.releaseLock(lockKey, token)
      }
    }
  }

  private async acquireLock(lockKey: string, token: string): Promise<boolean> {
    const deadline = Date.now() + LOCK_ACQUIRE_TIMEOUT_MS
    try {
      do {
        const result = await this.client.set(lockKey, token, 'PX', LOCK_TTL_MS, 'NX')
        if (result === 'OK') {
          return true
        }
        await sleep(LOCK_RETRY_DELAY_MS)
      } while (Date.now() < deadline)
      this.logger.warn(`withLock: timed out acquiring lock "${lockKey}", proceeding without it`)
      return false
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this.logger.warn(
        `withLock: Redis error acquiring lock "${lockKey}", proceeding without it: ${message}`,
      )
      return false
    }
  }

  private async releaseLock(lockKey: string, token: string): Promise<void> {
    try {
      await this.client.eval(RELEASE_LOCK_SCRIPT, 1, lockKey, token)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this.logger.warn(`withLock: failed to release lock "${lockKey}": ${message}`)
    }
  }

  /** Deliberately `OnApplicationShutdown`, not `OnModuleDestroy`: NestJS's own
   * `NestApplicationContext.close()` runs every provider's `OnModuleDestroy`
   * hook BEFORE it calls `dispose()` — the step that actually closes the
   * Socket.IO server, which is what triggers `@socket.io/redis-adapter`'s own
   * `RedisAdapter.close()` (a `punsubscribe`/`unsubscribe` against `client`/
   * `subscriber`) for every namespace. `OnApplicationShutdown` hooks run in
   * `callShutdownHook()`, AFTER `dispose()` — so quitting here, not in
   * `OnModuleDestroy`, is what makes these connections still open when the
   * adapter needs them one last time. Getting this backwards was a real,
   * 100%-reproducible bug (not a test-only timing fluke): with the
   * connections quit in `OnModuleDestroy`, EVERY graceful shutdown of this
   * app — not just this task's e2e suite — hit an unhandled "Connection is
   * closed." rejection from the adapter's own cleanup, for both the default
   * `/` namespace and `/rt`. `@nestjs/sequelize`'s own `SequelizeCoreModule`
   * closes its connection the exact same way, for the exact same reason. */
  async onApplicationShutdown(): Promise<void> {
    await Promise.all([this.client.quit(), this.subscriber.quit()])
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
