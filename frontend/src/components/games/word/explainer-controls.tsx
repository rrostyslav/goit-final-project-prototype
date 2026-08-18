'use client'

import type { PlayerId, RoomMemberDto, WordGameView } from '@gp/shared'
import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { useI18n } from '@/lib/i18n'
import { resolveNickname } from './team-scoreboard'

export interface ExplainerControlsProps {
  view: WordGameView
  members: RoomMemberDto[]
  isSubmitting: boolean
  error: string | null
  onStartRound: () => void
  /** `guesserId` is only ever passed for Crocodile -- Alias/Hat's own
   * `word/correct` ignores it (see `@gp/shared`'s `GameAction` doc comment),
   * so their single button below calls this with no argument. */
  onCorrect: (guesserId?: PlayerId) => void
  onSkip: () => void
  onEndRound: () => void
  /** Rendered inside the round-active card, between the secret word and the
   * scoring buttons -- `crocodile-screen.tsx` uses this slot for the
   * explainer's own `<DrawingCanvas mode="draw"/>`; every other word game
   * passes nothing. */
  children?: ReactNode
}

/**
 * Only ever rendered for the player `word-game-screen.tsx` has already
 * determined IS the current explainer (`view.explainerId === selfId`) --
 * see that file's own doc comment for why a guesser's client can never even
 * import this component's `onCorrect`, let alone call it with an arbitrary
 * `guesserId`.
 */
export function ExplainerControls({
  view,
  members,
  isSubmitting,
  error,
  onStartRound,
  onCorrect,
  onSkip,
  onEndRound,
  children,
}: ExplainerControlsProps) {
  const { t } = useI18n()
  const isCrocodile = view.gameId === 'crocodile'
  const roundActive = view.phase === 'active'

  if (!roundActive) {
    return (
      <Card className="flex flex-col items-center gap-3 text-center">
        <Button type="button" isLoading={isSubmitting} onClick={onStartRound}>
          {t('game.startRound')}
        </Button>
        {error ? <p className="text-sm text-danger">{error}</p> : null}
      </Card>
    )
  }

  // Every other player currently in the game, i.e. every candidate the
  // explainer may credit as the guesser -- `assertValidGuesser` on the
  // backend rejects anyone else (the explainer themself, or an id not in
  // `view.teams` at all), so this list is exactly the set of ids that could
  // ever succeed.
  const guesserCandidates = isCrocodile
    ? view.teams.flatMap((team) => team.memberIds).filter((id) => id !== view.explainerId)
    : []

  return (
    <Card className="flex flex-col gap-4">
      <div className="rounded-xl border border-primary/40 bg-surface-hover px-4 py-6 text-center">
        <p className="text-xs font-medium uppercase tracking-wide text-fg-muted">
          {t('game.secretWordLabel')}
        </p>
        <p className="text-3xl font-bold text-fg">{view.secretWord ?? '—'}</p>
      </div>

      {children}

      {isCrocodile ? (
        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium text-fg-muted">{t('game.pickGuesser')}</p>
          <div className="flex flex-wrap gap-2">
            {guesserCandidates.map((id) => (
              <Button
                key={id}
                type="button"
                variant="secondary"
                size="sm"
                disabled={isSubmitting}
                onClick={() => onCorrect(id)}
              >
                {resolveNickname(members, id)}
              </Button>
            ))}
          </div>
        </div>
      ) : (
        <Button type="button" isLoading={isSubmitting} onClick={() => onCorrect()}>
          {t('game.correct')}
        </Button>
      )}

      <div className="flex gap-2">
        <Button type="button" variant="secondary" disabled={isSubmitting} onClick={onSkip}>
          {t('game.skip')}
        </Button>
        <Button type="button" variant="ghost" disabled={isSubmitting} onClick={onEndRound}>
          {t('game.endRound')}
        </Button>
      </div>

      {error ? <p className="text-sm text-danger">{error}</p> : null}
    </Card>
  )
}
