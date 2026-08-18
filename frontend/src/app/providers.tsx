'use client'

import type { ReactNode } from 'react'
import { useEffect } from 'react'
import { I18nProvider } from '@/lib/i18n'
import { useAuthStore } from '@/lib/stores/auth-store'

/** Triggers the auth store's client-only rehydration exactly once, on
 * mount. See `useAuthStore.hydrate()` for why this can't happen at module
 * load time (no `localStorage` on the server) or eagerly inside the store
 * itself (would run during SSR too). Renders nothing -- `hasHydrated` in
 * the store is what UI reads to avoid a logged-out flash while this is in
 * flight. */
function AuthHydrator() {
  useEffect(() => {
    useAuthStore.getState().hydrate()
  }, [])
  return null
}

export function Providers({ children }: { children: ReactNode }) {
  return (
    <I18nProvider>
      <AuthHydrator />
      {children}
    </I18nProvider>
  )
}
