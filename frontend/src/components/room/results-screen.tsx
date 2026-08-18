'use client'

import type { RoomDto } from '@gp/shared'
import { Avatar } from '@/components/ui/avatar'
import { Card } from '@/components/ui/card'
import { useI18n } from '@/lib/i18n'
import type { GameStanding } from '@/lib/stores/room-store'

export interface ResultsScreenProps {
  room: RoomDto
  standings: GameStanding[] | null
}

/** The room's own return to `lobby` is entirely server-driven -- 8 seconds
 * after `game:ended` (see GameRuntimeService.RESULTS_TO_LOBBY_MS on the
 * backend), pushed as an ordinary `room:state` the room store already
 * listens for. This screen never starts its own timer or otherwise drives
 * that transition; it only displays whatever `standings` the store already
 * holds from `game:ended` and says so. */
export function ResultsScreen({ room, standings }: ResultsScreenProps) {
  const { t } = useI18n()
  const sorted = [...(standings ?? [])].sort((a, b) => a.placement - b.placement)
  const memberById = new Map(room.members.map((member) => [member.user.id, member.user]))

  return (
    <Card className="flex flex-col gap-4">
      <h2 className="text-xl font-bold text-fg">{t('room.resultsTitle')}</h2>
      {sorted.length === 0 ? null : (
        <ol className="flex flex-col gap-2">
          {sorted.map((standing) => {
            const user = memberById.get(standing.playerId)
            return (
              <li
                key={standing.playerId}
                className="flex items-center gap-3 rounded-lg border border-border bg-surface px-3 py-2"
              >
                <span className="w-6 text-right font-semibold text-fg">{standing.placement}</span>
                <Avatar nickname={user?.nickname ?? '?'} avatarUrl={user?.avatarUrl} size="sm" />
                <span className="flex-1 text-fg">{user?.nickname ?? '?'}</span>
                <span className="text-sm text-fg-muted">{standing.score}</span>
              </li>
            )
          })}
        </ol>
      )}
      <p className="text-sm text-fg-muted">{t('room.resultsReturning')}</p>
    </Card>
  )
}
