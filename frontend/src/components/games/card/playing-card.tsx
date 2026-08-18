'use client'

import type { Card as CardData, Rank, Suit } from '@gp/shared'
import { cn } from '@/lib/cn'

export interface PlayingCardProps {
  card: CardData
  /** Renders a plain card back instead of `card`'s rank/suit -- used for
   * opponents' hands, which `CardGameView` never discloses (see
   * `CardOpponentView`'s doc comment in `@gp/shared`: only a `cardCount`).
   * Never interactive, regardless of `onClick`. */
  faceDown?: boolean
  /** Omit entirely for a purely decorative, non-clickable card (the trump
   * display, an already-defended table entry, a table attack the viewer
   * isn't the defender for). Present only when this exact card is currently
   * a legal target -- callers never pass a handler for a card they intend
   * to disable, see `disabled` below for that case instead. */
  onClick?: () => void
  /** Lifted and outlined -- the one form of persistent selection this game
   * uses, for the table's attack card a defender has targeted (see
   * `table.tsx`). Hand cards never set this: every hand click dispatches
   * immediately rather than arming a second click. */
  selected?: boolean
  /** Distinct from omitting `onClick`: this is a card that COULD be
   * clickable in general but isn't right now (e.g. a hand card that isn't a
   * legal move this turn) -- rendered faded, whereas an omitted `onClick`
   * alone renders at full opacity (nothing to disable, it was never meant
   * to be clicked at all). */
  disabled?: boolean
  className?: string
}

/** The glyph is the PRIMARY signal for telling suits apart -- all four are
 * unambiguous shapes even with colour removed entirely. `SUIT_COLOR` below
 * is a secondary reinforcement only (the classic two-colour deck
 * convention), never the sole way to distinguish a card. */
const SUIT_GLYPH: Record<Suit, string> = {
  spades: '♠',
  hearts: '♥',
  diamonds: '♦',
  clubs: '♣',
}

const SUIT_COLOR: Record<Suit, string> = {
  spades: 'text-neutral-900',
  clubs: 'text-neutral-900',
  hearts: 'text-red-600',
  diamonds: 'text-red-600',
}

const RANK_LABEL: Record<Rank, string> = {
  6: '6',
  7: '7',
  8: '8',
  9: '9',
  10: '10',
  11: 'J',
  12: 'Q',
  13: 'K',
  14: 'A',
}

/** Suit+rank identity as a plain string key -- `Card` has no id of its own,
 * and a 36-card deck never has duplicates, so this is exactly the equality
 * check every selection/lookup in this folder needs (hand/table/screen all
 * import this rather than each rolling their own). */
export function cardKey(card: CardData): string {
  return `${card.suit}:${card.rank}`
}

const CARD_FACE_CLASSES =
  'flex h-24 w-16 shrink-0 flex-col justify-between rounded-lg border-2 px-1.5 py-1 text-left shadow-md transition-transform'

export function PlayingCard({
  card,
  faceDown = false,
  onClick,
  selected = false,
  disabled = false,
  className,
}: PlayingCardProps) {
  if (faceDown) {
    return (
      <div
        aria-hidden="true"
        className={cn(
          'h-24 w-16 shrink-0 rounded-lg border-2 border-border bg-primary shadow-md',
          className,
        )}
        style={{
          backgroundImage:
            'repeating-linear-gradient(45deg, rgba(255,255,255,0.14) 0 6px, transparent 6px 12px)',
        }}
      />
    )
  }

  const interactive = onClick !== undefined && !disabled
  const label = RANK_LABEL[card.rank]
  const glyph = SUIT_GLYPH[card.suit]
  const color = SUIT_COLOR[card.suit]

  return (
    <button
      type="button"
      onClick={interactive ? onClick : undefined}
      disabled={!interactive}
      aria-pressed={onClick !== undefined ? selected : undefined}
      aria-label={`${label} ${glyph}`}
      className={cn(
        CARD_FACE_CLASSES,
        'bg-white',
        selected ? '-translate-y-3 border-primary' : 'border-neutral-300',
        disabled && 'opacity-40',
        interactive && 'cursor-pointer hover:-translate-y-2',
        !interactive && !disabled && 'cursor-default',
        className,
      )}
    >
      <span className={cn('text-sm font-bold leading-none', color)}>{label}</span>
      <span className={cn('self-center text-2xl leading-none', color)}>{glyph}</span>
      <span className={cn('self-end rotate-180 text-sm font-bold leading-none', color)}>
        {label}
      </span>
    </button>
  )
}
