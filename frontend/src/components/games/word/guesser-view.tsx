'use client'

import type { PlayerId, RoomMemberDto, WordGameView } from '@gp/shared'
import type { ReactNode } from 'react'
import { Card } from '@/components/ui/card'
import { useI18n } from '@/lib/i18n'
import { resolveNickname } from './team-scoreboard'

export interface GuesserViewProps {
  view: WordGameView
  members: RoomMemberDto[]
  selfId: PlayerId
  /** Rendered between the "who's explaining" banner and the score/results
   * list -- `crocodile-screen.tsx` uses this slot for a read-only
   * `<DrawingCanvas mode="watch"/>`; every other word game passes nothing,
   * which is the "empty area" this task's brief refers to. */
  children?: ReactNode
}

/**
 * The non-explainer's screen. `view.secretWord` is `null` here (the server
 * never sends it to anyone but the explainer -- see `WordGameView`'s own
 * doc comment in `@gp/shared`), so this deliberately never renders anything
 * that implies a hidden-but-present word (no masked input, no letter-count
 * placeholder) -- there is genuinely nothing in this payload to reveal.
 */
export function GuesserView({ view, members, selfId, children }: GuesserViewProps) {
  const { t } = useI18n()
  const explainerNickname = view.explainerId ? resolveNickname(members, view.explainerId) : '?'
  const ownTeam = view.teams.find((team) => team.memberIds.includes(selfId))

  return (
    <Card className="flex flex-col gap-4">
      <div className="rounded-xl border border-border bg-surface-hover px-4 py-6 text-center">
        <p className="text-sm font-medium text-fg">
          {view.phase === 'active'
            ? t('game.explainerActive', { nickname: explainerNickname })
            : t('game.waitingToStart', { nickname: explainerNickname })}
        </p>
      </div>

      {children}

      {ownTeam ? (
        <p className="text-sm font-medium text-fg">
          {t('game.yourScore', { score: ownTeam.score })}
        </p>
      ) : null}

      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold text-fg-muted">{t('game.lastResultsTitle')}</h3>
        {view.lastResults.length === 0 ? (
          <p className="text-sm text-fg-muted">{t('game.lastResultsEmpty')}</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {view.lastResults.map((result) => (
              <li
                key={result.word}
                className="flex items-center justify-between rounded-lg border border-border bg-surface px-3 py-1.5 text-sm"
              >
                <span className="text-fg">{result.word}</span>
                <span className={result.guessed ? 'text-success' : 'text-fg-muted'}>
                  {result.guessed ? t('game.guessedBadge') : t('game.skippedBadge')}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  )
}
