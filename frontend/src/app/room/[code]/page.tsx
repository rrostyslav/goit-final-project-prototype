'use client'

import type { GameId, RoomDto } from '@gp/shared'
import { getGameMeta, ROOM_CODE_LENGTH } from '@gp/shared'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { type ReactNode, useEffect, useState } from 'react'
import { SiteHeader } from '@/components/layout/site-header'
import { ChatPanel } from '@/components/room/chat-panel'
import { Lobby } from '@/components/room/lobby'
import { ResultsScreen } from '@/components/room/results-screen'
import { VoicePanel } from '@/components/room/voice-panel'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { ApiError, api } from '@/lib/api'
import { useI18n } from '@/lib/i18n'
import { sanitizeRoomCode } from '@/lib/room-code'
import { SocketAckError } from '@/lib/socket'
import { useAuthStore } from '@/lib/stores/auth-store'
import { useRoomStore } from '@/lib/stores/room-store'

/**
 * `/room/[code]` -- resolves the URL code to a room id, joins it over the
 * socket, and switches its MAIN AREA on `room.status`. `<VoicePanel/>` and
 * `<ChatPanel/>` are rendered once, outside that switch (see the JSX below:
 * they are siblings of the `<section>` holding the status-dependent
 * content, not children of it) -- so neither one ever unmounts as the room
 * moves through `lobby -> in_game -> results -> lobby`. That persistence is
 * "the core product promise" per the task-21 brief; see room-store.ts and
 * use-voice.ts for how the socket and the LiveKit connection underneath
 * these two panels are each kept alive across the very same transitions.
 */
