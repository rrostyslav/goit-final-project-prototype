import type Redis from 'ioredis'
import { RedisService } from '../src/redis/redis.service'

interface FakeRedisClient {
  incr: jest.Mock
  pexpire: jest.Mock
}

// Bypasses RedisService's constructor (which opens a real ioredis TCP
// connection and initializes the private `logger` field) and installs a
// fake client and a no-op logger directly, mirroring the
// `as unknown as typeof Model` fake-injection style used throughout the
// other *.service.spec.ts files in this suite.
function createServiceWithClient(client: FakeRedisClient): RedisService {
  const service = Object.create(RedisService.prototype) as RedisService
  Object.assign(service, { client: client as unknown as Redis, logger: { warn: jest.fn() } })
  return service
}

function createFakeRedisClient(): FakeRedisClient {
  const counts = new Map<string, number>()
  return {
    incr: jest.fn(async (key: string) => {
      const next = (counts.get(key) ?? 0) + 1
      counts.set(key, next)
      return next
    }),
    pexpire: jest.fn(async () => 1),
  }
}

describe('RedisService', () => {
  describe('rateLimit', () => {
    it('allows calls while the count stays at or below max', async () => {
      const client = createFakeRedisClient()
      const service = createServiceWithClient(client)

      expect(await service.rateLimit('key', 3, 1000)).toBe(true)
      expect(await service.rateLimit('key', 3, 1000)).toBe(true)
      expect(await service.rateLimit('key', 3, 1000)).toBe(true)
      expect(client.pexpire).toHaveBeenCalledTimes(1)
    })

    it('blocks once the count exceeds max', async () => {
      const client = createFakeRedisClient()
      const service = createServiceWithClient(client)

      await service.rateLimit('key', 1, 1000)
      expect(await service.rateLimit('key', 1, 1000)).toBe(false)
    })

    // Finding: with ioredis's default retry behaviour, an unhandled Redis
    // outage makes `incr` throw, turning room creation into an uncaught
    // 500. The fix fails OPEN — a rate limiter guarding a non-critical
    // action must not take the action down when its backing store is gone.
    it('fails open (returns true) when the Redis client throws', async () => {
      const client: FakeRedisClient = {
        incr: jest.fn().mockRejectedValue(new Error('ECONNREFUSED')),
        pexpire: jest.fn(),
      }
      const service = createServiceWithClient(client)

      await expect(service.rateLimit('key', 5, 1000)).resolves.toBe(true)
      expect(client.pexpire).not.toHaveBeenCalled()
    })
  })
})
