'use client'

import { useEffect, useState } from 'react'
import { api } from './api'

interface HealthResponse {
  status: 'ok'
  voice: boolean
  oauth: boolean
}

/** Whether to render "Continue with Google" on the auth pages. Starts as
 * `false` (button hidden) and only flips to `true` once `GET /health`
 * resolves and reports `oauth: true` -- see backend/src/health/health.controller.ts.
 * A slow or failed health check leaves the button hidden rather than risk
 * rendering one that 404s (the Google routes don't exist at all when
 * `config.oauthEnabled` is false, per task-7's auth.controller.ts). */
export function useOauthEnabled(): boolean {
  const [oauthEnabled, setOauthEnabled] = useState(false)

  useEffect(() => {
    let cancelled = false
    api
      .get<HealthResponse>('/health')
      .then((health) => {
        if (!cancelled) setOauthEnabled(health.oauth)
      })
      .catch(() => {
        // Health check failed -- keep the button hidden.
      })
    return () => {
      cancelled = true
    }
  }, [])

  return oauthEnabled
}
