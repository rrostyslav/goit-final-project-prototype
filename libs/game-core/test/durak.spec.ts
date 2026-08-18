import type { Card, CardGameView, GameAction, PlayerId, Suit } from '@gp/shared'
import { describe, expect, it } from 'vitest'
import type { ActionContext } from '../src/contract'
import { InvalidActionError } from '../src/contract'
import { beats, cardKey } from '../src/engines/card-engine'
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

/** Hands + table (both sides) + deck + discard - must always equal 36. */
function totalCardsOf(s: DurakState): number {
  const handsTotal = s.order.reduce((sum, p) => sum + (s.hands[p]?.length ?? 0), 0)
  const tableTotal = s.table.reduce((sum, e) => sum + 1 + (e.defend ? 1 : 0), 0)
  return handsTotal + tableTotal + s.deck.length + s.discard.length
}

/** Mirrors the private `eligibleAttackers` in durak.ts: everyone but the defender and the finished. */
function eligibleAttackersOf(s: DurakState): PlayerId[] {
  return s.order.filter((p) => p !== s.defenderId && !s.finished.includes(p))
}

/**
 * Ranks a card for "weakest first" card selection: plain rank for a
 * non-trump card, rank + 100 for a trump (so every trump ranks above every
 * non-trump - trumps are worth holding back). Used only to pick which card a
 * bot plays, never by the engine itself.
 */
function cardValue(card: Card, trumpSuit: Suit | null): number {
  const isTrump = trumpSuit !== null && card.suit === trumpSuit
  return isTrump ? 100 + card.rank : card.rank
}

/** The lowest-value card in `cards` (see `cardValue`), or undefined if `cards` is empty. */
function weakest(cards: Card[], trumpSuit: Suit | null): Card | undefined {
  return [...cards].sort((a, b) => cardValue(a, trumpSuit) - cardValue(b, trumpSuit))[0]
}

/**
 * A simple legal-move bot for driving full games in the property test below.
 * Defender: defends with the weakest card in hand that beats the open
 * attack, else takes. Attacker (opening a bout) or an eligible attacker
 * adding to one (in turn order, skipping anyone who has already passed this
 * bout): plays its weakest legal card if it has one and there's room under
 * the attack cap; otherwise that attacker passes.
 *
 * "Weakest card first" isn't just flavor: an earlier "first card in hand
 * order" version of this bot produced real, exactly-periodic non-terminating
 * cycles on several seeds (e.g. seed 9 at 4 players got stuck in a 48-action
 * loop where every attack was immediately taken back, because the
 * arbitrarily-chosen attack card was never one the defender could beat, so
 * nothing ever reached discard). Attacking with the weakest available card -
 * standard real-world Durak strategy, since low cards are the easiest to get
 * beaten and thus discarded - reliably drives every one of the 100 seed x
 * player-count games in the property test below to completion (max 247
 * actions observed). This mirrors the reducer's own legality rules (see
 * `ranksOnTable` / `maxAttacksAllowed` / `eligibleAttackers` in durak.ts)
 * closely enough that it always finds a legal move when phase is 'active' -
 * if it ever can't, that itself is evidence of an engine deadlock, so the
 * test throws loudly rather than silently stalling.
 */
function botMove(s: DurakState): { action: GameAction; actorId: PlayerId } {
  const trumpSuit = s.trump?.suit ?? null
  const undefended = s.table.find((entry) => entry.defend === null)

  if (undefended) {
    const hand = s.hands[s.defenderId] ?? []
    const beating = weakest(
      hand.filter((card) => beats(undefended.attack, card, trumpSuit)),
      trumpSuit,
    )
    if (beating) {
      return {
        action: { type: 'card/defend', card: beating, against: undefended.attack },
        actorId: s.defenderId,
      }
    }
    return { action: { type: 'card/take' }, actorId: s.defenderId }
  }

  if (s.table.length === 0) {
    const hand = s.hands[s.attackerId] ?? []
    const card = weakest(hand, trumpSuit)
    if (!card) throw new Error(`attacker ${s.attackerId} has no card to open a bout with`)
    return { action: { type: 'card/attack', card }, actorId: s.attackerId }
  }

  const ranksOnTable = new Set(
    s.table.flatMap((entry) => [entry.attack.rank, ...(entry.defend ? [entry.defend.rank] : [])]),
  )
  const maxAttacks = Math.min(
    6,
    (s.hands[s.defenderId] ?? []).length + s.table.filter((entry) => entry.defend).length,
  )
  const canAddMore = s.table.length < maxAttacks

  for (const attacker of eligibleAttackersOf(s)) {
    if (s.passed.includes(attacker)) continue
    if (canAddMore) {
      const hand = s.hands[attacker] ?? []
      const card = weakest(
        hand.filter((c) => ranksOnTable.has(c.rank)),
        trumpSuit,
      )
      if (card) {
        return { action: { type: 'card/attack', card }, actorId: attacker }
      }
    }
    return { action: { type: 'card/pass' }, actorId: attacker }
  }

  // Reachable only if the engine leaves an active bout with no eligible
  // attacker left to act - i.e. an engine-level deadlock.
  throw new Error('no eligible attacker action available - possible engine deadlock')
}

