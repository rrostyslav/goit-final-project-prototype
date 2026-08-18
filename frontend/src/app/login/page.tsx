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

function Divider({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 text-xs text-fg-muted">
      <span className="h-px flex-1 bg-border" />
      {label}
      <span className="h-px flex-1 bg-border" />
    </div>
  )
}

export default function LoginPage() {
  const { t } = useI18n()
  const router = useRouter()
  const user = useAuthStore((s) => s.user)
  const hasHydrated = useAuthStore((s) => s.hasHydrated)
  const login = useAuthStore((s) => s.login)
  const oauthEnabled = useOauthEnabled()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setIsSubmitting(true)
    try {
      await login(email.trim(), password)
      router.push('/')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('auth.loginError'))
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <main className="flex min-h-screen flex-col items-center gap-10 px-4 py-16">
      <SiteHeader />

      {hasHydrated && user && !user.isGuest ? (
        <Card className="flex w-full max-w-sm flex-col items-center gap-3 text-center">
          <p className="text-sm text-fg-muted">{t('auth.alreadyLoggedIn')}</p>
          <Link href="/">
            <Button>{t('nav.home')}</Button>
          </Link>
        </Card>
      ) : (
        <Card className="w-full max-w-sm">
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <h1 className="text-xl font-bold text-fg">{t('auth.loginTitle')}</h1>
            {user?.isGuest ? (
              <p className="text-sm text-fg-muted">{t('auth.guestLoginNote')}</p>
            ) : null}

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
              autoComplete="current-password"
              required
            />

            {error ? <p className="text-sm text-danger">{error}</p> : null}

            <Button type="submit" isLoading={isSubmitting}>
              {isSubmitting ? t('auth.loginSubmitting') : t('auth.loginButton')}
            </Button>

            {oauthEnabled ? (
              <>
                <Divider label={t('auth.orDivider')} />
                <GoogleButton />
              </>
            ) : null}

            <p className="text-center text-sm text-fg-muted">
              {t('auth.noAccountYet')}{' '}
              <Link href="/register" className="text-primary hover:underline">
                {t('nav.register')}
              </Link>
            </p>
          </form>
        </Card>
      )}
    </main>
  )
}
