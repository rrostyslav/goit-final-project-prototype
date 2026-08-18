'use client'

import type { PublicUser } from '@gp/shared'
import { type FormEvent, type ReactNode, useCallback, useEffect, useState } from 'react'
import { Avatar } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { ApiError, api } from '@/lib/api'
import { useI18n } from '@/lib/i18n'

/** Mirrors `FriendRequestView` from backend/src/friends/friends.service.ts.
 * That type is not re-exported through @gp/shared (the frontend never
 * imports from backend/, per the dependency-direction rule), so the wire
 * shape is duplicated here deliberately. */
interface FriendRequestView {
  id: string
  user: PublicUser
}

type PendingKeys = Record<string, boolean>

function SkeletonBlock() {
  return (
    <div
      aria-hidden="true"
      className="h-16 w-full animate-pulse rounded-xl border border-border bg-surface"
    />
  )
}

function UserRow({ user, action }: { user: PublicUser; action: ReactNode }) {
  return (
    <li className="flex items-center justify-between gap-3 rounded-xl border border-border bg-surface p-3">
      <div className="flex items-center gap-3">
        <Avatar nickname={user.nickname} avatarUrl={user.avatarUrl} size="sm" />
        <span className="text-sm text-fg">{user.nickname}</span>
      </div>
      {action}
    </li>
  )
}

