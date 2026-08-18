'use client'

import { CHAT_MAX_LENGTH } from '@gp/shared'
import { type FormEvent, useEffect, useRef, useState } from 'react'
import { Avatar } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/cn'
import { useI18n } from '@/lib/i18n'
import { SocketAckError } from '@/lib/socket'
import { useAuthStore } from '@/lib/stores/auth-store'
import { useRoomStore } from '@/lib/stores/room-store'

/** Rendered by the room page OUTSIDE the `room.status` switch (see that
 * component) so this panel -- and the message history it holds in
 * room-store.ts, which is never cleared on a status change -- survives
 * `lobby -> in_game -> results -> lobby` exactly like `<VoicePanel/>`. */
export function ChatPanel() {
  const { t, locale } = useI18n()
  const messages = useRoomStore((s) => s.messages)
  const sendChat = useRoomStore((s) => s.sendChat)
  const selfId = useAuthStore((s) => s.user?.id)

  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isSending, setIsSending] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)

  // Intentionally keyed on message COUNT, not the `messages` array
  // reference, so this only re-runs when a message is actually added.
  // biome-ignore lint/correctness/useExhaustiveDependencies: see above
  useEffect(() => {
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages.length])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const trimmed = text.trim()
    if (!trimmed) return
    setError(null)
    setIsSending(true)
    try {
      await sendChat(trimmed)
      setText('')
    } catch (err) {
      setError(err instanceof SocketAckError ? err.message : t('chat.sendError'))
    } finally {
      setIsSending(false)
    }
  }

  return (
    <Card className="flex h-96 flex-col gap-3">
      <h2 className="text-lg font-semibold text-fg">{t('chat.title')}</h2>

      <div ref={listRef} className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
        {messages.length === 0 ? (
          <p className="text-sm text-fg-muted">{t('chat.empty')}</p>
        ) : (
          messages.map((message) => (
            <div
              key={message.id}
              className={cn(
                'flex items-start gap-2 rounded-lg p-1.5',
                message.author.id === selfId && 'bg-surface-hover',
              )}
            >
              <Avatar
                nickname={message.author.nickname}
                avatarUrl={message.author.avatarUrl}
                size="sm"
              />
              <div className="flex min-w-0 flex-col">
                <div className="flex items-baseline gap-2">
                  <span className="text-xs font-medium text-fg-muted">
                    {message.author.nickname}
                  </span>
                  <span className="text-xs text-fg-muted">
                    {new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(
                      new Date(message.sentAt),
                    )}
                  </span>
                </div>
                <span className="break-words text-sm text-fg">{message.text}</span>
              </div>
            </div>
          ))
        )}
      </div>

      <form onSubmit={handleSubmit} className="flex gap-2">
        <Input
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder={t('chat.placeholder')}
          maxLength={CHAT_MAX_LENGTH}
          className="flex-1"
          aria-label={t('chat.title')}
        />
        <Button type="submit" size="sm" isLoading={isSending} disabled={!text.trim()}>
          {t('chat.send')}
        </Button>
      </form>
      {error ? <p className="text-sm text-danger">{error}</p> : null}
    </Card>
  )
}
