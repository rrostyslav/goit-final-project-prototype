'use client'

import type { Locale, RoomDto } from '@gp/shared'
import {
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  ROOM_MAX_PLAYERS,
  SUPPORTED_LOCALES,
} from '@gp/shared'
import { useRouter } from 'next/navigation'
import { type FormEvent, useState } from 'react'
import { Avatar } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { ApiError, api } from '@/lib/api'
import { cn } from '@/lib/cn'
import { useI18n } from '@/lib/i18n'
import { useAuthStore } from '@/lib/stores/auth-store'

const LOCALE_LABEL_KEYS: Record<Locale, string> = {
  uk: 'nav.localeUk',
  en: 'nav.localeEn',
}

/** Room codes deliberately exclude I, O, 0 and 1 so a code read aloud or
 * copied off a screen is unambiguous. Enforce that alphabet as the user
 * types rather than letting an impossible code reach the server as a 404. */
function sanitizeRoomCode(raw: string): string {
  return raw
    .toUpperCase()
    .split('')
    .filter((char) => ROOM_CODE_ALPHABET.includes(char))
    .join('')
    .slice(0, ROOM_CODE_LENGTH)
}

export default function LandingPage() {
  const { t, locale, setLocale } = useI18n()
  const user = useAuthStore((s) => s.user)
  const hasHydrated = useAuthStore((s) => s.hasHydrated)

  return (
    <main className="flex min-h-screen flex-col items-center gap-10 px-4 py-16">
      <LocaleSwitch locale={locale} onChange={setLocale} />

      <section className="flex max-w-xl flex-col items-center gap-4 text-center">
        <h1 className="text-3xl font-bold text-fg sm:text-4xl">{t('app.heroTitle')}</h1>
        <p className="text-base text-fg-muted">{t('app.heroBody')}</p>
        <ul className="flex flex-col gap-1 text-sm text-fg-muted">
          <li>{t('app.featureVoice')}</li>
          <li>{t('app.featureGames')}</li>
          <li>{t('app.featureRooms')}</li>
        </ul>
      </section>

      {!hasHydrated ? (
        <div
          aria-hidden="true"
          className="h-48 w-full max-w-sm animate-pulse rounded-2xl border border-border bg-surface"
        />
      ) : user ? (
        <AuthenticatedPanel nickname={user.nickname} avatarUrl={user.avatarUrl} />
      ) : (
        <GuestPanel />
      )}
    </main>
  )
}

function LocaleSwitch({
  locale,
  onChange,
}: {
  locale: Locale
  onChange: (locale: Locale) => void
}) {
  const { t } = useI18n()
  return (
    <div className="flex gap-1 rounded-lg border border-border bg-surface p-1">
      {SUPPORTED_LOCALES.map((option) => (
        <button
          key={option}
          type="button"
          onClick={() => onChange(option)}
          className={cn(
            'rounded-md px-3 py-1 text-sm transition-colors',
            option === locale ? 'bg-primary text-primary-fg' : 'text-fg-muted hover:text-fg',
          )}
        >
          {t(LOCALE_LABEL_KEYS[option])}
        </button>
      ))}
    </div>
  )
}

function GuestPanel() {
  const { t } = useI18n()
  const loginAsGuest = useAuthStore((s) => s.loginAsGuest)

  const [nickname, setNickname] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const trimmed = nickname.trim()
    if (!trimmed) {
      setError(t('auth.nicknameRequired'))
      return
    }
    setError(null)
    setIsSubmitting(true)
    try {
      await loginAsGuest(trimmed)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('auth.guestError'))
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Card className="w-full max-w-sm">
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Input
          label={t('auth.nicknameLabel')}
          placeholder={t('auth.nicknamePlaceholder')}
          value={nickname}
          onChange={(event) => setNickname(event.target.value)}
          error={error ?? undefined}
          maxLength={32}
          autoComplete="nickname"
        />
        <Button type="submit" isLoading={isSubmitting}>
          {isSubmitting ? t('auth.playingAsGuest') : t('auth.playAsGuest')}
        </Button>
      </form>
    </Card>
  )
}

function AuthenticatedPanel({
  nickname,
  avatarUrl,
}: {
  nickname: string
  avatarUrl: string | null
}) {
  const { t } = useI18n()
  const router = useRouter()
  const logout = useAuthStore((s) => s.logout)

  const [isCreatingRoom, setIsCreatingRoom] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  const [roomCode, setRoomCode] = useState('')
  const [codeError, setCodeError] = useState<string | null>(null)

  async function handleCreateRoom() {
    setCreateError(null)
    setIsCreatingRoom(true)
    try {
      const room = await api.post<RoomDto>('/rooms', {
        visibility: 'private',
        maxPlayers: ROOM_MAX_PLAYERS,
      })
      router.push(`/room/${room.code}`)
    } catch (err) {
      setCreateError(err instanceof ApiError ? err.message : t('room.createError'))
    } finally {
      setIsCreatingRoom(false)
    }
  }

  function handleJoinSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const code = sanitizeRoomCode(roomCode)
    if (code.length !== ROOM_CODE_LENGTH) {
      setCodeError(t('room.codeInvalidLength'))
      return
    }
    setCodeError(null)
    router.push(`/room/${code}`)
  }

  return (
    <Card className="flex w-full max-w-sm flex-col gap-6">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Avatar nickname={nickname} avatarUrl={avatarUrl} size="sm" />
          <span className="text-sm text-fg">{t('common.loggedInAs', { nickname })}</span>
        </div>
        <Button variant="ghost" size="sm" onClick={() => void logout()}>
          {t('common.logout')}
        </Button>
      </div>

      <div className="flex flex-col gap-2">
        <Button onClick={() => void handleCreateRoom()} isLoading={isCreatingRoom}>
          {isCreatingRoom ? t('room.creatingRoom') : t('room.createRoom')}
        </Button>
        {createError ? <p className="text-sm text-danger">{createError}</p> : null}
      </div>

      <form onSubmit={handleJoinSubmit} className="flex flex-col gap-2">
        <Input
          label={t('room.joinTitle')}
          placeholder={t('room.codePlaceholder')}
          value={roomCode}
          onChange={(event) => setRoomCode(sanitizeRoomCode(event.target.value))}
          error={codeError ?? undefined}
          maxLength={ROOM_CODE_LENGTH}
        />
        <Button type="submit" variant="secondary">
          {t('room.join')}
        </Button>
      </form>
    </Card>
  )
}
