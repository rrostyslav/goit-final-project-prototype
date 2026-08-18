'use client'

import type { GameId, PlayerId, RoomDto, UserId } from '@gp/shared'
import { GAME_CATALOG } from '@gp/shared'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/cn'
import { useI18n } from '@/lib/i18n'

export interface GamePickerProps {
  room: RoomDto
  votes: Record<string, PlayerId[]>
  /** `room:select_game` is host-only (the backend enforces this too -- see
   * RoomsService.selectGame's assertHost); `room:vote_game` is open to every
   * member. Both modes render side by side per the brief -- a non-host still
   * gets to vote, the host still sees everyone's votes while deciding. */
  isHost: boolean
  selfId: UserId
  onSelect: (gameId: GameId) => void
  onVote: (gameId: GameId) => void
}

export function GamePicker({ room, votes, isHost, selfId, onSelect, onVote }: GamePickerProps) {
  const { t } = useI18n()
  const memberCount = room.members.length

  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold text-fg">{t('room.gamePickerTitle')}</h2>
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {GAME_CATALOG.map((game) => {
          const fits = memberCount >= game.minPlayers && memberCount <= game.maxPlayers
          const isSelected = room.selectedGameId === game.id
          const gameVotes = votes[game.id] ?? []
          const hasVoted = gameVotes.includes(selfId)

          return (
            <li
              key={game.id}
              className={cn(
                'flex flex-col gap-2 rounded-xl border p-4 transition-colors',
                isSelected ? 'border-primary bg-surface-hover' : 'border-border bg-surface',
                !fits && 'opacity-50',
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-fg">{t(game.titleKey)}</span>
                {isSelected ? (
                  <span className="rounded-full bg-primary px-2 py-0.5 text-xs text-primary-fg">
                    {t('room.gamePickerSelected')}
                  </span>
                ) : null}
              </div>
              <span className="text-xs text-fg-muted">
                {t('room.gamePickerPlayersRange', { min: game.minPlayers, max: game.maxPlayers })}
              </span>
              <div className="flex flex-wrap items-center gap-2">
                {isHost ? (
                  <Button
                    type="button"
                    size="sm"
                    variant={isSelected ? 'secondary' : 'primary'}
                    disabled={!fits}
                    onClick={() => onSelect(game.id)}
                  >
                    {t('room.gamePickerSelectButton')}
                  </Button>
                ) : null}
                <Button
                  type="button"
                  size="sm"
                  variant={hasVoted ? 'secondary' : 'ghost'}
                  disabled={!fits}
                  onClick={() => onVote(game.id)}
                >
                  {hasVoted ? t('room.gamePickerVoted') : t('room.gamePickerVoteButton')}
                </Button>
                {gameVotes.length > 0 ? (
                  <span className="text-xs text-fg-muted">
                    {t('room.gamePickerVotes', { count: gameVotes.length })}
                  </span>
                ) : null}
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
