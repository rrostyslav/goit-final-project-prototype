import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common'
import Redis from 'ioredis'
import { AppConfigService } from '../config/env.config'

// Minimal Redis wiring for Task 9's rate limiter. Task 15 extends this with
// a `subscriber` connection and wires the Socket.IO Redis adapter on top —
// keep this small and stable so that extension is additive, not a rewrite.
@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name)

  readonly client: Redis

  constructor(config: AppConfigService) {
    this.client = new Redis(config.redisUrl)
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

  async onModuleDestroy(): Promise<void> {
    await this.client.quit()
  }
}
