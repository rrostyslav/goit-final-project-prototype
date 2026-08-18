import type { INestApplicationContext } from '@nestjs/common'
import { IoAdapter } from '@nestjs/platform-socket.io'
import { createAdapter } from '@socket.io/redis-adapter'
import type { Server, ServerOptions } from 'socket.io'
import type { RedisService } from '../redis/redis.service'

/** Wires the Socket.IO Redis adapter onto the *root* server, not the `/rt`
 * namespace. `RealtimeGateway` is configured with `namespace: SOCKET_NAMESPACE`,
 * so the object Nest hands to a gateway's `afterInit`/`@WebSocketServer()`
 * is the namespace returned by `Server#of()` — and `Namespace#adapter` is
 * only a plain property there, not the callable `Server#adapter(ctor)`
 * setter that actually installs an adapter. `createIOServer` is the one
 * place NestJS constructs the true root `Server`, before any namespace is
 * split off it, so this is the only place that setter can safely be
 * called. Registered once via `app.useWebSocketAdapter(...)` in main.ts. */
export class RedisIoAdapter extends IoAdapter {
  constructor(
    app: INestApplicationContext,
    private readonly redisService: RedisService,
  ) {
    super(app)
  }

  override createIOServer(port: number, options?: ServerOptions): Server {
    const server: Server = super.createIOServer(port, options)
    server.adapter(createAdapter(this.redisService.client, this.redisService.subscriber))
    return server
  }
}
