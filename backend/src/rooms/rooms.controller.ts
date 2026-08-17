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
import { BanMemberDto } from './dto/ban-member.dto'
import { BrowseRoomsDto } from './dto/browse-rooms.dto'
import { CreateRoomDto } from './dto/create-room.dto'
import { ReportRoomDto } from './dto/report-room.dto'
import { SelectGameDto } from './dto/select-game.dto'
import { SetReadyDto } from './dto/set-ready.dto'
import { TargetMemberDto } from './dto/target-member.dto'
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

  @Post(':id/ready')
  @UseGuards(JwtAuthGuard)
  setReady(
    @CurrentUser() user: PublicUser,
    @Param('id') id: string,
    @Body() dto: SetReadyDto,
  ): Promise<RoomDto> {
    return this.roomsService.setReady(id, user.id, dto.isReady)
  }

  @Post(':id/select-game')
  @UseGuards(JwtAuthGuard)
  selectGame(
    @CurrentUser() user: PublicUser,
    @Param('id') id: string,
    @Body() dto: SelectGameDto,
  ): Promise<RoomDto> {
    return this.roomsService.selectGame(id, user.id, dto.gameId)
  }

  @Post(':id/transfer-host')
  @UseGuards(JwtAuthGuard)
  transferHost(
    @CurrentUser() user: PublicUser,
    @Param('id') id: string,
    @Body() dto: TargetMemberDto,
  ): Promise<RoomDto> {
    return this.roomsService.transferHost(id, user.id, dto.targetId)
  }

  @Post(':id/kick')
  @UseGuards(JwtAuthGuard)
  kick(
    @CurrentUser() user: PublicUser,
    @Param('id') id: string,
    @Body() dto: TargetMemberDto,
  ): Promise<RoomDto> {
    return this.roomsService.kick(id, user.id, dto.targetId)
  }

  @Post(':id/ban')
  @UseGuards(JwtAuthGuard)
  ban(
    @CurrentUser() user: PublicUser,
    @Param('id') id: string,
    @Body() dto: BanMemberDto,
  ): Promise<RoomDto> {
    return this.roomsService.ban(id, user.id, dto.targetId, dto.reason)
  }

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