export default function RoomPage() {
  const { t } = useI18n()
  const router = useRouter()
  const params = useParams<{ code: string }>()
  const code = sanitizeRoomCode(params.code ?? '')

  const user = useAuthStore((s) => s.user)
  const hasHydrated = useAuthStore((s) => s.hasHydrated)
  const sessionExpired = useAuthStore((s) => s.sessionExpired)

  const room = useRoomStore((s) => s.room)
  const standings = useRoomStore((s) => s.standings)
  const gameId = useRoomStore((s) => s.gameId)
  const kickedReason = useRoomStore((s) => s.kickedReason)
  const socketConnected = useRoomStore((s) => s.socketConnected)
  const join = useRoomStore((s) => s.join)
  const leave = useRoomStore((s) => s.leave)
  const clearKicked = useRoomStore((s) => s.clearKicked)

  const [resolveError, setResolveError] = useState<string | null>(null)
  const [isLeaving, setIsLeaving] = useState(false)

  // Resolves the code to a room id (a plain REST 404 reads better than a
  // socket ack error for "this code doesn't exist"), then joins over the
  // socket. `cancelled` guards against React Strict Mode's dev-only
  // double-invocation of this effect ever letting a stale, superseded run
  // reach `join()` -- see room-store.ts's own module comment for the second
  // layer of the same guarantee (a duplicate join for the SAME room id is a
  // no-op even if this guard were absent).
  useEffect(() => {
    if (!hasHydrated || !user || code.length !== ROOM_CODE_LENGTH) return
    let cancelled = false

    async function run() {
      setResolveError(null)
      try {
        const dto = await api.get<RoomDto>(`/rooms/by-code/${code}`)
        if (cancelled) return
        await join(dto.id)
      } catch (err) {
        if (cancelled) return
        // Review finding (Task 21 fix-up): a banned user navigating straight
        // back to the room URL resolves the code fine (REST 200) and only
        // fails at `join()`, over the socket -- `ApiError` never applies
        // here, so this fell through to the generic `room.notFound` even
        // though the server said exactly why (`SocketAckError`'s `code`,
        // `ROOM_BANNED` -- see `RoomBannedError`/`toErrorPayload` in
        // realtime.gateway.ts). Give that one case its own translated
        // message instead of the misleading "room not found".
        if (err instanceof ApiError) {
          setResolveError(err.message)
        } else if (err instanceof SocketAckError && err.code === 'ROOM_BANNED') {
          setResolveError(t('room.kickedBanned'))
        } else {
          setResolveError(t('room.notFound'))
        }
      }
    }
    void run()

    return () => {
      cancelled = true
    }
  }, [hasHydrated, user, code, join, t])

  // room:kicked -> route away with a translated explanation of which one it
  // was, per the brief's ambiguity note. The explanation itself is rendered
  // on /rooms (see room-browser.tsx's notice banner), not here -- this page
  // is about to unmount.
  useEffect(() => {
    if (!kickedReason) return
    clearKicked()
    router.push(`/rooms?notice=${kickedReason}`)
  }, [kickedReason, clearKicked, router])

  async function handleLeave() {
    setIsLeaving(true)
    try {
      await leave()
    } finally {
      setIsLeaving(false)
    }
    router.push('/rooms')
  }

  if (!hasHydrated) {
    return <LoadingShell />
  }

  // Review finding (Task 21 fix-up): checked before the plain `!user` case
  // below so a realtime reconnect whose own token refresh was rejected
  // (room-store.ts's `connect_error` handling -> `markSessionExpired`, which
  // also clears `user`) reads as "your session expired, sign in again"
  // rather than the generic "log in to join this room" -- same card shape,
  // different translated copy and no `<VoicePanel/>`/`<ChatPanel/>` involved
  // either way, since both branches return before that JSX.
  if (sessionExpired) {
    return (
      <PageShell>
        <Card className="flex w-full max-w-sm flex-col items-center gap-3 text-center">
          <p className="text-sm text-danger">{t('auth.sessionExpired')}</p>
          <Link href="/login">
            <Button>{t('nav.login')}</Button>
          </Link>
        </Card>
      </PageShell>
    )
  }

  if (!user) {
    return (
      <PageShell>
        <Card className="flex w-full max-w-sm flex-col items-center gap-3 text-center">
          <p className="text-sm text-fg-muted">{t('room.loginRequiredJoin')}</p>
          <Link href="/login">
            <Button>{t('nav.login')}</Button>
          </Link>
        </Card>
      </PageShell>
    )
  }

  if (code.length !== ROOM_CODE_LENGTH || resolveError) {
    return (
      <PageShell>
        <Card className="flex w-full max-w-sm flex-col items-center gap-3 text-center">
          <p className="text-sm text-danger">{resolveError ?? t('room.notFound')}</p>
          <Link href="/rooms">
            <Button variant="secondary">{t('nav.rooms')}</Button>
          </Link>
        </Card>
      </PageShell>
    )
  }

  if (!room) {
    return <LoadingShell />
  }

  let mainArea: ReactNode
  if (room.status === 'lobby') {
    mainArea = <Lobby />
  } else if (room.status === 'in_game') {
    mainArea = <InGamePlaceholder gameId={gameId} />
  } else {
    mainArea = <ResultsScreen room={room} standings={standings} />
  }

  return (
    <main className="flex min-h-screen flex-col items-center gap-6 px-4 py-10">
      <SiteHeader />

      <div className="flex w-full max-w-4xl flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-bold text-fg">{t('room.codeLabel', { code: room.code })}</h1>
          {!socketConnected ? (
            <span className="rounded-full bg-danger/20 px-2 py-0.5 text-xs text-danger">
              {t('room.socketDisconnected')}
            </span>
          ) : null}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          isLoading={isLeaving}
          onClick={() => void handleLeave()}
        >
          {t('room.leaveRoom')}
        </Button>
      </div>

      <div className="grid w-full max-w-4xl grid-cols-1 gap-6 lg:grid-cols-[2fr_1fr]">
        <section>{mainArea}</section>
        <aside className="flex flex-col gap-4">
          <VoicePanel roomId={room.id} />
          <ChatPanel />
        </aside>
      </div>
    </main>
  )
}

function PageShell({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-screen flex-col items-center gap-8 px-4 py-10">
      <SiteHeader />
      {children}
    </main>
  )
}

function LoadingShell() {
  return (
    <PageShell>
      <div
        aria-hidden="true"
        className="h-64 w-full max-w-4xl animate-pulse rounded-2xl border border-border bg-surface"
      />
    </PageShell>
  )
}

/** Task 22/23 replace this with the real per-game screens, driven by
 * `useRoomStore`'s `view`/`sendAction`. The room's `status` transitions
 * themselves (`lobby -> in_game -> results -> lobby`) are entirely
 * server-driven (see game-runtime.service.ts) -- this placeholder never
 * invents a client-side timer or otherwise tries to drive them. */
function InGamePlaceholder({ gameId }: { gameId: GameId | null }) {
  const { t } = useI18n()
  return (
    <Card className="flex flex-col items-center gap-2 text-center">
      <h2 className="text-xl font-bold text-fg">{t('room.inGameTitle')}</h2>
      <p className="text-sm text-fg-muted">{t('room.inGameBody')}</p>
      {gameId ? <p className="text-sm text-fg-muted">{t(getGameMeta(gameId).titleKey)}</p> : null}
    </Card>
  )
}
