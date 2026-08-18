import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import './globals.css'
import uk from '@/lib/i18n/uk.json'
import { Providers } from './providers'

// Metadata is rendered server-side, before the client-only I18nProvider
// mounts, so it can't call useI18n(). The default locale's own dictionary
// (uk.json) is the single source of truth for these strings instead of a
// second hardcoded copy -- still "every user-facing string goes through the
// dictionary", just read directly rather than via the hook.
export const metadata: Metadata = {
  title: uk['meta.title'],
  description: uk['meta.description'],
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="uk" className="h-full">
      <body className="min-h-full antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
