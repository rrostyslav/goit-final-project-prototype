'use client'

import type { Card as CardData, CardGameView, Suit } from '@gp/shared'
import { useI18n } from '@/lib/i18n'
import { cardKey, PlayingCard, SUIT_GLYPH } from './playing-card'

export interface TableProps {
  view: CardGameView
  /** The attack card a defender has targeted, or `null` -- always `null` for
   * Nine and for any Durak viewer who isn't the defender (see
   * `card-game-screen.tsx`'s derivation of this). */
  selectedAttack: CardData | null
  /** Fires only for an uncovered (`defend === null`) attack, and only when
   * `canSelectAttack` -- clicking the SAME already-selected attack again
   * deselects it. */
  onSelectAttack: (card: CardData) => void
  canSelectAttack: boolean
}

const SUIT_ORDER: Suit[] = ['spades', 'hearts', 'diamonds', 'clubs']

/**
 * The shared table area for both card games -- branches on `view.gameId`
 * rather than being two separate components, since the brief lists a single
 * `table.tsx`.
 *
 * Durak: `view.table` is already the attack/defend pairs (see
 * `CardGameView.table`'s doc comment) -- each pair renders as the attack
 * card with the defend card (if any) fanned on top of it. An uncovered
 * attack is clickable ONLY for the defender (`canSelectAttack`), which is
 * one half of this game's two-selection defend interaction -- see
 * `card-game-screen.tsx`'s doc comment on `rawSelectedAttack` for the other
 * half and why the pairing this produces can never be ambiguous.
 *
 * Nine: `view.layout` is a flat, order-preserving `Card[]` (see that field's
 * own doc comment) -- grouped here by suit and sorted by rank purely for
 * display, mirroring `suitBounds` in `@gp/game-core`'s nine.ts. This is
 * presentation only; nothing here re-derives legality (that lives in
 * `card-game-screen.tsx`, shared with the pass-button gating).
 */
export function Table({ view, selectedAttack, onSelectAttack, canSelectAttack }: TableProps) {
  const { t } = useI18n()

  if (view.gameId === 'durak') {
    return (
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-4 text-sm text-fg-muted">
          {view.trump ? (
            <span className="flex items-center gap-2">
              {t('game.trumpLabel')}
              <PlayingCard card={view.trump} />
            </span>
          ) : null}
          <span>{t('game.deckCountLabel', { count: view.deckCount })}</span>
        </div>

        {view.table.length === 0 ? (
          <p className="text-sm text-fg-muted">{t('game.tableEmpty')}</p>
        ) : (
          <div className="flex flex-wrap gap-4">
            {view.table.map((entry) => {
              const key = cardKey(entry.attack)
              const isSelected = selectedAttack !== null && cardKey(selectedAttack) === key
              const selectable = canSelectAttack && entry.defend === null
              return (
                <div key={key} className="relative h-24 w-16">
                  <PlayingCard
                    card={entry.attack}
                    selected={isSelected}
                    onClick={selectable ? () => onSelectAttack(entry.attack) : undefined}
                  />
                  {entry.defend ? (
                    <div className="absolute top-3 left-3">
                      <PlayingCard card={entry.defend} />
                    </div>
                  ) : null}
                </div>
              )
            })}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      {SUIT_ORDER.map((suit) => {
        const suitCards = view.layout
          .filter((card) => card.suit === suit)
          .sort((a, b) => a.rank - b.rank)
        return (
          <div key={suit} className="flex items-center gap-2">
            <span className="w-5 shrink-0 text-lg text-fg-muted">{SUIT_GLYPH[suit]}</span>
            {suitCards.length === 0 ? (
              <span className="text-sm text-fg-muted">—</span>
            ) : (
              <div className="flex overflow-x-auto">
                {suitCards.map((card, index) => (
                  <div key={cardKey(card)} className={index > 0 ? '-ml-10' : ''}>
                    <PlayingCard card={card} />
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
