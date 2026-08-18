import type { DrawStroke } from '@gp/shared'
import { DRAW_STROKE_LOG_LIMIT } from '@gp/shared'
import { BadRequestException } from '@nestjs/common'
import type Redis from 'ioredis'
import {
  DRAW_STROKE_MAX_COLOR_LENGTH,
  DRAW_STROKE_MAX_COORD,
  DRAW_STROKE_MAX_POINTS,
  DRAW_STROKE_MAX_WIDTH,
  DRAW_STROKE_MIN_COORD,
  DRAW_STROKE_MIN_WIDTH,
  DrawingService,
} from '../src/realtime/drawing.service'
import type { RedisService } from '../src/redis/redis.service'

// ---------------------------------------------------------------------------
// A minimal in-memory stand-in for the slice of ioredis's list API
// DrawingService actually calls — mirrors the fake-client style already used
// in redis.service.spec.ts / game-runtime.service.spec.ts.
// ---------------------------------------------------------------------------

function createFakeRedisClient() {
  const lists = new Map<string, string[]>()
  const ttls = new Map<string, number>()
  return {
    lists,
    ttls,
    async rpush(key: string, value: string): Promise<number> {
      const list = lists.get(key) ?? []
      list.push(value)
      lists.set(key, list)
      return list.length
    },
    async ltrim(key: string, start: number, stop: number): Promise<'OK'> {
      const list = lists.get(key) ?? []
      const len = list.length
      const normalize = (i: number) => (i < 0 ? Math.max(len + i, 0) : Math.min(i, len))
      const from = normalize(start)
      // Redis LTRIM's stop is inclusive; slice's end is exclusive.
      const to = stop < 0 ? len + stop + 1 : Math.min(stop + 1, len)
      lists.set(key, list.slice(from, Math.max(from, to)))
      return 'OK'
    },
    async expire(key: string, seconds: number): Promise<number> {
      ttls.set(key, seconds)
      return 1
    },
    async lrange(key: string, start: number, stop: number): Promise<string[]> {
      const list = lists.get(key) ?? []
      const len = list.length
      const normalize = (i: number) => (i < 0 ? Math.max(len + i, 0) : Math.min(i, len))
      const from = normalize(start)
      const to = stop < 0 ? len + stop + 1 : Math.min(stop + 1, len)
      return list.slice(from, Math.max(from, to))
    },
    async del(key: string): Promise<number> {
      return lists.delete(key) ? 1 : 0
    },
  }
}

function createService(client: ReturnType<typeof createFakeRedisClient>): DrawingService {
  const redisService = { client: client as unknown as Redis } as unknown as RedisService
  return new DrawingService(redisService)
}

function stroke(overrides: Partial<DrawStroke> = {}): DrawStroke {
  return {
    points: [
      [0, 0],
      [1, 1],
    ],
    color: '#ff0000',
    width: 4,
    ...overrides,
  }
}

