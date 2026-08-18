'use client'

import type { GameId, PlayerId } from '@gp/shared'
import { useState } from 'react'
import { GamePicker } from '@/components/room/game-picker'
import { MemberList } from '@/components/room/member-list'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { useI18n } from '@/lib/i18n'
import { SocketAckError } from '@/lib/socket'
import { useAuthStore } from '@/lib/stores/auth-store'
import { useRoomStore } from '@/lib/stores/room-store'

export function Lobby() {
  const { t } = useI18n()
  const room = useRoomStore((s) => s.room)
  const votes = useRoomStore((s) => s.votes)
  const setReady = useRoomStore((s) => s.setReady)
  const selectGame = useRoomStore((s) => s.selectGame)
  const voteGame = useRoomStore((s) => s.voteGame)
  const startGame = useRoomStore((s) => s.startGame)
  const kick = useRoomStore((s) => s.kick)
  const ban = useRoomStore((s) => s.ban)
  const transferHost = useRoomStore((s) => s.transferHost)
  const user = useAuthStore((s) => s.user)

  const [readyError, setReadyError] = useState<string | null>(null)
  const [isTogglingReady, setIsTogglingReady] = useState(false)
  const [startError, setStartError] = useState<string | null>(null)
  const [isStarting, setIsStarting] = useState(false)
  const [gameError, setGameError] = useState<string | null>(null)
  const [memberError, setMemberError] = useState<string | null>(null)

  if (!room || !user) return null

  const self = room.members.find((member) => member.user.id === user.id)
  const isHost = room.hostId === user.id
  const readyCount = room.members.filter((member) => member.isReady).length

  async function handleToggleReady() {
    if (!self) return
    setReadyError(null)
    setIsTogglingReady(true)
    try {
      await setReady(!self.isReady)
    } catch (err) {
      setReadyError(err instanceof SocketAckError ? err.message : t('room.readyError'))
    } finally {
      setIsTogglingReady(false)
    }
  }

  async function handleStart() {
    setStartError(null)
    setIsStarting(true)
    try {
      await startGame()
    } catch (err) {
      setStartError(err instanceof SocketAckError ? err.message : t('room.startGameError'))
    } finally {
      setIsStarting(false)
    }
  }

  async function handleSelectGame(gameId: GameId) {
    setGameError(null)
    try {
      await selectGame(gameId)
    } catch (err) {
      setGameError(err instanceof SocketAckError ? err.message : t('room.gamePickerError'))
    }
  }

  async function handleVoteGame(gameId: GameId) {
    setGameError(null)
    try {
      await voteGame(gameId)
    } catch (err) {
      setGameError(err instanceof SocketAckError ? err.message : t('room.gamePickerError'))
    }
  }

  async function handleKick(userId: PlayerId) {
    setMemberError(null)
    try {
      await kick(userId)
    } catch (err) {
      setMemberError(err instanceof SocketAckError ? err.message : t('room.memberActionError'))
    }
  }

  async function handleBan(userId: PlayerId) {
    setMemberError(null)
    try {
      await ban(userId)
    } catch (err) {
      setMemberError(err instanceof SocketAckError ? err.message : t('room.memberActionError'))
    }
  }

  async function handleTransferHost(userId: PlayerId) {
    setMemberError(null)
    try {
      await transferHost(userId)
    } catch (err) {
      setMemberError(err instanceof SocketAckError ? err.message : t('room.memberActionError'))
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Card className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-sm text-fg-muted">
          {t('room.readyStatus', { ready: readyCount, total: room.members.length })}
        </span>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant={self?.isReady ? 'secondary' : 'primary'}
            isLoading={isTogglingReady}
            onClick={() => void handleToggleReady()}
          >
            {self?.isReady ? t('room.readyOff') : t('room.readyOn')}
          </Button>
          {isHost ? (
            <Button
              type="button"
              disabled={!room.selectedGameId}
              isLoading={isStarting}
              onClick={() => void handleStart()}
            >
              {isStarting ? t('room.startingGame') : t('room.startGame')}
            </Button>
          ) : null}
        </div>
      </Card>
      {readyError ? <p className="text-sm text-danger">{readyError}</p> : null}
      {startError ? <p className="text-sm text-danger">{startError}</p> : null}

      <Card className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold text-fg">{t('room.membersTitle')}</h2>
        <MemberList
          members={room.members}
          hostId={room.hostId}
          selfId={user.id}
          isSelfHost={isHost}
          onKick={(id) => void handleKick(id)}
          onBan={(id) => void handleBan(id)}
          onTransferHost={(id) => void handleTransferHost(id)}
        />
        {memberError ? <p className="text-sm text-danger">{memberError}</p> : null}
      </Card>

      <Card>
        <GamePicker
          room={room}
          votes={votes}
          isHost={isHost}
          selfId={user.id}
          onSelect={(id) => void handleSelectGame(id)}
          onVote={(id) => void handleVoteGame(id)}
        />
        {gameError ? <p className="mt-2 text-sm text-danger">{gameError}</p> : null}
      </Card>
    </div>
  )
}