export function FriendsList() {
  const { t } = useI18n()

  const [friends, setFriends] = useState<PublicUser[] | null>(null)
  const [incoming, setIncoming] = useState<FriendRequestView[] | null>(null)
  const [outgoing, setOutgoing] = useState<FriendRequestView[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [pending, setPending] = useState<PendingKeys>({})

  const [query, setQuery] = useState('')
  const [results, setResults] = useState<PublicUser[] | null>(null)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [isSearching, setIsSearching] = useState(false)

  const loadAll = useCallback(async () => {
    try {
      const [friendsData, incomingData, outgoingData] = await Promise.all([
        api.get<PublicUser[]>('/friends'),
        api.get<FriendRequestView[]>('/friends/incoming'),
        api.get<FriendRequestView[]>('/friends/outgoing'),
      ])
      setFriends(friendsData)
      setIncoming(incomingData)
      setOutgoing(outgoingData)
      setLoadError(null)
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : t('friends.loadError'))
    }
  }, [t])

  useEffect(() => {
    void loadAll()
  }, [loadAll])

  function setActionPending(key: string, value: boolean) {
    setPending((prev) => ({ ...prev, [key]: value }))
  }

  async function handleAccept(requestId: string) {
    setActionPending(requestId, true)
    try {
      await api.post(`/friends/requests/${requestId}/accept`)
      await loadAll()
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : t('friends.actionError'))
    } finally {
      setActionPending(requestId, false)
    }
  }

  async function handleDecline(requestId: string) {
    setActionPending(requestId, true)
    try {
      await api.post(`/friends/requests/${requestId}/decline`)
      await loadAll()
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : t('friends.actionError'))
    } finally {
      setActionPending(requestId, false)
    }
  }

  /** DELETE /friends/:friendId removes the relationship regardless of
   * status (accepted or still-pending), keyed by the *other user's* id --
   * see friends.service.ts's `remove()`. That makes it double as both
   * "remove an accepted friend" and "cancel a request I sent". */
  async function handleRemove(otherUserId: string) {
    setActionPending(otherUserId, true)
    try {
      await api.del(`/friends/${otherUserId}`)
      await loadAll()
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : t('friends.actionError'))
    } finally {
      setActionPending(otherUserId, false)
    }
  }

  async function handleSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const trimmed = query.trim()
    if (!trimmed) {
      setResults(null)
      setSearchError(null)
      return
    }
    setIsSearching(true)
    setSearchError(null)
    try {
      const data = await api.get<PublicUser[]>(`/users/search?q=${encodeURIComponent(trimmed)}`)
      setResults(data)
    } catch (err) {
      setSearchError(err instanceof ApiError ? err.message : t('friends.searchError'))
    } finally {
      setIsSearching(false)
    }
  }

  async function handleSendRequest(toId: string) {
    setActionPending(toId, true)
    try {
      await api.post('/friends/requests', { toId })
      await loadAll()
    } catch (err) {
      setSearchError(err instanceof ApiError ? err.message : t('friends.requestError'))
    } finally {
      setActionPending(toId, false)
    }
  }

  const friendIds = new Set((friends ?? []).map((f) => f.id))
  const outgoingIds = new Set((outgoing ?? []).map((r) => r.user.id))
  const incomingIds = new Set((incoming ?? []).map((r) => r.user.id))

  return (
    <div className="flex flex-col gap-6">
      {loadError ? <p className="text-sm text-danger">{loadError}</p> : null}

      <Card className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold text-fg">{t('friends.title')}</h2>
        {friends === null ? (
          <SkeletonBlock />
        ) : friends.length === 0 ? (
          <p className="text-sm text-fg-muted">{t('friends.emptyState')}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {friends.map((friend) => (
              <UserRow
                key={friend.id}
                user={friend}
                action={
                  <Button
                    variant="ghost"
                    size="sm"
                    isLoading={!!pending[friend.id]}
                    onClick={() => void handleRemove(friend.id)}
                  >
                    {t('friends.remove')}
                  </Button>
                }
              />
            ))}
          </ul>
        )}
      </Card>

      <Card className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold text-fg">{t('friends.incomingTitle')}</h2>
        {incoming === null ? (
          <SkeletonBlock />
        ) : incoming.length === 0 ? (
          <p className="text-sm text-fg-muted">{t('friends.incomingEmpty')}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {incoming.map((request) => (
              <UserRow
                key={request.id}
                user={request.user}
                action={
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      isLoading={!!pending[request.id]}
                      onClick={() => void handleAccept(request.id)}
                    >
                      {t('friends.accept')}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      isLoading={!!pending[request.id]}
                      onClick={() => void handleDecline(request.id)}
                    >
                      {t('friends.decline')}
                    </Button>
                  </div>
                }
              />
            ))}
          </ul>
        )}
      </Card>

      <Card className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold text-fg">{t('friends.outgoingTitle')}</h2>
        {outgoing === null ? (
          <SkeletonBlock />
        ) : outgoing.length === 0 ? (
          <p className="text-sm text-fg-muted">{t('friends.outgoingEmpty')}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {outgoing.map((request) => (
              <UserRow
                key={request.id}
                user={request.user}
                action={
                  <Button
                    variant="ghost"
                    size="sm"
                    isLoading={!!pending[request.user.id]}
                    onClick={() => void handleRemove(request.user.id)}
                  >
                    {t('friends.cancel')}
                  </Button>
                }
              />
            ))}
          </ul>
        )}
      </Card>

      <Card className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold text-fg">{t('friends.searchLabel')}</h2>
        <form onSubmit={handleSearch} className="flex items-end gap-3">
          <div className="flex-1">
            <Input
              placeholder={t('friends.searchPlaceholder')}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              maxLength={32}
            />
          </div>
          <Button type="submit" isLoading={isSearching}>
            {t('friends.searchButton')}
          </Button>
        </form>

        {searchError ? <p className="text-sm text-danger">{searchError}</p> : null}

        {results && results.length === 0 ? (
          <p className="text-sm text-fg-muted">{t('friends.searchEmpty')}</p>
        ) : results && results.length > 0 ? (
          <ul className="flex flex-col gap-2">
            {results.map((result) => (
              <UserRow
                key={result.id}
                user={result}
                action={
                  friendIds.has(result.id) ? (
                    <span className="text-sm text-fg-muted">{t('friends.alreadyFriends')}</span>
                  ) : outgoingIds.has(result.id) ? (
                    <span className="text-sm text-fg-muted">{t('friends.requestSent')}</span>
                  ) : incomingIds.has(result.id) ? (
                    <span className="text-sm text-fg-muted">{t('friends.respondBelow')}</span>
                  ) : (
                    <Button
                      size="sm"
                      isLoading={!!pending[result.id]}
                      onClick={() => void handleSendRequest(result.id)}
                    >
                      {t('friends.addButton')}
                    </Button>
                  )
                }
              />
            ))}
          </ul>
        ) : null}
      </Card>
    </div>
  )
}
