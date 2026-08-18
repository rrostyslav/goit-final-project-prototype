'use client'

import type { GameId, RoomBrowserEntry, RoomStatus } from '@gp/shared'
import { GAME_CATALOG } from '@gp/shared'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { CreateRoomDialog } from '@/components/rooms/create-room-dialog'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Select } from '@/components/ui/select'
import { ApiError, api } from '@/lib/api'
import { useI18n } from '@/lib/i18n'
import { useAuthStore } from '@/lib/stores/auth-store'

const POLL_INTERVAL_MS = 5000
// After this many consecutive failures the interval is torn down instead of
// continuing to hammer a backend that is clearly down -- see task-20 brief's
// ambiguity note: polling "does not keep firing ... after a failed request
// storm". A manual retry (handleRetry) is the only way back in from there.
const MAX_CONSECUTIVE_FAILURES = 3
const BROWSE_LIMIT = 50

const STATUS_KEYS: Record<RoomStatus, string> = {
  lobby: 'room.statusLobby',
  in_game: 'room.statusInGame',
  results: 'room.statusResults',
}

function gameTitleKey(gameId: GameId): string {
  return GAME_CATALOG.find((game) => game.id === gameId)?.titleKey ?? gameId
}

/** hasFreeSlots is a real server-side filter (BrowseRoomsDto), not something
 * to reimplement client-side by trimming a fetched page -- doing that would
 * silently show a shorter, misleading list once free rooms fall outside the
 * fetched page. Passing it through as a query param keeps every filtered
 * room counted. */
function buildRoomsPath(gameId: GameId | '', freeSlotsOnly: boolean): string {
  const params = new URLSearchParams()
  if (gameId) params.set('gameId', gameId)
  if (freeSlotsOnly) params.set('hasFreeSlots', 'true')
  params.set('limit', String(BROWSE_LIMIT))
  return `/rooms?${params.toString()}`
}

