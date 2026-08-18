'use client'

import type { GameId, RoomDto, RoomVisibility } from '@gp/shared'
import { GAME_CATALOG, ROOM_MAX_PLAYERS, ROOM_MIN_PLAYERS } from '@gp/shared'
import { useRouter } from 'next/navigation'
import { type FormEvent, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Modal } from '@/components/ui/modal'
import { Select } from '@/components/ui/select'
import { ApiError, api } from '@/lib/api'
import { useI18n } from '@/lib/i18n'

export interface CreateRoomDialogProps {
  open: boolean
  onClose: () => void
  /** Preselected game -- e.g. carried over from the room browser's current
   * game filter when the dialog is opened, per the task-20 brief
   * ("create-room-dialog -- visibility, max players (2-10), optional
   * preselected game"). */
  initialGameId?: GameId | null
}

function clampMaxPlayers(value: number): number {
  if (!Number.isFinite(value)) return ROOM_MIN_PLAYERS
  return Math.min(ROOM_MAX_PLAYERS, Math.max(ROOM_MIN_PLAYERS, Math.round(value)))
}

async function copyInviteLink(code: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(`${window.location.origin}/room/${code}`)
  } catch {
    // Clipboard access can be denied (permissions, insecure context,
    // headless test runners) -- the room is still created and navigation
    // still happens, so copying the link is best-effort only.
  }
}

export function CreateRoomDialog({ open, onClose, initialGameId = null }: CreateRoomDialogProps) {
  const { t } = useI18n()
  const router = useRouter()

  const [visibility, setVisibility] = useState<RoomVisibility>('public')
  const [maxPlayers, setMaxPlayers] = useState(ROOM_MAX_PLAYERS)
  const [gameId, setGameId] = useState<GameId | ''>(initialGameId ?? '')
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setIsSubmitting(true)
    try {
      const room = await api.post<RoomDto>('/rooms', {
        visibility,
        maxPlayers: clampMaxPlayers(maxPlayers),
        ...(gameId ? { gameId } : {}),
      })
      await copyInviteLink(room.code)
      onClose()
      router.push(`/room/${room.code}`)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('room.createError'))
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={t('room.createRoomTitle')}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Select
          label={t('room.visibilityLabel')}
          value={visibility}
          onChange={(event) => setVisibility(event.target.value as RoomVisibility)}
        >
          <option value="public">{t('room.visibilityPublic')}</option>
          <option value="private">{t('room.visibilityPrivate')}</option>
        </Select>

        <Input
          label={t('room.maxPlayersLabel')}
          type="number"
          min={ROOM_MIN_PLAYERS}
          max={ROOM_MAX_PLAYERS}
          value={maxPlayers}
          onChange={(event) => setMaxPlayers(Number(event.target.value))}
        />

        <Select
          label={t('room.gameLabel')}
          value={gameId}
          onChange={(event) => setGameId(event.target.value as GameId | '')}
        >
          <option value="">{t('room.gameNone')}</option>
          {GAME_CATALOG.map((game) => (
            <option key={game.id} value={game.id}>
              {t(game.titleKey)}
            </option>
          ))}
        </Select>

        {error ? <p className="text-sm text-danger">{error}</p> : null}

        <Button type="submit" isLoading={isSubmitting}>
          {isSubmitting ? t('room.creatingRoom') : t('room.createSubmit')}
        </Button>
      </form>
    </Modal>
  )
}
