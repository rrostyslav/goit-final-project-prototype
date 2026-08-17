export interface Rng {
  /** Next float in [0, 1). */
  next(): number
  /** Next integer in [0, maxExclusive). */
  int(maxExclusive: number): number
  /** New shuffled array; does not mutate `items`. */
  shuffle<T>(items: T[]): T[]
}

/**
 * mulberry32 PRNG. Deterministic: the same seed always produces the same
 * sequence. Never falls back to Math.random() or any other I/O — this is
 * what lets game reducers stay pure while still needing randomness.
 */
export function createRng(seed: number): Rng {
  let state = seed >>> 0

  const next = (): number => {
    state = (state + 0x6d2b79f5) | 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  const int = (maxExclusive: number): number => Math.floor(next() * maxExclusive)

  const shuffle = <T>(items: T[]): T[] => {
    const result = [...items]
    for (let i = result.length - 1; i > 0; i--) {
      const j = int(i + 1)
      const a = result[i] as T
      const b = result[j] as T
      result[i] = b
      result[j] = a
    }
    return result
  }

  return { next, int, shuffle }
}
