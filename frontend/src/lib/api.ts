import type { PublicUser } from '@gp/shared'
import { useAuthStore } from './stores/auth-store'

// Exported so call sites that need a full URL rather than an api.ts request
// -- the Google OAuth button (a plain <a>, not a fetch, since sign-in is a
// full-page redirect handshake) -- share the same fallback instead of
// redeclaring it.
export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000'

export class ApiError extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }
}

/** Shape of NestJS's default (no custom filter) HTTP error body, e.g.
 * `{"statusCode":401,"message":"Invalid credentials","error":"Unauthorized"}`
 * or, from the ValidationPipe, `{"message":["nickname should not be empty"],
 * "error":"Bad Request","statusCode":400}`. There is no `code` field on the
 * wire for REST errors (unlike the socket `error` event, which does carry
 * one) -- `error` (the short reason phrase) is the closest equivalent and is
 * what ApiError.code is built from below. */
interface NestErrorBody {
  statusCode?: number
  message?: string | string[]
  error?: string
}

type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE'

// A 401 on these paths is never "your access token expired" -- /auth/refresh
// failing means the refresh cookie itself is gone/invalid (retrying would
// recurse), and a 401 from login/guest/register means "wrong credentials",
// not "stale token". Excluding them keeps the retry loop from ever firing
// for the wrong reason.
const REFRESH_EXEMPT_PATHS = new Set([
  '/auth/refresh',
  '/auth/login',
  '/auth/guest',
  '/auth/register',
])

interface RefreshResponse {
  accessToken: string
  user: PublicUser
}

// Dedupe concurrent refreshes. If several requests 401 at the same moment
// (realistic once a game session is under way and multiple REST/socket
// calls are in flight), they must all await the SAME in-flight refresh
// instead of each independently hammering POST /api/auth/refresh -- a
// "refresh storm". The module-level variable is reset once the refresh
// settles, so the NEXT 401 (later, once the new token also expires) starts
// a fresh attempt rather than reusing a stale resolved promise.
//
// Exported so the realtime socket layer (room-store.ts's `connect_error`
// handling -- see that file) can reuse this EXACT path -- same dedup, same
// cookie-scoped refresh call, same `setSession`/`clearSession` outcome --
// instead of growing a second, divergent refresh implementation for the
// socket handshake. Returns the same in-flight promise to a concurrent REST
// 401 and a concurrent socket reconnect alike.
let refreshInFlight: Promise<string | null> | null = null

export function refreshAccessToken(): Promise<string | null> {
  if (!refreshInFlight) {
    refreshInFlight = doRefresh().finally(() => {
      refreshInFlight = null
    })
  }
  return refreshInFlight
}

async function doRefresh(): Promise<string | null> {
  try {
    const res = await fetch(`${API_URL}/api/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
    })
    if (!res.ok) {
      useAuthStore.getState().clearSession()
      return null
    }
    const data = (await res.json()) as RefreshResponse
    useAuthStore.getState().setSession(data.user, data.accessToken)
    return data.accessToken
  } catch {
    return null
  }
}

async function parseErrorBody(res: Response): Promise<NestErrorBody> {
  try {
    return (await res.json()) as NestErrorBody
  } catch {
    return {}
  }
}

async function toApiError(res: Response): Promise<ApiError> {
  const body = await parseErrorBody(res)
  const message = Array.isArray(body.message)
    ? body.message.join(', ')
    : (body.message ?? res.statusText ?? 'Request failed')
  const code = body.error ?? String(res.status)
  return new ApiError(res.status, code, message)
}

async function request<T>(
  method: HttpMethod,
  path: string,
  body: unknown,
  isRetry: boolean,
): Promise<T> {
  const token = useAuthStore.getState().accessToken
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token) {
    headers.Authorization = `Bearer ${token}`
  }

  const res = await fetch(`${API_URL}/api${path}`, {
    method,
    headers,
    credentials: 'include',
    body: body === undefined ? undefined : JSON.stringify(body),
  })

  // Transparent refresh-and-replay: a short-lived (15 min) access token
  // expiring mid-session must not log the user out. Guarded against an
  // infinite loop by `isRetry` (at most one retry per call) and against a
  // refresh storm by `refreshInFlight` above.
  if (res.status === 401 && !isRetry && !REFRESH_EXEMPT_PATHS.has(path)) {
    const newToken = await refreshAccessToken()
    if (newToken) {
      return request<T>(method, path, body, true)
    }
  }

  if (!res.ok) {
    throw await toApiError(res)
  }

  if (res.status === 204) {
    return undefined as T
  }
  return (await res.json()) as T
}

export const api = {
  get: <T>(path: string): Promise<T> => request<T>('GET', path, undefined, false),
  post: <T>(path: string, body?: unknown): Promise<T> => request<T>('POST', path, body, false),
  patch: <T>(path: string, body?: unknown): Promise<T> => request<T>('PATCH', path, body, false),
  del: <T>(path: string): Promise<T> => request<T>('DELETE', path, undefined, false),
}
