import type { ClientToServerEvents, PublicUser, ServerToClientEvents } from '@gp/shared'
import type { Namespace, Socket } from 'socket.io'

/** Data attached to every socket in the `/rt` namespace. Populated by the
 * handshake-auth middleware registered in `RealtimeGateway.afterInit`
 * *before* the connection is accepted — every `@SubscribeMessage` handler
 * may therefore assume `socket.data.user` is already present. */
export interface SocketData {
  user: PublicUser
}

// This namespace has no server-to-server ("inter-server") events of its
// own; Socket.IO's typed-events generics still require a fourth type
// argument, so this stands in for "no events" instead of the `any`-typed
// default.
export type InterServerEvents = Record<string, never>

// Because `@WebSocketGateway` is configured with a `namespace`, the value
// NestJS actually injects into `@WebSocketServer()` / passes to
// `afterInit` is the `/rt` Namespace object returned by `Server#of()`, not
// the root `Server` — typing this as `Server` would compile (Namespace and
// Server share most members) but `Namespace#adapter` is a plain property,
// not the callable `Server#adapter(...)` setter, so wiring the Redis
// adapter from inside the gateway would fail at runtime. That wiring
// instead happens once, on the true root server, in `RedisIoAdapter`
// (`createIOServer`) — see that file for why.
export type AppServer = Namespace<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
>

export type AppSocket = Socket<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
>