const PROPERTY_TEST_SEEDS = Array.from({ length: 20 }, (_, i) => i + 1) // 1..20
const PROPERTY_TEST_PLAYER_COUNTS = [2, 3, 4, 5, 6]
/** Loud failure instead of a hung test suite if a game never reaches 'finished'. */
const MAX_ACTIONS_PER_GAME = 4000

/** Drives one full game to termination via `botMove`, asserting invariants after every action. */
function playFullGame(seed: number, playerCount: number): DurakState {
  const def = getGameDefinition('durak')
  const players = Array.from({ length: playerCount }, (_, i) => `p${i + 1}`)
  let s = def.init({ players, seed, options: {}, now: 0 }) as DurakState
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

    s = def.reduce(s, action, CTX(actorId)).state as DurakState
    expect(totalCardsOf(s)).toBe(36)
  }

  return s
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

  it('regression: a pass-resolved bout where the old defender finishes rotates the attacker to an unfinished player', () => {
    const def = getGameDefinition('durak')
    // Three players, empty deck. 'b' defends its last card, so once the bout
    // resolves via pass (both other attackers pass on the fully-defended
    // table), 'b' has 0 cards and 0 deck to refill from and finishes. 'a' and
    // 'c' still hold cards, so the game must NOT end - but the buggy
    // finalizeBout routed the new attacker straight to the now-finished 'b'
    // unconditionally on the 'pass' branch, instead of skipping past
    // finished players the way the 'take' branch does. That leaves
    // state.attackerId pointing at a finished player while phase stays
    // 'active': the finished attacker is rejected by requireActivePlayer,
    // and everyone else is rejected by "only the attacker may open a bout"
    // on the now-empty table. No player has any legal action - a full
    // deadlock.
    let s = makeState({
      order: ['a', 'b', 'c'],
      attackerId: 'a',
      defenderId: 'b',
      deck: [],
      hands: {
        a: [S('clubs', 7)],
        b: [S('spades', 9)],
        c: [S('diamonds', 6)],
      },
      table: [{ attack: S('spades', 6), defend: null }],
      finished: [],
      passed: [],
    })

    s = def.reduce(
      s,
      { type: 'card/defend', card: S('spades', 9), against: S('spades', 6) },
      CTX('b'),
    ).state as DurakState
    expect(s.hands.b).toHaveLength(0)

    // Both eligible attackers ('a' and 'c') pass on the now fully-defended
    // table; the second pass is the one that triggers finalizeBout.
    s = def.reduce(s, { type: 'card/pass' }, CTX('c')).state as DurakState
    s = def.reduce(s, { type: 'card/pass' }, CTX('a')).state as DurakState

    // The game must still be running: two players ('a' and 'c') hold cards.
    expect(s.phase).toBe('active')
    expect(s.finished).toEqual(['b'])
    expect(s.finished).not.toContain(s.attackerId)
    expect(s.finished).not.toContain(s.defenderId)

    // At least one legal action must exist: the new attacker can open a
    // fresh bout with a card from its own hand (the table is empty right
    // after a bout resolves).
    const attackerHand = s.hands[s.attackerId] ?? []
    const openingCard = attackerHand[0]
    if (!openingCard) throw new Error('expected the new attacker to hold a card to open with')
    expect(() =>
      def.reduce(s, { type: 'card/attack', card: openingCard }, CTX(s.attackerId)),
    ).not.toThrow()
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

  // Property test: plays every seed 1..20 at 2/3/4/5/6 players (100 full
  // games total) to termination via a simple legal-move bot. This is the
  // test that would have caught the pass-rotation deadlock: seed 3 at 3
  // players (and most seeds at 6 players, where the 36-card deck is
  // entirely dealt out on the first deal and never refills again) hit the
  // exact "old defender finishes on a pass" scenario the regression test
  // above constructs by hand. It's invisible at 2 players because there the
  // old defender running out always coincides with only one player
  // remaining, so the game-end branch fires before rotation ever matters.
  //
  // 100 games in-process comfortably fits the normal suite (see the timing
  // note in the fix report); no seed-range reduction was needed.
  it('plays complete games to termination for every seed 1..20 at 2-6 players (property test)', () => {
    for (const playerCount of PROPERTY_TEST_PLAYER_COUNTS) {
      for (const seed of PROPERTY_TEST_SEEDS) {
        const finalState = playFullGame(seed, playerCount)
        const players = finalState.order

        expect(finalState.phase).toBe('finished')
        expect(totalCardsOf(finalState)).toBe(36)

        // `finished` must be exactly a permutation of the starting players -
        // everyone placed, nobody placed twice, nobody left out.
        expect([...finalState.finished].sort()).toEqual([...players].sort())
        expect(new Set(finalState.finished).size).toBe(players.length)

        const def = getGameDefinition('durak')
        const rows = def.results(finalState)
        expect(rows).toHaveLength(players.length)
        expect(new Set(rows.map((row) => row.playerId))).toEqual(new Set(players))

        // Exactly one player holds the worst (highest-numbered) placement - the durak.
        const worstPlacement = Math.max(...rows.map((row) => row.placement))
        const worstRows = rows.filter((row) => row.placement === worstPlacement)
        expect(worstRows).toHaveLength(1)
      }
    }
  })
})
