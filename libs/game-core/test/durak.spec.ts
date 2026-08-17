import type { Card, CardGameView, PlayerId } from '@gp/shared'
import { describe, expect, it } from 'vitest'
import type { ActionContext } from '../src/contract'
import { InvalidActionError } from '../src/contract'
import { cardKey } from '../src/engines/card-engine'
import type { DurakState } from '../src/games/durak'
import { getGameDefinition } from '../src/registry'

const CTX = (actorId: string, now = 1_000): ActionContext => ({ actorId, now, seed: 42 })

const S = (suit: Card['suit'], rank: Card['rank']): Card => ({ suit, rank })

/**
 * Builds a fully-formed DurakState with sensible 2-player defaults, so each
 * rule test only has to override the handful of fields it actually cares
 * about instead of fishing for a random deal that happens to exhibit the
 * situation under test.
 */
function makeState(overrides: Partial<DurakState> = {}): DurakState {
  const base: DurakState = {
    order: ['a', 'b'],
    hands: {
      a: [S('spades', 6), S('spades', 7), S('spades', 8)],
      b: [S('hearts', 6), S('hearts', 7), S('hearts', 8)],
    },
    deck: [],
    trump: S('clubs', 6),
    table: [],
    attackerId: 'a',
    defenderId: 'b',
    discard: [],
    finished: [],
    phase: 'active',
    passed: [],
  }
  return {
    ...base,
    ...overrides,
    hands: { ...base.hands, ...(overrides.hands ?? {}) },
  }
}

