import { Injectable, type OnModuleDestroy } from '@nestjs/common'
import Redis from 'ioredis'
import { AppConfigService } from '../config/env.config'

// Minimal Redis wiring for Task 9's rate limiter. Task 15 extends this with
// a `subscriber` connection and wires the Socket.IO Redis adapter on top —
// keep this small and stable so that extension is additive, not a rewrite.
@Injectable()
export class RedisService implements OnModuleDestroy {
  readonly client: Redis

  constructor(config: AppConfigService) {
    this.client = new Redis(config.redisUrl)
  }

  /** Fixed-window rate limiter: allows up to `max` calls per `key` within a
   * rolling `windowMs` window, using a single INCR + PEXPIRE per call.
   * Returns `true` when the caller is within the limit (the action may
   * proceed), `false` once `max` has been exceeded for the current window. */
  async rateLimit(key: string, max: number, windowMs: number): Promise<boolean> {
    const count = await this.client.incr(key)
    if (count === 1) {
      await this.client.pexpire(key, windowMs)
    }
    return count <= max
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.quit()
  }
}