describe('DrawingService', () => {
  describe('append / getAll', () => {
    it('round-trips a valid stroke', async () => {
      const client = createFakeRedisClient()
      const service = createService(client)
      const s = stroke()

      await service.append('r1', s)

      expect(await service.getAll('r1')).toEqual([s])
    })

    it('keeps strokes for different rooms independent', async () => {
      const client = createFakeRedisClient()
      const service = createService(client)
      await service.append('r1', stroke({ color: 'red' }))
      await service.append('r2', stroke({ color: 'blue' }))

      expect(await service.getAll('r1')).toEqual([stroke({ color: 'red' })])
      expect(await service.getAll('r2')).toEqual([stroke({ color: 'blue' })])
    })

    it('sets a 2 hour TTL on every append', async () => {
      const client = createFakeRedisClient()
      const service = createService(client)
      await service.append('r1', stroke())
      expect(client.ttls.get('draw:r1')).toBe(2 * 60 * 60)
    })

    it('trims the log to DRAW_STROKE_LOG_LIMIT, keeping the most recent strokes', async () => {
      const client = createFakeRedisClient()
      const service = createService(client)

      for (let i = 0; i < DRAW_STROKE_LOG_LIMIT + 5; i++) {
        await service.append('r1', stroke({ points: [[i, i]] }))
      }

      const all = await service.getAll('r1')
      expect(all).toHaveLength(DRAW_STROKE_LOG_LIMIT)
      // The oldest 5 strokes (index 0..4) were trimmed off; the log starts
      // at index 5 and ends at the very last one appended.
      expect(all[0]?.points[0]?.[0]).toBe(5)
      expect(all[all.length - 1]?.points[0]?.[0]).toBe(DRAW_STROKE_LOG_LIMIT + 4)
    })
  })

  describe('clear', () => {
    it('empties the log for a room', async () => {
      const client = createFakeRedisClient()
      const service = createService(client)
      await service.append('r1', stroke())

      await service.clear('r1')

      expect(await service.getAll('r1')).toEqual([])
    })

    it('is a no-op for a room with no strokes', async () => {
      const client = createFakeRedisClient()
      const service = createService(client)
      await expect(service.clear('empty-room')).resolves.toBeUndefined()
    })
  })

  describe('stroke validation', () => {
    it('rejects a stroke with an empty points array', async () => {
      const service = createService(createFakeRedisClient())
      await expect(service.append('r1', stroke({ points: [] }))).rejects.toBeInstanceOf(
        BadRequestException,
      )
    })

    it(`rejects a stroke with more than ${DRAW_STROKE_MAX_POINTS} points`, async () => {
      const service = createService(createFakeRedisClient())
      const tooMany: [number, number][] = Array.from({ length: DRAW_STROKE_MAX_POINTS + 1 }, () => [
        0, 0,
      ])
      await expect(service.append('r1', stroke({ points: tooMany }))).rejects.toBeInstanceOf(
        BadRequestException,
      )
    })

    it('accepts a stroke at exactly the points limit', async () => {
      const service = createService(createFakeRedisClient())
      const atLimit: [number, number][] = Array.from({ length: DRAW_STROKE_MAX_POINTS }, () => [
        0, 0,
      ])
      await expect(service.append('r1', stroke({ points: atLimit }))).resolves.toEqual(
        stroke({ points: atLimit }),
      )
    })

    it('rejects absurd coordinates (out of bounds)', async () => {
      const service = createService(createFakeRedisClient())
      await expect(
        service.append('r1', stroke({ points: [[DRAW_STROKE_MAX_COORD + 1, 0]] })),
      ).rejects.toBeInstanceOf(BadRequestException)
      await expect(
        service.append('r1', stroke({ points: [[DRAW_STROKE_MIN_COORD - 1, 0]] })),
      ).rejects.toBeInstanceOf(BadRequestException)
    })

    it('rejects non-finite coordinates', async () => {
      const service = createService(createFakeRedisClient())
      await expect(
        service.append('r1', stroke({ points: [[Number.NaN, 0]] })),
      ).rejects.toBeInstanceOf(BadRequestException)
      await expect(
        service.append('r1', stroke({ points: [[Number.POSITIVE_INFINITY, 0]] })),
      ).rejects.toBeInstanceOf(BadRequestException)
    })

    it('rejects a non-string colour', async () => {
      const service = createService(createFakeRedisClient())
      const malformed = { ...stroke(), color: 0xff0000 } as unknown as DrawStroke
      await expect(service.append('r1', malformed)).rejects.toBeInstanceOf(BadRequestException)
    })

    it(`rejects a colour longer than ${DRAW_STROKE_MAX_COLOR_LENGTH} characters`, async () => {
      const service = createService(createFakeRedisClient())
      const longColor = '#'.repeat(DRAW_STROKE_MAX_COLOR_LENGTH + 1)
      await expect(service.append('r1', stroke({ color: longColor }))).rejects.toBeInstanceOf(
        BadRequestException,
      )
    })

    it(`rejects a width outside [${DRAW_STROKE_MIN_WIDTH}, ${DRAW_STROKE_MAX_WIDTH}]`, async () => {
      const service = createService(createFakeRedisClient())
      await expect(
        service.append('r1', stroke({ width: DRAW_STROKE_MIN_WIDTH - 1 })),
      ).rejects.toBeInstanceOf(BadRequestException)
      await expect(
        service.append('r1', stroke({ width: DRAW_STROKE_MAX_WIDTH + 1 })),
      ).rejects.toBeInstanceOf(BadRequestException)
    })

    it('an invalid stroke is never stored', async () => {
      const client = createFakeRedisClient()
      const service = createService(client)
      await expect(service.append('r1', stroke({ points: [] }))).rejects.toBeInstanceOf(
        BadRequestException,
      )
      expect(await service.getAll('r1')).toEqual([])
    })
  })

  // ---------------------------------------------------------------------
  // Review finding: `assertValidStroke` bounded points/color/width but
  // never bounded the wire payload as a whole — a stroke satisfying every
  // one of those checks could still carry an arbitrary extra property of
  // any size, which was `JSON.stringify`'d and broadcast in full. Fixed by
  // (a) rejecting any unexpected top-level key outright and (b) having
  // `append` return a freshly-built canonical object (only `points`,
  // `color`, `width`) rather than the caller's own object, so a caller that
  // broadcasts the return value can never leak more than those three
  // fields regardless of what validation might miss in the future.
  // ---------------------------------------------------------------------
  describe('wire-payload bound (extra properties)', () => {
    it('rejects a stroke carrying an extra top-level property, however large', async () => {
      const client = createFakeRedisClient()
      const service = createService(client)
      // Mirrors the reviewer's live repro: a stroke with otherwise-valid
      // points/color/width plus one huge extra field.
      const malicious = { ...stroke(), evil: 'x'.repeat(500_000) } as unknown as DrawStroke

      await expect(service.append('r1', malicious)).rejects.toBeInstanceOf(BadRequestException)
      // Nothing reached Redis — trivially "only points/color/width", since
      // nothing was stored at all.
      expect(await service.getAll('r1')).toEqual([])
    })

    it('rejects a small, innocuous-looking extra property just as well', async () => {
      const service = createService(createFakeRedisClient())
      const withExtra = { ...stroke(), toolId: 'pencil' } as unknown as DrawStroke
      await expect(service.append('r1', withExtra)).rejects.toBeInstanceOf(BadRequestException)
    })

    it('returns and stores a fresh canonical object, not the caller-supplied one', async () => {
      const client = createFakeRedisClient()
      const service = createService(client)
      const original = stroke()

      const returned = await service.append('r1', original)

      expect(returned).toEqual(original)
      expect(returned).not.toBe(original)
      expect(returned.points).not.toBe(original.points)
      expect(Object.keys(returned).sort()).toEqual(['color', 'points', 'width'])

      // Mutating the caller's object after the call must not reach back
      // into what was already written to Redis or already returned —
      // proving `append` copied the data rather than keeping a live
      // reference to the request payload.
      original.color = 'mutated-after-the-fact'
      const firstPoint = original.points[0]
      if (firstPoint) firstPoint[0] = 999_999

      expect(returned.color).toBe('#ff0000')
      expect(await service.getAll('r1')).toEqual([stroke()])
    })
  })
})
