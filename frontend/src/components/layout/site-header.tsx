'use client'

import type { Locale } from '@gp/shared'
import { SUPPORTED_LOCALES } from '@gp/shared'
import Link from 'next/link'
import { Avatar } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/cn'
import { useI18n } from '@/lib/i18n'
import { useAuthStore } from '@/lib/stores/auth-store'

const LOCALE_LABEL_KEYS: Record<Locale, string> = {
  uk: 'nav.localeUk',
  en: 'nav.localeEn',
}

/** Shared top bar for every page added in Task 20 (login, register, rooms,
 * profile) -- the landing page from Task 19 keeps its own inline locale
 * switch and is intentionally left untouched here. Auth-aware links
 * (Profile vs. Login/Register) are only rendered once `hasHydrated` is true,
 * so a logged-in user never sees a flash of the logged-out state. */
export function SiteHeader() {
  const { t, locale, setLocale } = useI18n()
  const user = useAuthStore((s) => s.user)
  const hasHydrated = useAuthStore((s) => s.hasHydrated)
  const logout = useAuthStore((s) => s.logout)

  return (
    <header className="flex w-full max-w-3xl flex-wrap items-center justify-between gap-3">
      <nav className="flex items-center gap-4 text-sm">
        <Link href="/" className="font-semibold text-fg hover:text-primary">
          {t('nav.home')}
        </Link>
        <Link href="/rooms" className="text-fg-muted hover:text-fg">
          {t('nav.rooms')}
        </Link>
        {hasHydrated && user ? (
          <Link href="/profile" className="text-fg-muted hover:text-fg">
            {t('nav.profile')}
          </Link>
        ) : null}
      </nav>

      <div className="flex items-center gap-3">
        {hasHydrated && user ? (
          <div className="flex items-center gap-2">
            <Avatar nickname={user.nickname} avatarUrl={user.avatarUrl} size="sm" />
            <Button variant="ghost" size="sm" onClick={() => void logout()}>
              {t('common.logout')}
            </Button>
          </div>
        ) : hasHydrated ? (
          <div className="flex items-center gap-3 text-sm">
            <Link href="/login" className="text-fg-muted hover:text-fg">
              {t('nav.login')}
            </Link>
            <Link href="/register" className="text-fg-muted hover:text-fg">
              {t('nav.register')}
            </Link>
          </div>
        ) : null}

        <div className="flex gap-1 rounded-lg border border-border bg-surface p-1">
          {SUPPORTED_LOCALES.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setLocale(option)}
              className={cn(
                'rounded-md px-3 py-1 text-sm transition-colors',
                option === locale ? 'bg-primary text-primary-fg' : 'text-fg-muted hover:text-fg',
              )}
            >
              {t(LOCALE_LABEL_KEYS[option])}
            </button>
          ))}
        </div>
      </div>
    </header>
  )
}
