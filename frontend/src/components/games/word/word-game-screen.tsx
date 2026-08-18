'use client'

import type { GameAction, PlayerId, WordGameView } from '@gp/shared'
import { getGameMeta } from '@gp/shared'
import type { ReactNode } from 'react'
import { useState } from 'react'
import { Card } from '@/components/ui/card'
import { useI18n } from '@/lib/i18n'
import { SocketAckError } from '@/lib/socket'
import { useAuthStore } from '@/lib/stores/auth-store'
import { useRoomStore } from '@/lib/stores/room-store'
import { ExplainerControls } from './explainer-controls'
import { GuesserView } from './guesser-view'
import { RoundTimer } from './round-timer'
import { TeamScoreboard } from './team-scoreboard'

export interface WordGameScreenProps {
  view: WordGameView
  /** Lets `crocodile-screen.tsx` slot its `<DrawingCanvas/>` into whichever
   * of `<ExplainerControls/>`/`<GuesserView/>` actually renders for this
   * viewer -- see those components' own doc comments on `children`. Alias
   * and Hat never pass this. */
  renderExtra?: (isExplainer: boolean) => ReactNode
}

/**
 * The shared screen for Alias, Hat and Crocodile (`crocodile-screen.tsx`
 * wraps this rather than duplicating it -- see that file). Renders the
 * scoreboard and the server-driven countdown unconditionally, then EITHER
 * `<ExplainerControls/>` or `<GuesserView/>` depending on whether this
 * viewer is `view.explainerId` -- never both, and never a guesser-side
 * component that could reach `sendAction({ type: 'word/correct', ... })`:
 * that dispatch only exists inside the branch gated on `isExplainer` below.
 */
export function WordGameScreen({ view, renderExtra }: WordGameScreenProps) {
  const { t } = useI18n()
  const room = useRoomStore((s) => s.room)
  const sendAction = useRoomStore((s) => s.sendAction)
  const gameError = useRoomStore((s) => s.gameError)
  const clearGameError = useRoomStore((s) => s.clearGameError)
  const selfId = useAuthStore((s) => s.user?.id)

  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  if (!room || !selfId) return null

  const meta = getGameMeta(view.gameId)
  const isExplainer = view.explainerId === selfId
  const displayError = error ?? gameError?.message ?? null

  async function dispatch(action: GameAction) {
    setError(null)
    clearGameError()
    setIsSubmitting(true)
    try {
      await sendAction(action)
    } catch (err) {
      setError(err instanceof SocketAckError ? err.message : t('game.actionError'))
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Card className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-xl font-bold text-fg">{t(meta.titleKey)}</h2>
          <span className="text-sm text-fg-muted">
            {t('game.roundProgress', { round: view.round, totalRounds: view.totalRounds })}
          </span>
        </div>
        <RoundTimer deadline={view.roundEndsAt} paused={view.roundPaused} />
      </Card>

      <Card>
        <TeamScoreboard
          teams={view.teams}
          activeTeamId={view.activeTeamId}
          teamBased={meta.teamBased}
          members={room.members}
          selfId={selfId}
        />
      </Card>

      {view.phase === 'finished' ? (
        <Card className="text-center">
          <p className="text-sm text-fg-muted">{t('game.gameFinishedNotice')}</p>
        </Card>
      ) : isExplainer ? (
        <ExplainerControls
          view={view}
          members={room.members}
          isSubmitting={isSubmitting}
          error={displayError}
          onStartRound={() => void dispatch({ type: 'word/start_round' })}
          onCorrect={(guesserId: PlayerId | undefined) =>
            void dispatch({ type: 'word/correct', guesserId })
          }
          onSkip={() => void dispatch({ type: 'word/skip' })}
          onEndRound={() => void dispatch({ type: 'word/end_round' })}
        >
          {renderExtra?.(true)}
        </ExplainerControls>
      ) : (
        <GuesserView view={view} members={room.members} selfId={selfId}>
          {renderExtra?.(false)}
        </GuesserView>
      )}
    </div>
  )
}
