'use client'

import type { GameId, RoomDto } from '@gp/shared'
import { useEffect, useState } from 'react'
import { GamePicker } from '@/components/room/game-picker'
import { Avatar } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { useI18n } from '@/lib/i18n'
import { SocketAckError } from '@/lib/socket'
import { useAuthStore } from '@/lib/stores/auth-store'
import { type GameStanding, useRoomStore } from '@/lib/stores/room-store'

export interface ResultsScreenProps {
  room: RoomDto
  standings: GameStanding[] | null
}

/** Matches `GameRuntimeService.RESULTS_TO_LOBBY_MS` on the backend exactly.
 * Used only to anchor the DISPLAY countdown below -- see the component doc
 * comment for why this never drives the actual transition. */
const RESULTS_TO_LOBBY_MS = 8_000

/** The room's own return to `lobby` is entirely server-driven -- 8 seconds
 * after `game:ended` (see `RESULTS_TO_LOBBY_MS` on the backend), pushed as
 * an ordinary `room:state` the room store already listens for. This screen
 * never starts its own timer or otherwise drives that transition: the
 * countdown below is anchored to THIS component's own mount time (`page.tsx`
 * only ever renders `<ResultsScreen/>` while `room.status === 'results'`, so
 * mounting coincides with the game having just ended) and simply counts
 * down independently in parallel -- it has no way to speed up, delay, or
 * otherwise affect when the server actually flips the room back to `lobby`.
 */
export function ResultsScreen({ room, standings }: ResultsScreenProps) {
  const { t } = useI18n()
  const user = useAuthStore((s) => s.user)
  const votes = useRoomStore((s) => s.votes)
  const selectGame = useRoomStore((s) => s.selectGame)
  const voteGame = useRoomStore((s) => s.voteGame)

  const [deadline] = useState(() => Date.now() + RESULTS_TO_LOBBY_MS)
  const [now, setNow] = useState(() => Date.now())
  const [showPicker, setShowPicker] = useState(false)
  const [pickerError, setPickerError] = useState<string | null>(null)

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  const secondsLeft = Math.max(0, Math.ceil((deadline - now) / 1000))
  const sorted = [...(standings ?? [])].sort((a, b) => a.placement - b.placement)
  const memberById = new Map(room.members.map((member) => [member.user.id, member.user]))
  const isHost = user !== null && room.hostId === user.id

  async function handleSelectGame(gameId: GameId) {
    setPickerError(null)
    try {
      await selectGame(gameId)
    } catch (err) {
      setPickerError(err instanceof SocketAckError ? err.message : t('room.gamePickerError'))
    }
  }

  async function handleVoteGame(gameId: GameId) {
    setPickerError(null)
    try {
      await voteGame(gameId)
    } catch (err) {
      setPickerError(err instanceof SocketAckError ? err.message : t('room.gamePickerError'))
    }
  }

  return (
    <Card className="flex flex-col gap-4">
      <h2 className="text-xl font-bold text-fg">{t('room.resultsTitle')}</h2>
      {sorted.length === 0 ? null : (
        <ol className="flex flex-col gap-2">
          {sorted.map((standing) => {
            const member = memberById.get(standing.playerId)
            return (
              <li
                key={standing.playerId}
                className="flex items-center gap-3 rounded-lg border border-border bg-surface px-3 py-2"
              >
                <span className="w-6 text-right font-semibold text-fg">{standing.placement}</span>
                <Avatar
                  nickname={member?.nickname ?? '?'}
                  avatarUrl={member?.avatarUrl}
                  size="sm"
                />
                <span className="flex-1 text-fg">{member?.nickname ?? '?'}</span>
                <span className="text-sm text-fg-muted">{standing.score}</span>
              </li>
            )
          })}
        </ol>
      )}

      <p className="text-sm text-fg-muted">
        {t('room.resultsCountdown', { seconds: secondsLeft })}
      </p>

      {user ? (
        <div className="flex flex-col gap-3">
          <Button type="button" variant="secondary" onClick={() => setShowPicker((v) => !v)}>
            {t('room.chooseNextGame')}
          </Button>
          {showPicker ? (
            <>
              <GamePicker
                room={room}
                votes={votes}
                isHost={isHost}
                selfId={user.id}
                onSelect={(id) => void handleSelectGame(id)}
                onVote={(id) => void handleVoteGame(id)}
              />
              {pickerError ? <p className="text-sm text-danger">{pickerError}</p> : null}
            </>
          ) : null}
        </div>
      ) : null}
    </Card>
  )
}
