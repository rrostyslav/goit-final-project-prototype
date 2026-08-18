'use client'

import type { Card as CardData } from '@gp/shared'
import { cn } from '@/lib/cn'
import { cardKey, PlayingCard } from './playing-card'

export interface HandProps {
  cards: CardData[]
  /** Pure presentational gate -- `card-game-screen.tsx` is the only place
   * that knows the actual rules (whose turn it is, what's legal to add to
   * the table, whether a defend target is even selected yet); this
   * component just renders whatever it's told. */
  isCardEnabled: (card: CardData) => boolean
  onSelect: (card: CardData) => void
  disabled?: boolean
}

/**
 * The viewer's own hand -- up to ~20 cards (Nine deals as many as 18 to a
 * 2-player game). Ambiguity resolution from the brief: fixed-size cards
 * (64x96px, never shrunk) overlapping by 20px in a single horizontally-
 * scrolling row (`overflow-x-auto`), rather than shrinking cards to fit or
 * wrapping them onto multiple rows. Every card repeats its rank/suit corner
 * in both top-left and bottom-right (see playing-card.tsx) specifically so
 * whichever sliver of a card peeks out from under its right-hand neighbour
 * -- all that's visible for every card but the last -- still identifies it
 * unambiguously; native scroll (wheel, trackpad, touch swipe) reaches
 * whatever doesn't fit the viewport instead of ever making a card illegible.
 *
 * The overlap is deliberately NOT half the card's width. A card's exposed
 * (unobscured) sliver is `width - overlap` = 44px at this ratio -- with a
 * 32px (half-width) overlap that sliver would be only 32px wide, and worse,
 * the card's own geometric CENTER would sit exactly on the boundary with
 * the next card, which draws on top of it: a click aimed at "the middle of
 * this card" would coin-flip onto its neighbour instead of the card
 * actually clicked (caught during manual verification -- clicking what the
 * accessibility tree labelled as one card played a different, adjacent one
 * every time). 20px keeps every card's center inside its own exposed
 * region -- `x + 32` (half of 64) is always `< 44`, the exposed width --
 * so a click anywhere near a card's visual middle can never resolve to its
 * neighbour instead.
 */
export function Hand({ cards, isCardEnabled, onSelect, disabled = false }: HandProps) {
  return (
    <div className="flex overflow-x-auto pt-3 pb-3 pl-1">
      {cards.map((card, index) => {
        const enabled = !disabled && isCardEnabled(card)
        return (
          <div key={cardKey(card)} className={cn(index > 0 && '-ml-5')}>
            <PlayingCard
              card={card}
              disabled={!enabled}
              onClick={enabled ? () => onSelect(card) : undefined}
            />
          </div>
        )
      })}
    </div>
  )
}
