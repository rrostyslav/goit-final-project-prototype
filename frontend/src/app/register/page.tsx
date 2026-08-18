'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { type FormEvent, useState } from 'react'
import { GoogleButton } from '@/components/auth/google-button'
import { SiteHeader } from '@/components/layout/site-header'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { ApiError } from '@/lib/api'
import { useI18n } from '@/lib/i18n'
import { useAuthStore } from '@/lib/stores/auth-store'
import { useOauthEnabled } from '@/lib/use-oauth-enabled'

const PASSWORD_MIN_LENGTH = 8

function Divider({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 text-xs text-fg-muted">
      <span className="h-px flex-1 bg-border" />
      {label}
      <span className="h-px flex-1 bg-border" />
    </div>
  )
}

function RegisterForm() {
  const { t } = useI18n()
  const router = useRouter()
  const register = useAuthStore((s) => s.register)

  const [nickname, setNickname] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const trimmedNickname = nickname.trim()
    if (!trimmedNickname) {
      setError(t('auth.nicknameRequired'))
      return
    }
    if (password.length < PASSWORD_MIN_LENGTH) {
      setError(t('auth.passwordMinLength'))
      return
    }
    setError(null)
    setIsSubmitting(true)
    try {
      await register(email.trim(), password, trimmedNickname)
      router.push('/')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('auth.registerError'))
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <h1 className="text-xl font-bold text-fg">{t('auth.registerTitle')}</h1>
      <Input
        label={t('auth.nicknameLabel')}
        placeholder={t('auth.nicknamePlaceholder')}
        value={nickname}
        onChange={(event) => setNickname(event.target.value)}
        maxLength={32}
        autoComplete="nickname"
        required
      />
      <Input
        label={t('auth.emailLabel')}
        type="email"
        placeholder={t('auth.emailPlaceholder')}
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        autoComplete="email"
        required
      />
      <Input
        label={t('auth.passwordLabel')}
        type="password"
        placeholder={t('auth.passwordPlaceholder')}
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        autoComplete="new-password"
        required
      />
      {error ? <p className="text-sm text-danger">{error}</p> : null}
      <Button type="submit" isLoading={isSubmitting}>
        {isSubmitting ? t('auth.registerSubmitting') : t('auth.registerButton')}
      </Button>
    </form>
  )
}

/** A guest landing on /register keeps their identity (id, friends, match
 * history) instead of being funneled into a fresh signup that would
 * abandon it -- see POST /auth/upgrade and the task-20 brief's guest-upgrade
 * ambiguity note. */
function UpgradeForm({ nickname }: { nickname: string }) {
  const { t } = useI18n()
  const router = useRouter()
  const upgrade = useAuthStore((s) => s.upgrade)

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (password.length < PASSWORD_MIN_LENGTH) {
      setError(t('auth.passwordMinLength'))
      return
    }
    setError(null)
    setIsSubmitting(true)
    try {
      await upgrade(email.trim(), password)
      router.push('/')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('auth.upgradeError'))
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <h1 className="text-xl font-bold text-fg">{t('auth.upgradeTitle')}</h1>
      <p className="text-sm text-fg-muted">{t('auth.upgradeBody', { nickname })}</p>
      <Input
        label={t('auth.emailLabel')}
        type="email"
        placeholder={t('auth.emailPlaceholder')}
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        autoComplete="email"
        required
      />
      <Input
        label={t('auth.passwordLabel')}
        type="password"
        placeholder={t('auth.passwordPlaceholder')}
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        autoComplete="new-password"
        required
      />
      {error ? <p className="text-sm text-danger">{error}</p> : null}
      <Button type="submit" isLoading={isSubmitting}>
        {isSubmitting ? t('auth.upgradeSubmitting') : t('auth.upgradeButton')}
      </Button>
    </form>
  )
}

export default function RegisterPage() {
  const { t } = useI18n()
  const user = useAuthStore((s) => s.user)
  const hasHydrated = useAuthStore((s) => s.hasHydrated)
  const oauthEnabled = useOauthEnabled()

  if (!hasHydrated) {
    return (
      <main className="flex min-h-screen flex-col items-center gap-10 px-4 py-16">
        <SiteHeader />
        <div
          aria-hidden="true"
          className="h-64 w-full max-w-sm animate-pulse rounded-2xl border border-border bg-surface"
        />
      </main>
    )
  }

  if (user && !user.isGuest) {
    return (
      <main className="flex min-h-screen flex-col items-center gap-10 px-4 py-16">
        <SiteHeader />
        <Card className="flex w-full max-w-sm flex-col items-center gap-3 text-center">
          <p className="text-sm text-fg-muted">{t('auth.alreadyLoggedIn')}</p>
          <Link href="/">
            <Button>{t('nav.home')}</Button>
          </Link>
        </Card>
      </main>
    )
  }

  return (
    <main className="flex min-h-screen flex-col items-center gap-10 px-4 py-16">
      <SiteHeader />
      <Card className="w-full max-w-sm">
        {user?.isGuest ? <UpgradeForm nickname={user.nickname} /> : <RegisterForm />}

        {oauthEnabled ? (
          <div className="mt-4 flex flex-col gap-4">
            <Divider label={t('auth.orDivider')} />
            <GoogleButton />
          </div>
        ) : null}

        <p className="mt-4 text-center text-sm text-fg-muted">
          {t('auth.haveAccountAlready')}{' '}
          <Link href="/login" className="text-primary hover:underline">
            {t('nav.login')}
          </Link>
        </p>
      </Card>
    </main>
  )
}
