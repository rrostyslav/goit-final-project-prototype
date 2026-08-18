'use client'

import type { RoomId } from '@gp/shared'
import { Avatar } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { cn } from '@/lib/cn'
import { useI18n } from '@/lib/i18n'
import { useAuthStore } from '@/lib/stores/auth-store'
import { useRoomStore } from '@/lib/stores/room-store'
import { useVoice, type VoiceStatus } from '@/lib/use-voice'

export interface VoicePanelProps {
  roomId: RoomId
}

const STATUS_KEYS: Record<VoiceStatus, string> = {
  idle: 'voice.connecting',
  connecting: 'voice.connecting',
  connected: 'voice.connected',
  mic_denied: 'voice.micDenied',
  error: 'voice.error',
  disabled: 'voice.disabled',
}

/** Rendered by the room page OUTSIDE the `room.status` switch (see that
 * component), so `useVoice`'s LiveKit connection is created once, on mount,
 * and never torn down just because the room moved through
 * `lobby -> in_game -> results -> lobby` -- the entire point of a
 * "persistent voice room". */
export function VoicePanel({ roomId }: VoicePanelProps) {
  const { t } = useI18n()
  const room = useRoomStore((s) => s.room)
  const selfId = useAuthStore((s) => s.user?.id)
  const { enabled, connected, muted, speakers, status, errorMessage, toggleMute } = useVoice(roomId)

  return (
    <Card className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-fg">{t('voice.title')}</h2>
        {enabled && connected ? (
          <Button
            type="button"
            size="sm"
            variant={muted ? 'secondary' : 'primary'}
            onClick={toggleMute}
          >
            {muted ? t('voice.unmute') : t('voice.mute')}
          </Button>
        ) : null}
      </div>

      <p
        className={cn(
          'text-sm',
          status === 'error' || status === 'mic_denied' ? 'text-danger' : 'text-fg-muted',
        )}
      >
        {t(STATUS_KEYS[status])}
        {errorMessage ? ` — ${errorMessage}` : ''}
      </p>

      {enabled && room ? (
        <ul className="flex flex-col gap-2">
          {room.members.map((member) => {
            const isSelfRow = member.user.id === selfId
            const isSelfMuted = isSelfRow && muted
            const isSpeaking = speakers.has(member.user.id) && !isSelfMuted

            return (
              <li key={member.user.id} className="flex items-center gap-2">
                <Avatar
                  nickname={member.user.nickname}
                  avatarUrl={member.user.avatarUrl}
                  size="sm"
                  className={cn(isSpeaking && 'ring-2 ring-success')}
                />
                <span className="flex-1 text-sm text-fg">{member.user.nickname}</span>
                <MicIcon speaking={isSpeaking} muted={isSelfMuted} />
              </li>
            )
          })}
        </ul>
      ) : null}
    </Card>
  )
}

function MicIcon({ speaking, muted }: { speaking: boolean; muted: boolean }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className={speaking ? 'text-success' : 'text-fg-muted'}
    >
      <path
        d="M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3Z"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path
        d="M19 11a7 7 0 0 1-14 0M12 18v3"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      {muted ? (
        <path d="M4 4L20 20" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      ) : null}
    </svg>
  )
}
