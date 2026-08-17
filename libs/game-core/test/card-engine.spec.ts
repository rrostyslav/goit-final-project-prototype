import type { Card } from '@gp/shared'
import { describe, expect, it } from 'vitest'
import {
  beats,
  buildDeck36,
  cardKey,
  dealHands,
  nextPlayer,
  pickTrump,
  refillHands,
} from '../src/engines/card-engine'

describe('card-engine', () => {
  it('builds a 36-card deck with no duplicates', () => {
    const deck = buildDeck36()
    expect(deck).toHaveLength(36)
    expect(new Set(deck.map(cardKey)).size).toBe(36)
  })

  it('beats: higher rank of the same suit wins', () => {
    expect(beats({ suit: 'hearts', rank: 7 }, { suit: 'hearts', rank: 10 }, 'spades')).toBe(true)
    expect(beats({ suit: 'hearts', rank: 10 }, { suit: 'hearts', rank: 7 }, 'spades')).toBe(false)
  })

  it('beats: any trump beats any non-trump', () => {
    expect(beats({ suit: 'hearts', rank: 14 }, { suit: 'spades', rank: 6 }, 'spades')).toBe(true)
  })

  it('beats: a lower trump does not beat a higher trump', () => {
    expect(beats({ suit: 'spades', rank: 12 }, { suit: 'spades', rank: 9 }, 'spades')).toBe(false)
  })

  it('beats: a different non-trump suit never beats', () => {
    expect(beats({ suit: 'hearts', rank: 6 }, { suit: 'clubs', rank: 14 }, 'spades')).toBe(false)
  })

  it('dealHands gives every player the requested count and shrinks the deck', () => {
    const { hands, rest } = dealHands(buildDeck36(), ['a', 'b', 'c'], 6)
    expect(hands.a).toHaveLength(6)
    expect(rest).toHaveLength(18)
  })

  it('pickTrump returns the bottom card and leaves it in the deck', () => {
    const rest = buildDeck36().slice(0, 5)
    const { trump, rest: after } = pickTrump(rest)
    expect(trump).toEqual(rest[rest.length - 1])
    expect(after).toHaveLength(5)
  })

  it('refillHands tops players up to the target in turn order and stops when the deck is empty', () => {
    const { hands, deck } = refillHands({ a: [], b: [] }, buildDeck36().slice(0, 3), ['a', 'b'], 6)
    expect(hands.a).toHaveLength(3)
    expect(hands.b).toHaveLength(0)
    expect(deck).toHaveLength(0)
  })

  // --- Additional edge-case tests beyond the brief ---

  it('cardKey formats as suit:rank', () => {
    expect(cardKey({ suit: 'hearts', rank: 14 })).toBe('hearts:14')
  })

  it('buildDeck36 has a stable order across calls', () => {
    expect(buildDeck36()).toEqual(buildDeck36())
  })

  it('dealHands does not mutate the deck passed in', () => {
    const deck = buildDeck36()
    const before = [...deck]
    dealHands(deck, ['a', 'b'], 3)
    expect(deck).toEqual(before)
  })

  it('pickTrump on an empty deck returns null trump and an empty rest', () => {
    const { trump, rest } = pickTrump([])
    expect(trump).toBeNull()
    expect(rest).toHaveLength(0)
  })

  it('nextPlayer wraps around to the first player after the last', () => {
    expect(nextPlayer(['a', 'b', 'c'], 'c')).toBe('a')
    expect(nextPlayer(['a', 'b', 'c'], 'a')).toBe('b')
  })

  it('nextPlayer skips the given players', () => {
    expect(nextPlayer(['a', 'b', 'c', 'd'], 'a', ['b', 'c'])).toBe('d')
  })

  it('refillHands does not mutate the hands or deck passed in', () => {
    const hands: Record<string, Card[]> = { a: [], b: [] }
    const deck = buildDeck36().slice(0, 3)
    const handsBefore = JSON.parse(JSON.stringify(hands)) as typeof hands
    const deckBefore = [...deck]
    refillHands(hands, deck, ['a', 'b'], 6)
    expect(hands).toEqual(handsBefore)
    expect(deck).toEqual(deckBefore)
  })

  it('refillHands tops up multiple players round-robin in turn order', () => {
    const startingHand: Card[] = [{ suit: 'hearts', rank: 6 }]
    const { hands, deck } = refillHands({ a: startingHand, b: [] }, buildDeck36(), ['a', 'b'], 3)
    expect(hands.a).toHaveLength(3)
    expect(hands.b).toHaveLength(3)
    expect(deck).toHaveLength(36 - 2 - 3)
  })
})
