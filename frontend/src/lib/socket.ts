import type { ClientToServerEvents, ServerToClientEvents } from '@gp/shared'
import { SOCKET_NAMESPACE } from '@gp/shared'
import { io, type Socket } from 'socket.io-client'

// Mirrors api.ts's own NEXT_PUBLIC_API_URL fallback pattern -- both point at
// the same backend, just different protocols/paths (plain HTTP for REST,
// this one upgraded to a Socket.IO connection under the `/rt` namespace).
export const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? 'http://localhost:4000'

export type AppSocket = Socket<ServerToClientEvents, ClientToServerEvents>

/** Error surfaced from a rejected socket acknowledgement (`Ack<T>` with
 * `ok: false`) -- the socket-layer equivalent of api.ts's `ApiError`, so
 * call sites can branch the same way UI code already does for REST calls:
 * `err instanceof SocketAckError ? err.message : t('some.fallback')`. */
export class SocketAckError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'SocketAckError'
    this.code = code
  }
}

/** Opens a single Socket.IO connection to the realtime namespace. The
 * access token travels in the handshake payload (`auth`), never in a query
 * string, so it never lands in a server access log. `reconnection: true` is
 * Socket.IO's own default, spelled out explicitly here because the whole
 * "persistent voice room" premise depends on the data channel surviving a
 * network blip -- see room-store.ts's `connect` listener for how room
 * membership (which the server forgets on a fresh handshake) is restored
 * after a reconnect.
 *
 * This is a plain factory, not a singleton -- see room-store.ts for the
 * "one socket per session" lifecycle decision (a module-level singleton
 * inside the store, not one per component/page). */
export function createSocket(token: string): AppSocket {
  return io(`${WS_URL}${SOCKET_NAMESPACE}`, {
    auth: { token },
    reconnection: true,
  })
}
