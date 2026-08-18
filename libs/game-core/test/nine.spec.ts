import type { Card, CardGameView, GameAction, PlayerId } from '@gp/shared'
import { describe, expect, it } from 'vitest'
import type { ActionContext } from '../src/contract'
import { InvalidActionError } from '../src/contract'
import { cardKey } from '../src/engines/card-engine'
import type { NineState } from '../src/games/nine'
import { getGameDefinition } from '../src/registry'

const CTX = (actorId: string, now = 1_000): ActionContext => ({ actorId, now, seed: 42 })

const S = (suit: Card['suit'], rank: Card['rank']): Card => ({ suit, rank })

/**
 * Builds a fully-formed NineState with sensible 2-player defaults, so each
 * rule test only has to override the handful of fields it actually cares
 * about - same rationale as Durak's `makeState` test helper.
 */
function makeState(overrides: Partial<NineState> = {}): NineState {
  const base: NineState = {
    order: ['a', 'b'],
    hands: {
      a: [S('spades', 9), S('spades', 10), S('hearts', 6)],
      b: [S('spades', 8), S('hearts', 9), S('diamonds', 7)],
    },
    layout: [],
    turnPlayerId: 'a',
    finished: [],
    phase: 'active',
  }
  return {
    ...base,
    ...overrides,
    hands: { ...base.hands, ...(overrides.hands ?? {}) },
  }
}

/** Hands + layout must always equal 36 - the whole deck is dealt, nothing held back. */
function totalCardsOf(s: NineState): number {
  const handsTotal = s.order.reduce((sum, p) => sum + (s.hands[p]?.length ?? 0), 0)
  return handsTotal + s.layout.length
}

/** Mirrors the private `isLegalPlay` in nine.ts - an independent oracle for the bot below. */
function isLegalCard(layout: Card[], card: Card): boolean {
  if (layout.length === 0) {
    return card.suit === 'spades' && card.rank === 9
  }
  if (card.rank === 9) {
    return !layout.some((c) => c.suit === card.suit)
  }
  const suitCards = layout.filter((c) => c.suit === card.suit)
  if (suitCards.length === 0) return false
  const ranks = suitCards.map((c) => c.rank)
  const low = Math.min(...ranks)
  const high = Math.max(...ranks)
  return card.rank === low - 1 || card.rank === high + 1
}

/**
 * A simple legal-move bot for driving full games in the property test below:
 * play the first legal card in hand, or pass if none exists. "First legal
 * card" (rather than some cleverer heuristic) is enough here because, unlike
 * Durak, Nine has no way for a bot's own poor choices to create a deadlock -
 * every suit's run can only ever be extended by the exact next rank, so
 * playing *any* legal card always makes real progress.
 */
function botMove(s: NineState): { action: GameAction; actorId: PlayerId } {
  const hand = s.hands[s.turnPlayerId] ?? []
  const playable = hand.find((card) => isLegalCard(s.layout, card))
  if (playable) {
    return { action: { type: 'nine/play', card: playable }, actorId: s.turnPlayerId }
  }
  return { action: { type: 'nine/pass' }, actorId: s.turnPlayerId }
}

const PROPERTY_TEST_SEEDS = Array.from({ length: 20 }, (_, i) => i + 1) // 1..20
const PROPERTY_TEST_PLAYER_COUNTS = [2, 3, 4, 5, 6]
/** Loud failure instead of a hung test suite if a game never reaches 'finished'. */
const MAX_ACTIONS_PER_GAME = 1000

/** Drives one full game to termination via `botMove`, asserting invariants after every action. */
function playFullGame(seed: number, playerCount: number): NineState {
  const def = getGameDefinition('nine')
  const players = Array.from({ length: playerCount }, (_, i) => `p${i + 1}`)
  let s = def.init({ players, seed, options: {}, now: 0 }) as NineState
  expect(totalCardsOf(s)).toBe(36)

  let steps = 0
  while (s.phase !== 'finished') {
    steps++
    if (steps > MAX_ACTIONS_PER_GAME) {
      throw new Error(
        `seed ${seed}, ${playerCount} players: did not finish within ${MAX_ACTIONS_PER_GAME} actions`,
      )
    }

    const { action, actorId } = botMove(s)
    // No action may ever be dispatched for a finished player.
    expect(s.finished).not.toContain(actorId)

    s = def.reduce(s, action, CTX(actorId)).state as NineState
    expect(totalCardsOf(s)).toBe(36)
  }

  return s
}