export function RoomBrowser() {
  const { t } = useI18n()
  const user = useAuthStore((s) => s.user)
  const hasHydrated = useAuthStore((s) => s.hasHydrated)

  const [gameFilter, setGameFilter] = useState<GameId | ''>('')
  const [freeSlotsOnly, setFreeSlotsOnly] = useState(false)
  const [rooms, setRooms] = useState<RoomBrowserEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isDialogOpen, setIsDialogOpen] = useState(false)

  const failuresRef = useRef(0)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const cancelledRef = useRef(false)

  const stopPolling = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }
  }, [])

  const fetchRooms = useCallback(async () => {
    try {
      const data = await api.get<RoomBrowserEntry[]>(buildRoomsPath(gameFilter, freeSlotsOnly))
      if (cancelledRef.current) return
      failuresRef.current = 0
      setRooms(data)
      setError(null)
    } catch (err) {
      if (cancelledRef.current) return
      failuresRef.current += 1
      if (failuresRef.current >= MAX_CONSECUTIVE_FAILURES) {
        stopPolling()
        setError(err instanceof ApiError ? err.message : t('room.loadError'))
      }
    }
  }, [gameFilter, freeSlotsOnly, t, stopPolling])

  const startPolling = useCallback(() => {
    stopPolling()
    intervalRef.current = setInterval(() => void fetchRooms(), POLL_INTERVAL_MS)
  }, [fetchRooms, stopPolling])

  const handleRetry = useCallback(() => {
    failuresRef.current = 0
    setError(null)
    void fetchRooms()
    if (!document.hidden) startPolling()
  }, [fetchRooms, startPolling])

  // Polling lifecycle: fetch immediately, then every 5s. Cleared on unmount
  // and whenever the filters change (a fresh effect run replaces it). The
  // interval is also torn down while the tab is hidden and restarted (with
  // an immediate catch-up fetch) once it becomes visible again, so a
  // backgrounded tab never keeps firing requests nobody can see.
  useEffect(() => {
    cancelledRef.current = false
    failuresRef.current = 0
    void fetchRooms()
    if (!document.hidden) startPolling()

    function onVisibilityChange() {
      if (document.hidden) {
        stopPolling()
      } else {
        failuresRef.current = 0
        void fetchRooms()
        startPolling()
      }
    }
    document.addEventListener('visibilitychange', onVisibilityChange)

    return () => {
      cancelledRef.current = true
      stopPolling()
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [fetchRooms, startPolling, stopPolling])

  return (
    <div className="flex w-full max-w-3xl flex-col gap-6">
      <RemovalNotice />

      <div className="flex flex-wrap items-end justify-between gap-4">
        <h1 className="text-2xl font-bold text-fg">{t('room.browserTitle')}</h1>
        {!hasHydrated ? null : user ? (
          <Button onClick={() => setIsDialogOpen(true)}>{t('room.createRoom')}</Button>
        ) : (
          <Link href="/login" className="text-sm text-primary hover:underline">
            {t('room.loginToCreate')}
          </Link>
        )}
      </div>

      <div className="flex flex-wrap items-end gap-4">
        <Select
          label={t('room.filterGameLabel')}
          value={gameFilter}
          onChange={(event) => setGameFilter(event.target.value as GameId | '')}
          className="w-48"
        >
          <option value="">{t('room.filterGameAll')}</option>
          {GAME_CATALOG.map((game) => (
            <option key={game.id} value={game.id}>
              {t(game.titleKey)}
            </option>
          ))}
        </Select>

        <label className="flex h-10 items-center gap-2 text-sm text-fg">
          <input
            type="checkbox"
            className="h-4 w-4 accent-primary"
            checked={freeSlotsOnly}
            onChange={(event) => setFreeSlotsOnly(event.target.checked)}
          />
          {t('room.filterFreeSlotsOnly')}
        </label>
      </div>

      {error ? (
        <Card className="flex flex-col items-center gap-3 text-center">
          <p className="text-sm text-danger">{error}</p>
          <Button variant="secondary" size="sm" onClick={handleRetry}>
            {t('room.retry')}
          </Button>
        </Card>
      ) : rooms === null ? (
        <div
          aria-hidden="true"
          className="h-32 w-full animate-pulse rounded-2xl border border-border bg-surface"
        />
      ) : rooms.length === 0 ? (
        <Card className="text-center text-sm text-fg-muted">{t('room.emptyState')}</Card>
      ) : (
        <ul className="flex flex-col gap-3">
          {rooms.map((room) => (
            <li key={room.id}>
              <Link
                href={`/room/${room.code}`}
                className="flex items-center justify-between gap-4 rounded-2xl border border-border bg-surface p-4 transition-colors hover:bg-surface-hover"
              >
                <div className="flex flex-col gap-1">
                  <span className="font-semibold text-fg">{room.code}</span>
                  <span className="text-sm text-fg-muted">
                    {room.selectedGameId
                      ? t(gameTitleKey(room.selectedGameId))
                      : t('room.noGameSelected')}
                  </span>
                  <span className="text-sm text-fg-muted">
                    {t('room.hostLabel', { nickname: room.hostNickname })}
                  </span>
                </div>
                <div className="flex flex-col items-end gap-1 text-sm">
                  <span className="text-fg">
                    {t('room.playersCount', { count: room.playerCount, max: room.maxPlayers })}
                  </span>
                  <span className="text-fg-muted">{t(STATUS_KEYS[room.status])}</span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <CreateRoomDialog
        open={isDialogOpen}
        onClose={() => setIsDialogOpen(false)}
        initialGameId={gameFilter || null}
      />
    </div>
  )
}

/** Shown after the room page routes here following a `room:kicked` event
 * (see room/[code]/page.tsx's own comment) -- `?notice=kick|ban` carries the
 * translated explanation across that navigation, since the room page itself
 * is gone by the time the user reads it. `useSearchParams()` opts its caller
 * out of static rendering unless wrapped in `<Suspense>` (Next.js's own
 * requirement); isolating that to this small subtree keeps the rest of
 * `/rooms` prerendered exactly as it was before this component existed. */
function RemovalNotice() {
  return (
    <Suspense fallback={null}>
      <RemovalNoticeInner />
    </Suspense>
  )
}

function RemovalNoticeInner() {
  const { t } = useI18n()
  const router = useRouter()
  const searchParams = useSearchParams()
  const notice = searchParams.get('notice')

  if (notice !== 'kick' && notice !== 'ban') {
    return null
  }

  return (
    <Card className="flex items-center justify-between gap-4">
      <p className="text-sm text-danger">
        {notice === 'ban' ? t('room.kickedBanned') : t('room.kickedByHost')}
      </p>
      <button
        type="button"
        onClick={() => router.replace('/rooms')}
        aria-label={t('common.close')}
        className="rounded-md p-1 text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg"
      >
        <CloseIcon />
      </button>
    </Card>
  )
}

function CloseIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path
        d="M4 4L14 14M14 4L4 14"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  )
}
