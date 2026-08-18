'use client'

import type { RoomMemberDto, UserId } from '@gp/shared'
import { Avatar } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/cn'
import { useI18n } from '@/lib/i18n'

export interface MemberListProps {
  members: RoomMemberDto[]
  hostId: UserId
  selfId: UserId
  /** Host-only moderation actions -- omitted entirely (not just disabled)
   * for a non-host viewer, since the backend rejects them outright and
   * showing a button that always fails is worse than not showing one. */
  isSelfHost: boolean
  onKick: (userId: UserId) => void
  onBan: (userId: UserId) => void
  onTransferHost: (userId: UserId) => void
}

export function MemberList({
  members,
  hostId,
  selfId,
  isSelfHost,
  onKick,
  onBan,
  onTransferHost,
}: MemberListProps) {
  const { t } = useI18n()

  return (
    <ul className="flex flex-col gap-2">
      {members.map((member) => {
        const isHostRow = member.user.id === hostId
        const isSelfRow = member.user.id === selfId
        const isDisconnected = member.connection === 'disconnected'

        return (
          <li
            key={member.user.id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface px-3 py-2"
          >
            <div className="flex items-center gap-3">
              <Avatar
                nickname={member.user.nickname}
                avatarUrl={member.user.avatarUrl}
                size="sm"
                className={cn(isDisconnected && 'opacity-40')}
              />
              <div className="flex flex-col">
                <span className={cn('text-sm', isDisconnected ? 'text-fg-muted' : 'text-fg')}>
                  {member.user.nickname}
                </span>
                <div className="flex flex-wrap gap-1 text-xs text-fg-muted">
                  {isHostRow ? <span>{t('room.hostBadge')}</span> : null}
                  {isSelfRow ? <span>{t('room.youBadge')}</span> : null}
                  {isDisconnected ? <span>{t('room.reconnectingBadge')}</span> : null}
                  <span>{member.isReady ? t('room.readyOn') : t('room.readyOff')}</span>
                </div>
              </div>
            </div>

            {isSelfHost && !isHostRow ? (
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => onTransferHost(member.user.id)}
                >
                  {t('room.memberTransferHost')}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => onKick(member.user.id)}
                >
                  {t('room.memberKick')}
                </Button>
                <Button
                  type="button"
                  variant="danger"
                  size="sm"
                  onClick={() => onBan(member.user.id)}
                >
                  {t('room.memberBan')}
                </Button>
              </div>
            ) : null}
          </li>
        )
      })}
    </ul>
  )
}
