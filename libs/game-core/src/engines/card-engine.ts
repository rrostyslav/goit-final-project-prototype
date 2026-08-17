import type { Card, PlayerId, Suit } from '@gp/shared'

const SUITS: Suit[] = ['spades', 'hearts', 'diamonds', 'clubs']
const RANKS = [6, 7, 8, 9, 10, 11, 12, 13, 14] as const

/**
 * A standard 36-card deck (ranks 6..14 across all four suits) in a fixed,
 * stable order: suits outer loop, ranks inner loop. Pure and deterministic -
 * shuffling, if wanted, is the caller's job via createRng(seed).shuffle.
 */
export function buildDeck36(): Card[] {
  const deck: Card[] = []
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({ suit, rank })
    }
  }
  return deck
}

/** Stable identity for a card, e.g. 'hearts:14'. Useful as a Record/Set key. */
export function cardKey(card: Card): string {
  return `${card.suit}:${card.rank}`
}

/**
 * Deals `perPlayer` cards to each player in turn order, round-robin (one card
 * per player per pass), taking from the front of `deck`. Does not mutate
 * `deck` or `players`. Whatever remains is returned as `rest`.
 */
export function dealHands(
  deck: Card[],
  players: PlayerId[],
  perPlayer: number,
): { hands: Record<PlayerId, Card[]>; rest: Card[] } {
  const working = [...deck]
  const hands: Record<PlayerId, Card[]> = {}
  for (const playerId of players) {
    hands[playerId] = []
  }
  for (let round = 0; round < perPlayer; round++) {
    for (const playerId of players) {
      const card = working.shift()
      if (card === undefined) {
        return { hands, rest: working }
      }
      hands[playerId]?.push(card)
    }
  }
  return { hands, rest: working }
}

/**
 * Picks the trump card: the bottom (last) card of `rest`, per Durak rules -
 * it is shown to everyone but stays physically in the deck until drawn last.
 * Returns a copy of `rest`, unchanged in length and order.
 */
export function pickTrump(rest: Card[]): { trump: Card | null; rest: Card[] } {
  const bottom = rest[rest.length - 1]
  return { trump: bottom ?? null, rest: [...rest] }
}

/**
 * True if `defend` beats `attack` under Durak rules: same suit needs a higher
 * rank; a trump beats any non-trump; a non-trump never beats a trump; two
 * different non-trump suits never beat each other.
 *
 * `trumpSuit` accepts `null` for the (rare, legal) deal where every card
 * ended up in a hand and none was left for `pickTrump` to expose - see its
 * own `Card | null` return. With no trump suit in play, nothing is trump, so
 * the same-suit-higher-rank rule is all that ever applies.
 */
export function beats(attack: Card, defend: Card, trumpSuit: Suit | null): boolean {
  if (defend.suit === attack.suit) {
    return defend.rank > attack.rank
  }
  const defendIsTrump = trumpSuit !== null && defend.suit === trumpSuit
  const attackIsTrump = trumpSuit !== null && attack.suit === trumpSuit
  return defendIsTrump && !attackIsTrump
}

/**
 * The next player after `current` in `order`, wrapping around and skipping
 * anyone listed in `skip` (e.g. players who have already finished/gone out).
 * Falls back to `current` if nobody else is eligible.
 */
export function nextPlayer(order: PlayerId[], current: PlayerId, skip: PlayerId[] = []): PlayerId {
  const length = order.length
  if (length === 0) {
    return current
  }
  const startIndex = order.indexOf(current)
  for (let step = 1; step <= length; step++) {
    const candidate = order[(startIndex + step) % length]
    if (candidate !== undefined && !skip.includes(candidate)) {
      return candidate
    }
  }
  return current
}

/**
 * Tops every player in `order` up to `target` cards, dealing one card at a
 * time in turn order (player 1's hand fills before player 2's starts, so a
 * short deck favors earlier players in turn order - matching Durak's refill
 * rule). Stops cleanly the moment the deck runs out, leaving later players
 * short rather than looping or throwing. Does not mutate `hands` or `deck`.
 */
export function refillHands(
  hands: Record<PlayerId, Card[]>,
  deck: Card[],
  order: PlayerId[],
  target: number,
): { hands: Record<PlayerId, Card[]>; deck: Card[] } {
  const nextHands: Record<PlayerId, Card[]> = {}
  for (const playerId of Object.keys(hands)) {
    nextHands[playerId] = [...(hands[playerId] ?? [])]
  }
  const working = [...deck]
  for (const playerId of order) {
    const hand = nextHands[playerId] ?? []
    let needed = target - hand.length
    while (needed > 0) {
      const card = working.shift()
      if (card === undefined) {
        nextHands[playerId] = hand
        return { hands: nextHands, deck: working }
      }
      hand.push(card)
      needed--
    }
    nextHands[playerId] = hand
  }
  return { hands: nextHands, deck: working }
}
