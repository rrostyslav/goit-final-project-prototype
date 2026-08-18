'use client'

import type { PublicUser } from '@gp/shared'
import Link from 'next/link'
import { type FormEvent, useState } from 'react'
import { SiteHeader } from '@/components/layout/site-header'
import { FriendsList } from '@/components/profile/friends-list'
import { MatchHistory } from '@/components/profile/match-history'
import { Avatar } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { ApiError, api } from '@/lib/api'
import { useI18n } from '@/lib/i18n'
import { useAuthStore } from '@/lib/stores/auth-store'

function ProfileEditor({ user }: { user: PublicUser }) {
  const { t } = useI18n()

  const [nickname, setNickname] = useState(user.nickname)
  const [avatarUrl, setAvatarUrl] = useState(user.avatarUrl ?? '')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [isSaving, setIsSaving] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const trimmedNickname = nickname.trim()
    if (!trimmedNickname) {
      setError(t('auth.nicknameRequired'))
      setSuccess(false)
      return
    }
    setError(null)
    setSuccess(false)
    setIsSaving(true)
    try {
      const trimmedAvatarUrl = avatarUrl.trim()
      const updated = await api.patch<PublicUser>('/users/me', {
        nickname: trimmedNickname,
        // The backend validates avatarUrl with @IsUrl() when present -- an
        // empty string is not a valid URL, so an empty field is simply
        // omitted (no-op) rather than sent, since there is no "clear the
        // avatar" affordance in UpdateProfileDto.
        ...(trimmedAvatarUrl ? { avatarUrl: trimmedAvatarUrl } : {}),
      })
      useAuthStore.setState({ user: updated })
      setNickname(updated.nickname)
      setAvatarUrl(updated.avatarUrl ?? '')
      setSuccess(true)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('profile.saveError'))
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Card className="flex flex-col gap-4">
      <div className="flex items-center gap-4">
        <Avatar nickname={user.nickname} avatarUrl={user.avatarUrl} size="lg" />
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-bold text-fg">{t('profile.title')}</h1>
          {user.isGuest ? (
            <span className="w-fit rounded-full bg-surface-hover px-2 py-0.5 text-xs text-fg-muted">
              {t('profile.guestBadge')}
            </span>
          ) : null}
        </div>
      </div>

      {user.isGuest ? (
        <p className="text-sm text-fg-muted">
          {t('profile.upgradeHint')}{' '}
          <Link href="/register" className="text-primary hover:underline">
            {t('profile.upgradeLinkLabel')}
          </Link>
        </p>
      ) : null}

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Input
          label={t('auth.nicknameLabel')}
          value={nickname}
          onChange={(event) => setNickname(event.target.value)}
          maxLength={32}
        />
        <Input
          label={t('profile.avatarUrlLabel')}
          placeholder={t('profile.avatarUrlPlaceholder')}
          value={avatarUrl}
          onChange={(event) => setAvatarUrl(event.target.value)}
        />
        {error ? <p className="text-sm text-danger">{error}</p> : null}
        {success ? <p className="text-sm text-success">{t('profile.saveSuccess')}</p> : null}
        <Button type="submit" isLoading={isSaving} className="w-fit">
          {isSaving ? t('profile.saving') : t('profile.saveButton')}
        </Button>
      </form>
    </Card>
  )
}

export default function ProfilePage() {
  const { t } = useI18n()
  const user = useAuthStore((s) => s.user)
  const hasHydrated = useAuthStore((s) => s.hasHydrated)

  return (
    <main className="flex min-h-screen flex-col items-center gap-8 px-4 py-10">
      <SiteHeader />

      {!hasHydrated ? (
        <div
          aria-hidden="true"
          className="h-48 w-full max-w-3xl animate-pulse rounded-2xl border border-border bg-surface"
        />
      ) : !user ? (
        <Card className="flex w-full max-w-sm flex-col items-center gap-3 text-center">
          <p className="text-sm text-fg-muted">{t('profile.loginRequired')}</p>
          <Link href="/login">
            <Button>{t('nav.login')}</Button>
          </Link>
        </Card>
      ) : (
        <div className="flex w-full max-w-3xl flex-col gap-8">
          <ProfileEditor user={user} />
          <FriendsList />
          <MatchHistory userId={user.id} />
        </div>
      )}
    </main>
  )
}