describe('nine', () => {
  it('deals the whole 36-card deck across all hands with none held back', () => {
    const def = getGameDefinition('nine')
    const s = def.init({ players: ['a', 'b', 'c'], seed: 7, options: {}, now: 0 }) as NineState
    expect(totalCardsOf(s)).toBe(36)
    expect(s.layout).toHaveLength(0)
    // 36 / 3 = 12 exactly - see the next test for the remainder case (5 players).
    expect(s.hands.a).toHaveLength(12)
  })

  it('deals an extra card to earlier players when the count does not divide evenly', () => {
    const def = getGameDefinition('nine')
    const s = def.init({
      players: ['a', 'b', 'c', 'd', 'e'],
      seed: 7,
      options: {},
      now: 0,
    }) as NineState
    expect(totalCardsOf(s)).toBe(36)
    const sizes = ['a', 'b', 'c', 'd', 'e'].map((p) => s.hands[p]?.length ?? 0)
    expect(sizes.reduce((a, b) => a + b, 0)).toBe(36)
    // 36 / 5 = 7.2: exactly one player gets an 8th card, the rest get 7.
    expect(sizes.filter((n) => n === 8)).toHaveLength(1)
    expect(sizes.filter((n) => n === 7)).toHaveLength(4)
  })

  it('the player holding the nine of spades opens', () => {
    const def = getGameDefinition('nine')
    const s = def.init({
      players: ['a', 'b', 'c', 'd'],
      seed: 11,
      options: {},
      now: 0,
    }) as NineState
    const opener = s.order.find((p) =>
      (s.hands[p] ?? []).some((c) => c.suit === 'spades' && c.rank === 9),
    )
    if (!opener) throw new Error('expected someone to hold the nine of spades')
    expect(s.turnPlayerId).toBe(opener)
  })

  it('requires the nine of spades as the opening move', () => {
    const def = getGameDefinition('nine')
    const s = makeState({ layout: [] })
    // 'a' holds spades-9 and spades-10; only spades-9 may open.
    expect(() => def.reduce(s, { type: 'nine/play', card: S('spades', 10) }, CTX('a'))).toThrow(
      InvalidActionError,
    )
    const eff = def.reduce(s, { type: 'nine/play', card: S('spades', 9) }, CTX('a'))
    const next = eff.state as NineState
    expect(next.layout).toEqual([S('spades', 9)])
  })

  it('rejects a card that does not extend a run', () => {
    const def = getGameDefinition('nine')
    const s = makeState({
      layout: [S('spades', 9)],
      hands: { a: [S('hearts', 6)], b: [S('spades', 8)] },
      turnPlayerId: 'a',
    })
    // hearts-6 is not a nine and hearts has no run open yet.
    expect(() => def.reduce(s, { type: 'nine/play', card: S('hearts', 6) }, CTX('a'))).toThrow(
      InvalidActionError,
    )
  })

  it('extends a run adjacent to the low or high end', () => {
    const def = getGameDefinition('nine')
    const s = makeState({
      layout: [S('spades', 9)],
      hands: { a: [S('spades', 10)], b: [] },
      turnPlayerId: 'a',
    })
    const eff = def.reduce(s, { type: 'nine/play', card: S('spades', 10) }, CTX('a'))
    const next = eff.state as NineState
    expect(next.layout.map(cardKey).sort()).toEqual(
      [S('spades', 9), S('spades', 10)].map(cardKey).sort(),
    )

    const s2 = makeState({
      layout: [S('spades', 9), S('spades', 10)],
      hands: { a: [S('spades', 8)], b: [] },
      turnPlayerId: 'a',
    })
    const eff2 = def.reduce(s2, { type: 'nine/play', card: S('spades', 8) }, CTX('a'))
    expect((eff2.state as NineState).layout).toHaveLength(3)
  })

  it('a nine of an unopened suit is always legal, even without an adjacent card', () => {
    const def = getGameDefinition('nine')
    const s = makeState({
      layout: [S('spades', 9)],
      hands: { a: [S('hearts', 9)], b: [] },
      turnPlayerId: 'a',
    })
    const eff = def.reduce(s, { type: 'nine/play', card: S('hearts', 9) }, CTX('a'))
    expect((eff.state as NineState).layout).toHaveLength(2)
  })

  it('rejects a play from a player whose turn it is not', () => {
    const def = getGameDefinition('nine')
    const s = makeState({ layout: [], turnPlayerId: 'a' })
    expect(() => def.reduce(s, { type: 'nine/play', card: S('spades', 8) }, CTX('b'))).toThrow(
      InvalidActionError,
    )
  })

  it('rejects playing a card not in hand', () => {
    const def = getGameDefinition('nine')
    const s = makeState({ layout: [], turnPlayerId: 'a', hands: { a: [S('hearts', 6)], b: [] } })
    expect(() => def.reduce(s, { type: 'nine/play', card: S('spades', 9) }, CTX('a'))).toThrow(
      InvalidActionError,
    )
  })

  it('allows pass only when the player has no legal move', () => {
    const def = getGameDefinition('nine')
    const stateWithLegalMove = makeState({
      layout: [S('spades', 9)],
      hands: { a: [S('spades', 10)], b: [] },
      turnPlayerId: 'a',
    })
    expect(() => def.reduce(stateWithLegalMove, { type: 'nine/pass' }, CTX('a'))).toThrow(
      InvalidActionError,
    )

    const stateWithNoLegalMove = makeState({
      layout: [S('spades', 9)],
      hands: { a: [S('hearts', 6)], b: [] },
      turnPlayerId: 'a',
    })
    const eff = def.reduce(stateWithNoLegalMove, { type: 'nine/pass' }, CTX('a'))
    expect((eff.state as NineState).turnPlayerId).toBe('b')
  })

  it('ranks the player who empties their hand first as placement 1', () => {
    const def = getGameDefinition('nine')
    const s = makeState({
      order: ['a', 'b', 'c'],
      layout: [S('spades', 9)],
      hands: { a: [S('spades', 10)], b: [S('hearts', 6), S('hearts', 7)], c: [S('clubs', 6)] },
      turnPlayerId: 'a',
      finished: [],
    })
    const eff = def.reduce(s, { type: 'nine/play', card: S('spades', 10) }, CTX('a'))
    const next = eff.state as NineState
    expect(next.phase).toBe('finished')
    expect(next.finished).toEqual(['a'])
    expect(eff.finished).toBe(true)

    const def2 = getGameDefinition('nine')
    const results = def2.results(next)
    expect(results).toHaveLength(3)
    const byPlayer = Object.fromEntries(results.map((r) => [r.playerId, r]))
    expect(byPlayer.a?.placement).toBe(1)
    // b has 2 cards left, c has 1 - c outranks b.
    expect(byPlayer.c?.placement).toBe(2)
    expect(byPlayer.b?.placement).toBe(3)
  })

  it('rejects actions once the game has finished', () => {
    const def = getGameDefinition('nine')
    const s = makeState({ phase: 'finished', finished: ['a'] })
    expect(() => def.reduce(s, { type: 'nine/play', card: S('spades', 9) }, CTX('b'))).toThrow(
      InvalidActionError,
    )
  })

  it('an action of a type this game does not understand throws InvalidActionError', () => {
    const def = getGameDefinition('nine')
    const s = makeState()
    expect(() => def.reduce(s, { type: 'card/take' }, CTX('a'))).toThrow(InvalidActionError)
  })

  it('view never leaks another player hand', () => {
    const def = getGameDefinition('nine')
    const s = makeState()
    const v = def.view(s, 'a') as CardGameView
    const bKey = cardKey(s.hands.b?.[0] ?? S('hearts', 6))
    expect(JSON.stringify(v)).not.toContain(bKey)
    expect(v.opponents).toEqual([
      { playerId: 'b', cardCount: s.hands.b?.length ?? 0, finished: false },
    ])
  })

  it('state survives a JSON round-trip after a sequence of actions', () => {
    const def = getGameDefinition('nine')
    const s = makeState({ layout: [], turnPlayerId: 'a' })
    const eff = def.reduce(s, { type: 'nine/play', card: S('spades', 9) }, CTX('a'))
    const roundTripped = JSON.parse(JSON.stringify(eff.state))
    expect(roundTripped).toEqual(eff.state)
  })

  it('does not mutate the state object passed into reduce', () => {
    const def = getGameDefinition('nine')
    const s = makeState({ layout: [], turnPlayerId: 'a' })
    const before = JSON.parse(JSON.stringify(s))
    def.reduce(s, { type: 'nine/play', card: S('spades', 9) }, CTX('a'))
    expect(s).toEqual(before)
  })

  // Property test: plays every seed 1..20 at 2/3/4/5/6 players (100 full
  // games total) to termination via a simple legal-move bot, following the
  // precedent set by Durak's property test (test/durak.spec.ts).
  it('plays complete games to termination for every seed 1..20 at 2-6 players (property test)', () => {
    for (const playerCount of PROPERTY_TEST_PLAYER_COUNTS) {
      for (const seed of PROPERTY_TEST_SEEDS) {
        const finalState = playFullGame(seed, playerCount)
        const players = finalState.order

        expect(finalState.phase).toBe('finished')
        expect(totalCardsOf(finalState)).toBe(36)
        // Exactly one player won by emptying their hand.
        expect(finalState.finished).toHaveLength(1)
        const winner = finalState.finished[0]
        if (!winner) throw new Error('expected a winner')
        expect(finalState.hands[winner]).toHaveLength(0)

        const def = getGameDefinition('nine')
        const rows = def.results(finalState)
        // Every starting player gets a placement - nobody left out, nobody duplicated.
        expect(rows).toHaveLength(players.length)
        expect(new Set(rows.map((row) => row.playerId))).toEqual(new Set(players))

        const winnerRow = rows.find((row) => row.playerId === winner)
        expect(winnerRow?.placement).toBe(1)
      }
    }
  })
})
