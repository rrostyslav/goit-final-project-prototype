import type { PublicUser } from '@gp/shared'
import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { api } from '../api'

interface AuthResponse {
  accessToken: string
  user: PublicUser
}

interface PersistedAuthState {
  user: PublicUser | null
  accessToken: string | null
}

interface AuthState extends PersistedAuthState {
  /** True once the store has finished reading localStorage AND (if a token
   * was found) re-validated it against the backend. Callers must gate any
   * "you are logged out" UI on this flag -- see hydrate() below. */
  hasHydrated: boolean
  /** Review finding (Task 21 fix-up): set only when a realtime reconnect's
   * OWN token refresh comes back rejected (see room-store.ts's
   * `connect_error` handling) -- deliberately distinct from the plain
   * "signed out" state (`user === null` with `sessionExpired === false`,
   * e.g. a fresh visitor who never logged in) so `/room/[code]` can show a
   * translated "your session expired, sign in again" message instead of
   * the generic login prompt. Reset to `false` by every action below that
   * establishes a fresh session, so it can never leak into a later,
   * legitimately-logged-out-but-not-expired render. */
  sessionExpired: boolean
  loginAsGuest: (nickname: string) => Promise<void>
  login: (email: string, password: string) => Promise<void>
  register: (email: string, password: string, nickname: string) => Promise<void>
  /** Converts the currently signed-in guest into a full account, keeping
   * the same user id (and therefore friends/history) rather than starting
   * over -- see POST /auth/upgrade (backend/src/auth/auth.controller.ts).
   * Only meaningful while `user.isGuest` is true; the backend itself
   * rejects the call otherwise. */
  upgrade: (email: string, password: string) => Promise<void>
  logout: () => Promise<void>
  hydrate: () => Promise<void>
  /** Not part of the public store contract used by UI code -- these exist
   * so api.ts's refresh-on-401 flow (plain module code, outside React) can
   * update the session after a successful silent refresh. */
  setSession: (user: PublicUser, accessToken: string) => void
  clearSession: () => void
  /** Room-store.ts's `connect_error` handling calls this -- and only this,
   * never `clearSession` -- when the realtime socket's own token refresh
   * is itself rejected, so the UI can tell that case apart from an
   * ordinary logout/never-logged-in-yet state (see `sessionExpired`'s own
   * doc comment above). */
  markSessionExpired: () => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      accessToken: null,
      hasHydrated: false,
      sessionExpired: false,

      setSession: (user, accessToken) => set({ user, accessToken, sessionExpired: false }),
      clearSession: () => set({ user: null, accessToken: null }),
      markSessionExpired: () => set({ user: null, accessToken: null, sessionExpired: true }),

      loginAsGuest: async (nickname) => {
        const data = await api.post<AuthResponse>('/auth/guest', { nickname })
        set({ user: data.user, accessToken: data.accessToken, sessionExpired: false })
      },

      login: async (email, password) => {
        const data = await api.post<AuthResponse>('/auth/login', { email, password })
        set({ user: data.user, accessToken: data.accessToken, sessionExpired: false })
      },

      register: async (email, password, nickname) => {
        const data = await api.post<AuthResponse>('/auth/register', {
          email,
          password,
          nickname,
        })
        set({ user: data.user, accessToken: data.accessToken, sessionExpired: false })
      },

      upgrade: async (email, password) => {
        const data = await api.post<AuthResponse>('/auth/upgrade', { email, password })
        set({ user: data.user, accessToken: data.accessToken, sessionExpired: false })
      },

      logout: async () => {
        try {
          await api.post('/auth/logout')
        } finally {
          set({ user: null, accessToken: null, sessionExpired: false })
        }
      },

      // Rehydration is skipped at store-creation time (`skipHydration`
      // below) precisely so it can only ever run here, from a client
      // component effect -- never during a server render, where
      // `localStorage` does not exist. After pulling the persisted
      // {user, accessToken} back in, the restored access token is
      // re-validated against GET /auth/me rather than trusted blindly: it
      // may be expired (api.ts's own 401 -> refresh -> retry gives it one
      // chance to renew here too) or the account may no longer exist.
      hydrate: async () => {
        await useAuthStore.persist.rehydrate()
        const { accessToken } = get()
        if (accessToken) {
          try {
            const user = await api.get<PublicUser>('/auth/me')
            set({ user })
          } catch {
            set({ user: null, accessToken: null })
          }
        }
        set({ hasHydrated: true })
      },
    }),
    {
      name: 'gp-auth',
      storage: createJSONStorage(() => localStorage),
      // SECURITY NOTE (deliberate prototype tradeoff, see task-19 brief):
      // the access token is persisted to localStorage, which is readable by
      // any script that achieves XSS on this origin -- there is no
      // localStorage equivalent of an httpOnly cookie. This is bounded
      // damage, not an oversight: the access token is short-lived (15 min,
      // JWT_ACCESS_TTL) and the refresh token that mints new ones never
      // reaches JS at all -- it is an httpOnly cookie scoped to
      // /api/auth (see backend/src/auth/auth.controller.ts). A compromised
      // access token is therefore only useful for at most 15 minutes, not
      // indefinitely.
      partialize: (state): PersistedAuthState => ({
        user: state.user,
        accessToken: state.accessToken,
      }),
      skipHydration: true,
    },
  ),
)
