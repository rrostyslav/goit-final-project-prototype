import { API_URL } from '@/lib/api'
import { useI18n } from '@/lib/i18n'

/** A plain anchor, not a client-side action: Google sign-in is a full-page
 * redirect handshake (GoogleAuthGuard -> Google's consent screen ->
 * GET /api/auth/google/callback), not something api.ts's fetch wrapper can
 * drive. Only ever rendered by callers that already checked
 * `useOauthEnabled()` -- the route itself 404s when oauth is disabled. */
export function GoogleButton() {
  const { t } = useI18n()
  return (
    <a
      href={`${API_URL}/api/auth/google`}
      className="flex h-10 items-center justify-center gap-2 rounded-lg border border-border bg-surface text-sm font-medium text-fg transition-colors hover:bg-surface-hover"
    >
      {t('auth.continueWithGoogle')}
    </a>
  )
}
