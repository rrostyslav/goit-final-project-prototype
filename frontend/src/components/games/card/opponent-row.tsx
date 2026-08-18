'use client'

import type { CardOpponentView } from '@gp/shared'
import { Avatar } from '@/components/ui/avatar'
import { cn } from '@/lib/cn'
import { useI18n } from '@/lib/i18n'

export interface OpponentRowProps {
  opponent: CardOpponentView
  nickname: string
  avatarUrl?: string | null
  /** Highlights the row for whoever `view.turnPlayerId` currently is (Nine's
   * turn player, or Durak's attacker -- `CardGameView.turnPlayerId` is
   * `state.attackerId` there, see durak.ts's `view()`). */
  isTurn: boolean
  /** Durak only -- `view.defenderId`, always `false` for Nine (that field is
   * `null` there). */
  isDefender: boolean
}

/**
 * One opponent, rendered from exactly what `CardGameView` discloses about
 * them: a nickname (looked up from `room.members`, never carried by the
 * view itself) and `cardCount` -- never their actual cards, which the
 * server structurally never sends (see `CardOpponentView` in
 * `libs/shared/src/game-view.ts`). A single face-down `<PlayingCard/>` next
 * to the count is decorative flavour, not a 1:1 rendering of their hand --
 * the count text is the authoritative number.
 */
export function OpponentRow({
  opponent,
  nickname,
  avatarUrl,
  isTurn,
  isDefender,
}: OpponentRowProps) {
  const { t } = useI18n()

  return (
    <li
      className={cn(
        'flex items-center gap-3 rounded-lg border px-3 py-2',
        isTurn ? 'border-primary bg-surface-hover' : 'border-border bg-surface',
      )}
    >
      <Avatar nickname={nickname} avatarUrl={avatarUrl} size="sm" />
      <div className="flex flex-1 flex-col">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium text-fg">{nickname}</span>
          {isDefender ? (
            <span className="rounded-full bg-surface-hover px-2 py-0.5 text-xs text-fg-muted">
              {t('game.defenderBadge')}
            </span>
          ) : null}
          {isTurn ? (
            <span className="rounded-full bg-primary px-2 py-0.5 text-xs text-primary-fg">
              {t('game.activeNow')}
            </span>
          ) : null}
          {opponent.finished ? (
            <span className="rounded-full bg-success/20 px-2 py-0.5 text-xs text-success">
              {t('game.finishedBadge')}
            </span>
          ) : null}
        </div>
        <span className="text-xs text-fg-muted">
          {t('game.opponentCardsLabel', { count: opponent.cardCount })}
        </span>
      </div>
      {opponent.cardCount > 0 ? <CardBack /> : null}
    </li>
  )
}

/** A single decorative face-down back -- deliberately not `<PlayingCard/>`
 * (which always requires a real `Card` and renders at hand/table size),
 * since there is no card to give it here, only a count, and this badge is
 * intentionally smaller than a real card (see the component doc comment
 * above). */
function CardBack() {
  return (
    <div
      aria-hidden="true"
      className="hidden h-10 w-7 shrink-0 rounded border border-border bg-primary sm:block"
      style={{
        backgroundImage:
          'repeating-linear-gradient(45deg, rgba(255,255,255,0.14) 0 4px, transparent 4px 8px)',
      }}
    />
  )
}
