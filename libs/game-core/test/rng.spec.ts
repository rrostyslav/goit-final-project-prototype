import { describe, expect, it } from 'vitest'
import { createRng } from '../src/rng'

describe('createRng', () => {
  it('produces identical sequences for the same seed', () => {
    const a = createRng(12345)
    const b = createRng(12345)
    expect([a.next(), a.next(), a.next()]).toEqual([b.next(), b.next(), b.next()])
  })

  it('produces different sequences for different seeds', () => {
    expect(createRng(1).next()).not.toBe(createRng(2).next())
  })

  it('shuffle is deterministic and does not mutate the input', () => {
    const input = [1, 2, 3, 4, 5, 6, 7, 8]
    const shuffled = createRng(99).shuffle(input)
    expect(input).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
    expect(shuffled).toEqual(createRng(99).shuffle(input))
    expect([...shuffled].sort((x, y) => x - y)).toEqual(input)
  })

  it('int stays within range', () => {
    const rng = createRng(7)
    for (let i = 0; i < 500; i++) {
      const v = rng.int(10)
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(10)
    }
  })
})
