import type { PublicUser, RoomBrowserEntry, RoomDto } from '@gp/shared'
import { ROOM_CREATE_RATE_LIMIT } from '@gp/shared'
import {
  type ArgumentsHost,
  Body,
  Catch,
  Controller,
  type ExceptionFilter,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  Query,
  UseFilters,
  UseGuards,
} from '@nestjs/common'
import type { Response } from 'express'
import { CurrentUser } from '../auth/decorators/current-user.decorator'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'
import { RedisService } from '../redis/redis.service'
import { BrowseRoomsDto } from './dto/browse-rooms.dto'
import { CreateRoomDto } from './dto/create-room.dto'
import { ReportRoomDto } from './dto/report-room.dto'
import { RoomBannedError, RoomClosedError, RoomFullError, RoomsService } from './rooms.service'

const RATE_LIMIT_KEY_PREFIX = 'ratelimit:room-create:'

/** Translates the three plain-Error entry-path failures RoomsService throws
 * (RoomFullError, RoomClosedError, RoomBannedError) into HTTP responses.
 * They are deliberately not NestJS HttpExceptions in the service itself —
 * Task 15's gateway catches the same errors and maps them to socket error
 * events instead of HTTP status codes. */
@Catch(RoomFullError, RoomClosedError, RoomBannedError)
class RoomEntryErrorFilter implements ExceptionFilter {
  catch(error: RoomFullError | RoomClosedError | RoomBannedError, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>()
    const status = error instanceof RoomBannedError ? HttpStatus.FORBIDDEN : HttpStatus.CONFLICT
    response.status(status).json({ statusCode: status, message: error.message, error: error.name })
  }
}

@Controller('rooms')
@UseFilters(RoomEntryErrorFilter)
export class RoomsController {
  constructor(
    private readonly roomsService: RoomsService,
    private readonly redisService: RedisService,
  ) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  async create(@CurrentUser() user: PublicUser, @Body() dto: CreateRoomDto): Promise<RoomDto> {
    const allowed = await this.redisService.rateLimit(
      `${RATE_LIMIT_KEY_PREFIX}${user.id}`,
      ROOM_CREATE_RATE_LIMIT.max,
      ROOM_CREATE_RATE_LIMIT.windowMs,
    )
    if (!allowed) {
      throw new HttpException(
        'Too many rooms created — try again later',
        HttpStatus.TOO_MANY_REQUESTS,
      )
    }

    return this.roomsService.create(user.id, dto)
  }

  /** Public room browser — no guard: listing public rooms does not require
   * an identity, and the response never includes member identities. */
  @Get()
  browse(@Query() query: BrowseRoomsDto): Promise<RoomBrowserEntry[]> {
    return this.roomsService.browse({
      gameId: query.gameId,
      hasFreeSlots: query.hasFreeSlots,
      limit: query.limit ?? 20,
      offset: query.offset ?? 0,
    })
  }

  @Get('by-code/:code')
  @UseGuards(JwtAuthGuard)
  async getByCode(@Param('code') code: string): Promise<RoomDto> {
    const room = await this.roomsService.findByCode(code.toUpperCase())
    // A closed room's code must 404 like an unknown one — it would otherwise
    // resolve to a stale RoomDto with an empty member list. Consistent with
    // join(), which already refuses closed rooms via RoomClosedError.
    if (!room || room.closedAt) {
      throw new NotFoundException('Room not found')
    }
    return this.roomsService.toDto(room.id)
  }

  @Post(':id/join')
  @UseGuards(JwtAuthGuard)
  join(@CurrentUser() user: PublicUser, @Param('id') id: string): Promise<RoomDto> {
    return this.roomsService.join(id, user.id)
  }

  @Post('by-invite/:token/join')
  @UseGuards(JwtAuthGuard)
  async joinByInvite(
    @CurrentUser() user: PublicUser,
    @Param('token') token: string,
  ): Promise<RoomDto> {
    const room = await this.roomsService.findByInviteToken(token)
    if (!room) {
      throw new NotFoundException('Room not found')
    }
    return this.roomsService.join(room.id, user.id)
  }

  @Post(':id/leave')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  leave(@CurrentUser() user: PublicUser, @Param('id') id: string): Promise<void> {
    return this.roomsService.leave(id, user.id)
  }

  // Final-review finding B: `POST /:id/{ready,select-game,transfer-host,
  // kick,ban}` used to live here, calling straight into `RoomsService` the
  // same way `join`/`leave` above do. Unlike `join`/`leave`, those five are
  // genuinely live-room MODERATION actions with a connected-socket side that
  // a bare Postgres write can never satisfy: `kick`/`ban` must also
  // disconnect the target's sockets and emit `room:kicked`, and every one of
  // the five must `broadcastRoomState` so every other member's view stays
  // current. `RealtimeGateway`'s `room:ready`/`room:select_game`/
  // `room:transfer_host`/`room:kick`/`room:ban` handlers already do exactly
  // that (see realtime.gateway.ts) — these REST routes were a second,
  // parallel path into the SAME `RoomsService` methods that skipped all of
  // it. Live-reproduced: a `POST /:id/ban` returned 201, but the banned
  // user's socket was never touched — no `room:kicked`, no disconnect — so
  // they stayed in the room's Socket.IO room and `room:chat` (which
  // authorizes on `socket.rooms.has(roomId)`, not database membership) kept
  // accepting their messages. The frontend never called any of these five
  // routes (confirmed against every `api.*` call site under `frontend/src`
  // — it only ever uses `POST /rooms`, `GET /rooms`, `GET /rooms/by-code/
  // :code`, and the WS `room:*` events for everything moderation-related),
  // so removed rather than fixed in place: the WS handlers are the one path
  // that actually enforces this correctly, and duplicating that enforcement
  // into a second REST entry point isn't worth the maintenance surface.
  // `RoomsService.setReady`/`selectGame`/`transferHost`/`kick`/`ban`
  // themselves are unchanged — `RealtimeGateway` is still their only caller.

  @Post(':id/report')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  report(
    @CurrentUser() user: PublicUser,
    @Param('id') id: string,
    @Body() dto: ReportRoomDto,
  ): Promise<void> {
    return this.roomsService.report(id, user.id, dto.targetId, dto.reason)
  }
}
