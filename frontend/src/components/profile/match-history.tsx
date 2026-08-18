'use client'

import type { GameId, Locale, MatchHistoryEntry } from '@gp/shared'
import { GAME_CATALOG } from '@gp/shared'
import { useEffect, useState } from 'react'
import { Card } from '@/components/ui/card'
import { ApiError, api } from '@/lib/api'
import { useI18n } from '@/lib/i18n'

function gameTitleKey(gameId: GameId): string {
  return GAME_CATALOG.find((game) => game.id === gameId)?.titleKey ?? gameId
}

function formatEndedAt(iso: string, locale: Locale): string {
  return new Intl.DateTimeFormat(locale === 'uk' ? 'uk-UA' : 'en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(iso))
}

export interface MatchHistoryProps {
  /** No ownership check on the backend (GET /users/:id/history) -- any
   * authenticated user can read anyone's history, same as /users/search.
   * This component just renders whatever is passed; the profile page is
   * the one deciding whose id to pass, and only ever passes the viewer's
   * own for now. */
  userId: string
}

export function MatchHistory({ userId }: MatchHistoryProps) {
  const { t, locale } = useI18n()

  const [entries, setEntries] = useState<MatchHistoryEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setEntries(null)
    setError(null)
    api
      .get<MatchHistoryEntry[]>(`/users/${userId}/history`)
      .then((data) => {
        if (!cancelled) setEntries(data)
      })
      .catch((err) => {
        if (cancelled) return
        setError(err instanceof ApiError ? err.message : t('history.loadError'))
      })
    return () => {
      cancelled = true
    }
  }, [userId, t])

  return (
    <Card className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold text-fg">{t('history.title')}</h2>
      {error ? (
        <p className="text-sm text-danger">{error}</p>
      ) : entries === null ? (
        <div
          aria-hidden="true"
          className="h-24 w-full animate-pulse rounded-xl border border-border bg-surface"
        />
      ) : entries.length === 0 ? (
        <p className="text-sm text-fg-muted">{t('history.emptyState')}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {entries.map((entry) => (
            <li
              key={entry.sessionId}
              className="flex items-center justify-between gap-4 rounded-xl border border-border bg-surface p-3 text-sm"
            >
              <div className="flex flex-col gap-0.5">
                <span className="font-medium text-fg">{t(gameTitleKey(entry.gameId))}</span>
                <span className="text-fg-muted">
                  {t('history.roomCode', { code: entry.roomCode })} ·{' '}
                  {t('history.players', { count: entry.playerCount })}
                </span>
                <span className="text-fg-muted">{formatEndedAt(entry.endedAt, locale)}</span>
              </div>
              <div className="flex flex-col items-end gap-0.5">
                <span className="text-fg">
                  {t('history.placement', { placement: entry.placement })}
                </span>
                <span className="text-fg-muted">{t('history.score', { score: entry.score })}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}
