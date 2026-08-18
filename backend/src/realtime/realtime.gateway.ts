import { randomUUID } from 'node:crypto'
import type {
  Ack,
  ChatMessageDto,
  GameId,
  PlayerId,
  PublicUser,
  RoomDto,
  ServerToClientEvents,
} from '@gp/shared'
import { CHAT_MAX_LENGTH, GAME_CATALOG, SOCKET_NAMESPACE } from '@gp/shared'
import { BadRequestException, ForbiddenException, Logger, NotFoundException } from '@nestjs/common'
import {
  ConnectedSocket,
  MessageBody,
  type OnGatewayConnection,
  type OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets'
import { AuthService } from '../auth/auth.service'
import { RedisService } from '../redis/redis.service'
import {
  RoomBannedError,
  RoomClosedError,
  RoomFullError,
  RoomsService,
} from '../rooms/rooms.service'
import { PresenceService } from './presence.service'
import type { AppServer, AppSocket } from './socket-user'

const CHAT_RATE_LIMIT_MAX = 10
const CHAT_RATE_LIMIT_WINDOW_MS = 10_000

/** WebSocket gateway for the `/rt` namespace: room membership, presence
 * overlay, chat and game-selection voting. Task 16 (game runtime) and Task
 * 18 (voice tokens) add their own `@SubscribeMessage` handlers to this same
 * gateway and call `broadcastRoomState`/`emitToUser` from their own
 * services — both are `public` for exactly that reason. */
@WebSocketGateway({
  namespace: SOCKET_NAMESPACE,
  // A prototype-scoped simplification: the socket handshake carries its own
  // bearer token (see `authenticate` below), so — unlike the cookie-based
  // HTTP API in main.ts — Socket.IO CORS here does not need to be scoped to
  // a specific origin for auth safety. Reflects the request origin.
  cors: { origin: true, credentials: true },
})
export class RealtimeGateway implements OnGatewayInit<AppServer>, OnGatewayConnection<AppSocket> {
  @WebSocketServer() server!: AppServer

  private readonly logger = new Logger(RealtimeGateway.name)

  constructor(
    private readonly authService: AuthService,
    private readonly roomsService: RoomsService,
    private readonly presenceService: PresenceService,
    private readonly redisService: RedisService,
  ) {}

  afterInit(server: AppServer): void {
    // The Redis adapter itself is wired in `RedisIoAdapter.createIOServer`
    // (see main.ts / that file's comment) — it must be installed on the
    // root `Server`, before namespaces split off it, which is not the
    // object available here. This hook only adds the handshake-auth
    // middleware, which — unlike the adapter — *is* a real per-namespace
    // concern (`Namespace#use`).
    server.use((socket, next) => {
      this.authenticate(socket)
        .then(() => next())
        .catch((err: unknown) => next(err instanceof Error ? err : new Error('Unauthorized')))
    })
  }

  handleConnection(socket: AppSocket): void {
    // socket.io removes a socket from all of its rooms as part of the
    // 'disconnect' sequence *before* NestJS's own `handleDisconnect` hook
    // would fire — 'disconnecting' is the one event where `socket.rooms`
    // still reflects what the client was actually in.
    socket.on('disconnecting', () => {
      this.handleDisconnecting(socket).catch((err: unknown) => {
        this.logger.error(`disconnecting cleanup failed: ${errorMessage(err)}`)
      })
    })
  }

  // ---------------------------------------------------------------------
  // Public interface for Task 16 / Task 18
  // ---------------------------------------------------------------------

  /** Recomputes the room's DTO, overlays live socket presence onto each
   * member's `connection` field, and broadcasts it to everyone currently
   * joined to the room's Socket.IO room. Returns the broadcast DTO so
   * callers (including handlers in this file) can reuse it as an ack
   * payload without a second `toDto` round trip. */
  async broadcastRoomState(roomId: string): Promise<RoomDto> {
    const dto = await this.roomsService.toDto(roomId)
    const overlaid = this.overlayPresence(dto)
    this.server.to(roomId).emit('room:state', overlaid)
    return overlaid
  }

  /** Emits `event` to every socket belonging to `userId`, on this instance
   * or any other instance sharing the Redis adapter — used by Task 16/18
   * for game-state pushes and voice-related events, and available for any
   * future direct-to-user notification delivery. */
  async emitToUser<E extends keyof ServerToClientEvents>(
    userId: PlayerId,
    event: E,
    payload: Parameters<ServerToClientEvents[E]>[0],
  ): Promise<void> {
    // socket.io's typed `emit` spreads its event's tuple of arguments,
    // which TS cannot re-derive from the single generic `payload` value
    // above even though it is exactly one argument for every entry in
    // ServerToClientEvents — this local alias asserts the concrete
    // single-argument function shape once, which is narrower than a bare
    // `any` cast at every call site would be.
    type SingleArgEmit = (ev: E, payload: Parameters<ServerToClientEvents[E]>[0]) => boolean

    const sockets = await this.server.fetchSockets()
    for (const socket of sockets) {
      if (socket.data.user.id === userId) {
        const emit = socket.emit as unknown as SingleArgEmit
        emit(event, payload)
      }
    }
  }

  // ---------------------------------------------------------------------
  // room:* handlers
  // ---------------------------------------------------------------------

  @SubscribeMessage('room:join')
  async onRoomJoin(
    @ConnectedSocket() socket: AppSocket,
    @MessageBody() payload: { roomId: string },
  ): Promise<Ack<RoomDto>> {
    return this.handle(async () => {
      const roomId = assertNonEmptyString(payload.roomId, 'roomId')
      const userId = socket.data.user.id
      await this.redisService.withLock(lockKey(roomId), () =>
        this.roomsService.join(roomId, userId),
      )
      await socket.join(roomId)
      this.presenceService.markOnline(roomId, userId, socket.id)
      return this.broadcastRoomState(roomId)
    })
  }

  @SubscribeMessage('room:leave')
  async onRoomLeave(
    @ConnectedSocket() socket: AppSocket,
    @MessageBody() payload: { roomId: string },
  ): Promise<Ack<null>> {
    return this.handle(async () => {
      const roomId = assertNonEmptyString(payload.roomId, 'roomId')
      this.assertMember(socket, roomId)
      const userId = socket.data.user.id
      await this.redisService.withLock(lockKey(roomId), () =>
        this.roomsService.leave(roomId, userId),
      )
      await this.leaveAllSocketsForUser(roomId, userId)
      await this.handleMemberRemoved(roomId, userId)
      return null
    })
  }

  @SubscribeMessage('room:ready')
  async onRoomReady(
    @ConnectedSocket() socket: AppSocket,
    @MessageBody() payload: { roomId: string; isReady: boolean },
  ): Promise<Ack<null>> {
    return this.handle(async () => {
      const roomId = assertNonEmptyString(payload.roomId, 'roomId')
      this.assertMember(socket, roomId)
      await this.roomsService.setReady(roomId, socket.data.user.id, payload.isReady === true)
      await this.broadcastRoomState(roomId)
      return null
    })
  }

  @SubscribeMessage('room:chat')
  async onRoomChat(
    @ConnectedSocket() socket: AppSocket,
    @MessageBody() payload: { roomId: string; text: string },
  ): Promise<Ack<null>> {
    return this.handle(async () => {
      const roomId = assertNonEmptyString(payload.roomId, 'roomId')
      this.assertMember(socket, roomId)

      if (typeof payload.text !== 'string' || payload.text.trim().length === 0) {
        throw new BadRequestException('Message cannot be empty')
      }
      const text = payload.text.trim()
      if (text.length > CHAT_MAX_LENGTH) {
        throw new BadRequestException(`Message exceeds ${CHAT_MAX_LENGTH} characters`)
      }

      const allowed = await this.redisService.rateLimit(
        chatRateLimitKey(socket.data.user.id),
        CHAT_RATE_LIMIT_MAX,
        CHAT_RATE_LIMIT_WINDOW_MS,
      )
      if (!allowed) {
        throw new TooManyRequestsError('Too many messages — slow down')
      }

      const message: ChatMessageDto = {
        id: randomUUID(),
        roomId,
        author: socket.data.user,
        text,
        sentAt: new Date().toISOString(),
      }
      this.server.to(roomId).emit('chat:message', message)
      return null
    })
  }

  @SubscribeMessage('room:select_game')
  async onSelectGame(
    @ConnectedSocket() socket: AppSocket,
    @MessageBody() payload: { roomId: string; gameId: GameId },
  ): Promise<Ack<null>> {
    return this.handle(async () => {
      const roomId = assertNonEmptyString(payload.roomId, 'roomId')
      this.assertMember(socket, roomId)
      const hostId = socket.data.user.id
      await this.redisService.withLock(lockKey(roomId), () =>
        this.roomsService.selectGame(roomId, hostId, payload.gameId),
      )
      await this.broadcastRoomState(roomId)
      return null
    })
  }

  @SubscribeMessage('room:vote_game')
  async onVoteGame(
    @ConnectedSocket() socket: AppSocket,
    @MessageBody() payload: { roomId: string; gameId: GameId },
  ): Promise<Ack<null>> {
    return this.handle(async () => {
      const roomId = assertNonEmptyString(payload.roomId, 'roomId')
      this.assertMember(socket, roomId)
      if (!GAME_CATALOG.some((game) => game.id === payload.gameId)) {
        throw new BadRequestException(`Unknown game: ${payload.gameId}`)
      }

      await this.recordVote(roomId, socket.data.user.id, payload.gameId)
      const votes = await this.getVotes(roomId)
      this.server.to(roomId).emit('room:votes', votes)
      return null
    })
  }

  @SubscribeMessage('room:kick')
  async onKick(
    @ConnectedSocket() socket: AppSocket,
    @MessageBody() payload: { roomId: string; userId: PlayerId },
  ): Promise<Ack<null>> {
    return this.handle(async () => {
      const roomId = assertNonEmptyString(payload.roomId, 'roomId')
      const targetId = assertNonEmptyString(payload.userId, 'userId')
      this.assertMember(socket, roomId)
      const hostId = socket.data.user.id
      await this.redisService.withLock(lockKey(roomId), () =>
        this.roomsService.kick(roomId, hostId, targetId),
      )
      await this.expelSockets(roomId, targetId, 'kick')
      await this.handleMemberRemoved(roomId, targetId)
      return null
    })
  }

  @SubscribeMessage('room:ban')
  async onBan(
    @ConnectedSocket() socket: AppSocket,
    @MessageBody() payload: { roomId: string; userId: PlayerId },
  ): Promise<Ack<null>> {
    return this.handle(async () => {
      const roomId = assertNonEmptyString(payload.roomId, 'roomId')
      const targetId = assertNonEmptyString(payload.userId, 'userId')
      this.assertMember(socket, roomId)
      const hostId = socket.data.user.id
      await this.redisService.withLock(lockKey(roomId), () =>
        this.roomsService.ban(roomId, hostId, targetId),
      )
      await this.expelSockets(roomId, targetId, 'ban')
      await this.handleMemberRemoved(roomId, targetId)
      return null
    })
  }

  @SubscribeMessage('room:transfer_host')
  async onTransferHost(
    @ConnectedSocket() socket: AppSocket,
    @MessageBody() payload: { roomId: string; userId: PlayerId },
  ): Promise<Ack<null>> {
    return this.handle(async () => {
      const roomId = assertNonEmptyString(payload.roomId, 'roomId')
      const targetId = assertNonEmptyString(payload.userId, 'userId')
      this.assertMember(socket, roomId)
      const hostId = socket.data.user.id
      await this.redisService.withLock(lockKey(roomId), () =>
        this.roomsService.transferHost(roomId, hostId, targetId),
      )
      await this.broadcastRoomState(roomId)
      return null
    })
  }

  // ---------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------

  /** Verifies the handshake token before the connection is accepted —
   * `socket.handshake.auth.token` → `AuthService.verifyAccessToken` →
   * `socket.data.user`. Throwing here rejects the handshake itself (the
   * client sees `connect_error`, never `connect`), which is stronger than
   * accepting the connection and disconnecting it a moment later. */
  private async authenticate(socket: AppSocket): Promise<void> {
    const rawToken: unknown = socket.handshake.auth.token
    if (typeof rawToken !== 'string' || rawToken.length === 0) {
      throw new Error('Missing authentication token')
    }
    const user: PublicUser = await this.authService.verifyAccessToken(rawToken)
    socket.data.user = user
  }

  private async handleDisconnecting(socket: AppSocket): Promise<void> {
    const userId = socket.data.user.id
    const roomIds = [...socket.rooms].filter((room) => room !== socket.id)
    for (const roomId of roomIds) {
      await this.markDisconnectedIfLastSocket(roomId, userId, socket.id)
    }
  }

  /** `fetchSockets` still includes the departing socket at 'disconnecting'
   * time (it has not left its rooms yet), so it is explicitly excluded by
   * id here rather than relied on to already be gone. */
  private async markDisconnectedIfLastSocket(
    roomId: string,
    userId: string,
    departingSocketId: string,
  ): Promise<void> {
    const sockets = await this.server.in(roomId).fetchSockets()
    const stillPresent = sockets.some(
      (s) => s.id !== departingSocketId && s.data.user.id === userId,
    )
    if (!stillPresent) {
      this.presenceService.markDisconnected(roomId, userId)
      await this.broadcastRoomState(roomId)
    }
  }

  /** A socket may only act on a room it has actually joined — checked via
   * Socket.IO's own room membership rather than a hand-rolled mirror, so it
   * can never drift from what `socket.join`/`socket.leave` actually did. */
  private assertMember(socket: AppSocket, roomId: string): void {
    if (!socket.rooms.has(roomId)) {
      throw new ForbiddenException('You have not joined this room')
    }
  }

  /** Every one of this user's sockets that is currently in `roomId` leaves
   * the Socket.IO room — membership is per-user in RoomsService, not
   * per-device, so a self-leave from one tab must take every open tab out
   * of the room's broadcasts. Uses `fetchSockets` (not local bookkeeping)
   * so it also reaches that user's sockets connected to a different
   * gateway instance. */
  private async leaveAllSocketsForUser(roomId: string, userId: string): Promise<void> {
    const sockets = await this.server.in(roomId).fetchSockets()
    for (const socket of sockets) {
      if (socket.data.user.id === userId) {
        socket.leave(roomId)
      }
    }
  }

  /** Forcibly removes every socket belonging to `userId` from `roomId`,
   * after telling them why. Disconnects outright (rather than just leaving
   * the room) so "kicked" reads as final, and so presence cleanup for that
   * socket runs through the normal 'disconnecting' path on whichever
   * instance actually owns it. */
  private async expelSockets(
    roomId: string,
    userId: string,
    reason: 'kick' | 'ban',
  ): Promise<void> {
    const sockets = await this.server.in(roomId).fetchSockets()
    for (const socket of sockets) {
      if (socket.data.user.id === userId) {
        socket.emit('room:kicked', { reason })
        socket.disconnect(true)
      }
    }
  }

  /** Shared cleanup after a member is removed from a room by any path
   * (self-leave, kick, ban, or a presence-grace eviction): cancel any
   * lingering eviction timer, drop their vote, re-broadcast room state, and
   * clear all votes once the room is empty. Public because `RealtimeModule`
   * calls it directly from the presence eviction handler it wires up (see
   * that module's `onModuleInit` and the brief's "wire setEvictionHandler
   * in the module, not inside PresenceService itself"). */
  async handleMemberRemoved(roomId: string, userId: string): Promise<RoomDto> {
    this.presenceService.cancelEviction(roomId, userId)
    await this.removeVote(roomId, userId)
    const dto = await this.broadcastRoomState(roomId)
    if (dto.members.length === 0) {
      await this.clearVotes(roomId)
    }
    const votes = await this.getVotes(roomId)
    this.server.to(roomId).emit('room:votes', votes)
    return dto
  }

  private overlayPresence(dto: RoomDto): RoomDto {
    return {
      ...dto,
      members: dto.members.map((member) => ({
        ...member,
        connection: this.presenceService.getConnection(dto.id, member.user.id),
      })),
    }
  }

  // -- Game-selection votes: stored in Redis (not in-process memory) so a
  // -- vote is visible regardless of which gateway instance the voter or
  // -- the reader is connected to. Key: `votes:{roomId}` is a hash of
  // -- `userId -> gameId` (one vote per user; voting again replaces their
  // -- previous choice). Cleared on room-empty here; Task 16 should clear
  // -- the same key (`votesKey(roomId)`, i.e. `votes:${roomId}`) when
  // -- `game:start` fires, per the brief's "clear ... when a game starts".

  private votesKey(roomId: string): string {
    return `votes:${roomId}`
  }

  private async recordVote(roomId: string, userId: string, gameId: GameId): Promise<void> {
    await this.redisService.client.hset(this.votesKey(roomId), userId, gameId)
  }

  private async removeVote(roomId: string, userId: string): Promise<void> {
    await this.redisService.client.hdel(this.votesKey(roomId), userId)
  }

  private async clearVotes(roomId: string): Promise<void> {
    await this.redisService.client.del(this.votesKey(roomId))
  }

  private async getVotes(roomId: string): Promise<Record<string, PlayerId[]>> {
    const raw = await this.redisService.client.hgetall(this.votesKey(roomId))
    const votes: Record<string, PlayerId[]> = {}
    for (const [userId, gameId] of Object.entries(raw)) {
      const existing = votes[gameId]
      if (existing) {
        existing.push(userId)
      } else {
        votes[gameId] = [userId]
      }
    }
    return votes
  }

  private async handle<T>(fn: () => Promise<T>): Promise<Ack<T>> {
    try {
      const data = await fn()
      return { ok: true, data }
    } catch (err) {
      this.logger.warn(`realtime handler error: ${errorMessage(err)}`)
      return { ok: false, error: toErrorPayload(err) }
    }
  }
}

class TooManyRequestsError extends Error {}

function lockKey(roomId: string): string {
  return `room:${roomId}`
}

function chatRateLimitKey(userId: string): string {
  return `ratelimit:chat:${userId}`
}

function assertNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new BadRequestException(`${field} is required`)
  }
  return value
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function toErrorPayload(err: unknown): { code: string; message: string } {
  if (err instanceof RoomFullError) return { code: 'ROOM_FULL', message: err.message }
  if (err instanceof RoomClosedError) return { code: 'ROOM_CLOSED', message: err.message }
  if (err instanceof RoomBannedError) return { code: 'ROOM_BANNED', message: err.message }
  if (err instanceof TooManyRequestsError) return { code: 'RATE_LIMITED', message: err.message }
  if (err instanceof ForbiddenException) return { code: 'FORBIDDEN', message: err.message }
  if (err instanceof BadRequestException) return { code: 'BAD_REQUEST', message: err.message }
  if (err instanceof NotFoundException) return { code: 'NOT_FOUND', message: err.message }
  return { code: 'INTERNAL_ERROR', message: errorMessage(err) }
}