describe('durak', () => {
  it('deals six cards to each player and sets a trump', () => {
    const def = getGameDefinition('durak')
    const s = def.init({ players: ['a', 'b', 'c'], seed: 7, options: {}, now: 0 }) as DurakState
    expect(s.hands.a).toHaveLength(6)
    expect(s.hands.b).toHaveLength(6)
    expect(s.hands.c).toHaveLength(6)
    expect(s.trump).not.toBeNull()
    // 3 players * 6 cards = 18, 36 - 18 = 18 left in the deck (trump stays in it).
    expect(s.deck).toHaveLength(18)
  })

  it('the player with the lowest trump attacks first', () => {
    const def = getGameDefinition('durak')
    const players = ['a', 'b', 'c', 'd']
    const s = def.init({ players, seed: 123, options: {}, now: 0 }) as DurakState
    if (!s.trump) throw new Error('expected a trump for a 4-player deal')
    const trumpSuit = s.trump.suit
    let expectedAttacker: PlayerId | null = null
    let lowestRank = Number.POSITIVE_INFINITY
    for (const playerId of players) {
      for (const card of s.hands[playerId] ?? []) {
        if (card.suit === trumpSuit && card.rank < lowestRank) {
          lowestRank = card.rank
          expectedAttacker = playerId
        }
      }
    }
    if (!expectedAttacker) throw new Error('expected some player to hold a trump card')
    expect(s.attackerId).toBe(expectedAttacker)
  })

  it('rejects a defend card that does not beat the attack', () => {
    const def = getGameDefinition('durak')
    const attack = S('spades', 8)
    const weak = S('hearts', 6)
    const s = makeState({
      table: [{ attack, defend: null }],
      hands: { a: [S('spades', 6)], b: [weak, S('hearts', 9)] },
    })
    expect(() =>
      def.reduce(s, { type: 'card/defend', card: weak, against: attack }, CTX('b')),
    ).toThrow(InvalidActionError)
  })

  it('rejects an action from a player whose turn it is not', () => {
    const def = getGameDefinition('durak')
    const s = makeState()
    // Table is empty, so only the attacker ('a') may open the attack.
    expect(() => def.reduce(s, { type: 'card/attack', card: S('hearts', 6) }, CTX('b'))).toThrow(
      InvalidActionError,
    )
  })

  it('rejects adding a card whose rank is not already on the table', () => {
    const def = getGameDefinition('durak')
    const s = makeState({
      table: [{ attack: S('spades', 6), defend: null }],
      hands: { a: [S('spades', 7)], b: [S('hearts', 9)] },
    })
    expect(() => def.reduce(s, { type: 'card/attack', card: S('spades', 7) }, CTX('a'))).toThrow(
      InvalidActionError,
    )
  })

  it('take moves the whole table into the defender hand', () => {
    const def = getGameDefinition('durak')
    const s = makeState({
      table: [
        { attack: S('spades', 6), defend: S('hearts', 9) },
        { attack: S('spades', 7), defend: null },
      ],
      hands: { a: [S('spades', 8)], b: [S('hearts', 10)] },
    })
    const eff = def.reduce(s, { type: 'card/take' }, CTX('b'))
    const next = eff.state as DurakState
    expect(next.table).toHaveLength(0)
    const keys = next.hands.b?.map(cardKey) ?? []
    expect(keys).toContain(cardKey(S('spades', 6)))
    expect(keys).toContain(cardKey(S('hearts', 9)))
    expect(keys).toContain(cardKey(S('spades', 7)))
  })

  it('pass discards the table and makes the defender the next attacker', () => {
    const def = getGameDefinition('durak')
    const s = makeState({
      table: [{ attack: S('spades', 6), defend: S('hearts', 9) }],
      hands: { a: [S('spades', 8)], b: [S('hearts', 10)] },
    })
    const eff = def.reduce(s, { type: 'card/pass' }, CTX('a'))
    const next = eff.state as DurakState
    expect(next.table).toHaveLength(0)
    expect(next.discard.map(cardKey).sort()).toEqual(
      [cardKey(S('spades', 6)), cardKey(S('hearts', 9))].sort(),
    )
    expect(next.attackerId).toBe('b')
    expect(next.defenderId).toBe('a')
  })

  it('a player who runs out of cards with an empty deck is marked finished with the next placement', () => {
    const def = getGameDefinition('durak')
    // 'a' attacks with its only card, 'b' defends with its only card; once the
    // bout resolves and the empty deck can't refill anyone, 'a' is out.
    const s = makeState({
      deck: [],
      hands: { a: [], b: [S('spades', 10)] },
      table: [{ attack: S('spades', 6), defend: null }],
    })
    const eff = def.reduce(
      s,
      { type: 'card/defend', card: S('spades', 10), against: S('spades', 6) },
      CTX('b'),
    )
    const afterDefend = eff.state as DurakState
    const passEff = def.reduce(afterDefend, { type: 'card/pass' }, CTX('a'))
    const next = passEff.state as DurakState
    expect(next.finished).toContain('a')
  })

  it('the last player holding cards is the durak and takes the worst placement', () => {
    const def = getGameDefinition('durak')
    const s = makeState({
      order: ['a', 'b'],
      deck: [],
      hands: { a: [], b: [S('spades', 10)] },
      table: [{ attack: S('spades', 6), defend: null }],
      finished: [],
    })
    const eff = def.reduce(
      s,
      { type: 'card/defend', card: S('spades', 10), against: S('spades', 6) },
      CTX('b'),
    )
    const passEff = def.reduce(eff.state as DurakState, { type: 'card/pass' }, CTX('a'))
    const next = passEff.state as DurakState
    expect(next.finished).toEqual(['a', 'b'])
    expect(next.phase).toBe('finished')
  })

  it('view never leaks another player hand', () => {
    const def = getGameDefinition('durak')
    const s = makeState()
    const v = def.view(s, 'a') as CardGameView
    const bKey = cardKey(s.hands.b?.[0] ?? S('hearts', 6))
    expect(JSON.stringify(v)).not.toContain(bKey)
  })

  // --- Additional rule tests beyond the brief's ten ---

  it('caps a bout at the defender starting hand size, and never above six', () => {
    const def = getGameDefinition('durak')
    const s = makeState({
      hands: {
        a: [S('spades', 6), S('spades', 7), S('spades', 8), S('spades', 9)],
        b: [S('hearts', 9)],
      },
      table: [{ attack: S('spades', 10), defend: null }],
    })
    // Defender's hand has 1 card, plus 0 already-defended cards this bout, so
    // the cap is min(6, 1) = 1: the table already has 1 attack, so no more
    // may be added even though ranks match and the primary attacker has cards.
    expect(() => def.reduce(s, { type: 'card/attack', card: S('spades', 9) }, CTX('a'))).toThrow(
      InvalidActionError,
    )
  })

  it('a defender who has already covered some cards may still take, including the covered pairs', () => {
    const def = getGameDefinition('durak')
    const s = makeState({
      table: [
        { attack: S('spades', 6), defend: S('hearts', 9) },
        { attack: S('spades', 7), defend: null },
      ],
      hands: { a: [], b: [] },
    })
    const eff = def.reduce(s, { type: 'card/take' }, CTX('b'))
    const next = eff.state as DurakState
    expect(next.hands.b).toHaveLength(3)
  })

  it('only the primary attacker may open a bout, but any other attacker may add once cards are down', () => {
    const def = getGameDefinition('durak')
    const s = makeState({
      order: ['a', 'b', 'c'],
      attackerId: 'a',
      defenderId: 'b',
      hands: {
        a: [S('spades', 6)],
        b: [S('hearts', 9), S('hearts', 10)],
        c: [S('diamonds', 6)],
      },
      table: [{ attack: S('spades', 6), defend: null }],
    })
    const eff = def.reduce(s, { type: 'card/attack', card: S('diamonds', 6) }, CTX('c'))
    const next = eff.state as DurakState
    expect(next.table).toHaveLength(2)
  })

  it('a defended table with no eligible attackers left resolves as soon as they all pass', () => {
    const def = getGameDefinition('durak')
    const s = makeState({
      order: ['a', 'b', 'c'],
      attackerId: 'a',
      defenderId: 'b',
      finished: ['c'],
      hands: { a: [S('spades', 8)], b: [S('hearts', 10)], c: [] },
      table: [{ attack: S('spades', 6), defend: S('hearts', 9) }],
    })
    const eff = def.reduce(s, { type: 'card/pass' }, CTX('a'))
    const next = eff.state as DurakState
    expect(next.table).toHaveLength(0)
    expect(next.attackerId).toBe('b')
  })

  it('plays a full seeded 2-player game from init through to a finished durak', () => {
    const def = getGameDefinition('durak')
    let s = def.init({ players: ['a', 'b'], seed: 99, options: {}, now: 0 }) as DurakState

    let guard = 0
    while (s.phase !== 'finished') {
      guard++
      if (guard > 500) throw new Error('game did not finish - possible infinite loop')

      const trumpSuit = s.trump?.suit ?? null
      const undefended = s.table.filter((entry) => entry.defend === null)

      if (s.attackerId === s.defenderId) throw new Error('attacker and defender collided')

      if (undefended.length > 0) {
        // Defender's turn: defend the first open attack if possible, else take.
        const target = undefended[0]
        if (!target) throw new Error('expected an undefended attack')
        const defenderHand = s.hands[s.defenderId] ?? []
        const beatingCard = defenderHand.find((card) => {
          if (card.suit === target.attack.suit) return card.rank > target.attack.rank
          return trumpSuit !== null && card.suit === trumpSuit && target.attack.suit !== trumpSuit
        })
        if (beatingCard) {
          s = def.reduce(
            s,
            { type: 'card/defend', card: beatingCard, against: target.attack },
            CTX(s.defenderId),
          ).state as DurakState
        } else {
          s = def.reduce(s, { type: 'card/take' }, CTX(s.defenderId)).state as DurakState
        }
        continue
      }

      // No undefended attacks: the attacker either adds a matching-rank card
      // (if any and the deck still has room under the cap) or passes.
      const attackerHand = s.hands[s.attackerId] ?? []
      const ranksOnTable = new Set(
        s.table.flatMap((entry) => [
          entry.attack.rank,
          ...(entry.defend ? [entry.defend.rank] : []),
        ]),
      )
      const maxAttacks = Math.min(
        6,
        (s.hands[s.defenderId] ?? []).length + s.table.filter((e) => e.defend).length,
      )
      const canAddMore = s.table.length < maxAttacks
      const addition =
        s.table.length === 0
          ? attackerHand[0]
          : canAddMore
            ? attackerHand.find((card) => ranksOnTable.has(card.rank))
            : undefined

      if (addition) {
        s = def.reduce(s, { type: 'card/attack', card: addition }, CTX(s.attackerId))
          .state as DurakState
      } else {
        s = def.reduce(s, { type: 'card/pass' }, CTX(s.attackerId)).state as DurakState
      }
    }

    expect(s.phase).toBe('finished')
    expect(s.finished).toHaveLength(2)
    const totalCards =
      (s.hands.a?.length ?? 0) +
      (s.hands.b?.length ?? 0) +
      s.table.length * 2 -
      s.table.filter((e) => e.defend === null).length +
      s.deck.length +
      s.discard.length
    expect(totalCards).toBe(36)
  })
})
