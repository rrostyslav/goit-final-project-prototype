import type { GameId, RoomBrowserEntry, RoomDto, RoomVisibility } from '@gp/shared'
import { GAME_CATALOG, ROOM_MAX_PLAYERS, ROOM_MIN_PLAYERS } from '@gp/shared'
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { InjectModel } from '@nestjs/sequelize'
import { UniqueConstraintError } from 'sequelize'
import { Room } from '../database/models/room.model'
import { RoomBan } from '../database/models/room-ban.model'
import { RoomMember } from '../database/models/room-member.model'
import { RoomReport } from '../database/models/room-report.model'
import { User } from '../database/models/user.model'
import { UsersService } from '../users/users.service'
import { RoomCodeService } from './room-code.service'
import { toRoomBrowserEntry, toRoomDto, toRoomMemberDto } from './room-mapper'

const MAX_CODE_GENERATION_ATTEMPTS = 10
const DEFAULT_BROWSE_LIMIT = 20

export class RoomFullError extends Error {
  constructor() {
    super('Room is full')
    this.name = 'RoomFullError'
  }
}

export class RoomBannedError extends Error {
  constructor() {
    super('You are banned from this room')
    this.name = 'RoomBannedError'
  }
}

export class RoomClosedError extends Error {
  constructor() {
    super('This room is closed')
    this.name = 'RoomClosedError'
  }
}

export interface CreateRoomInput {
  visibility: RoomVisibility
  maxPlayers: number
  gameId?: GameId
}

export interface BrowseRoomsParams {
  gameId?: GameId
  hasFreeSlots?: boolean
  limit: number
  offset: number
}

// Domain service for the room lifecycle: creation, join/leave, host powers
// and moderation. Task 15's WebSocket gateway calls the same instance
// methods (join, leave, setReady, selectGame, transferHost, kick, ban,
// assertHost, toDto) directly — nothing here may depend on the HTTP request
// context, and the three domain errors below (not NestJS HttpExceptions) let
// the gateway translate failures into socket error events instead of HTTP
// status codes.
@Injectable()
export class RoomsService {
  constructor(
    @InjectModel(Room) private readonly roomModel: typeof Room,
    @InjectModel(RoomMember) private readonly roomMemberModel: typeof RoomMember,
    @InjectModel(RoomBan) private readonly roomBanModel: typeof RoomBan,
    @InjectModel(RoomReport) private readonly roomReportModel: typeof RoomReport,
    @InjectModel(User) private readonly userModel: typeof User,
    private readonly usersService: UsersService,
    private readonly roomCodeService: RoomCodeService,
  ) {}

  async create(hostId: string, input: CreateRoomInput): Promise<RoomDto> {
    if (input.maxPlayers < ROOM_MIN_PLAYERS || input.maxPlayers > ROOM_MAX_PLAYERS) {
      throw new BadRequestException(
        `maxPlayers must be between ${ROOM_MIN_PLAYERS} and ${ROOM_MAX_PLAYERS}`,
      )
    }
    if (input.gameId && !GAME_CATALOG.some((game) => game.id === input.gameId)) {
      throw new BadRequestException(`Unknown game: ${input.gameId}`)
    }

    const room = await this.createRoomWithUniqueCode(hostId, input)
    await this.roomMemberModel.create({
      roomId: room.id,
      userId: hostId,
      isReady: false,
      joinedAt: new Date(),
    })
    return this.toDto(room.id)
  }

  async findByCode(code: string): Promise<Room | null> {
    return this.roomModel.findOne({ where: { code } })
  }

  /** Resolves the room behind a shareable invite link. Used by the
   * `POST /api/rooms/by-invite/:token/join` route — `join` itself still
   * runs every check (closed/banned/full) once the room id is known. */
  async findByInviteToken(inviteToken: string): Promise<Room | null> {
    return this.roomModel.findOne({ where: { inviteToken } })
  }

  async join(roomId: string, userId: string): Promise<RoomDto> {
    const room = await this.getRoomOrThrow(roomId)
    if (room.closedAt) {
      throw new RoomClosedError()
    }

    const banned = await this.roomBanModel.findOne({ where: { roomId, userId } })
    if (banned) {
      throw new RoomBannedError()
    }

    const existing = await this.roomMemberModel.findOne({ where: { roomId, userId } })
    if (existing && existing.leftAt === null) {
      return this.toDto(roomId)
    }

    const active = await this.activeMembers(roomId)
    if (active.length >= room.maxPlayers) {
      throw new RoomFullError()
    }

    if (existing) {
      // Reuse the row rather than inserting a second one — (roomId, userId)
      // is unique, so a member who left and returns must clear `leftAt`.
      existing.leftAt = null
      existing.isReady = false
      await existing.save()
    } else {
      try {
        await this.roomMemberModel.create({
          roomId,
          userId,
          isReady: false,
          joinedAt: new Date(),
        })
      } catch (err) {
        if (err instanceof UniqueConstraintError) {
          // Lost a race with a concurrent first-time join for the same
          // (roomId, userId): the `existing` check above ran before either
          // request had written its row, so both passed it and both reached
          // this create(). The other request's row already exists — re-
          // resolve to the same successful result a sequential join would
          // have produced instead of surfacing the constraint violation.
          return this.toDto(roomId)
        }
        throw err
      }
    }

    return this.toDto(roomId)
  }

  async leave(roomId: string, userId: string): Promise<void> {
    await this.removeActiveMember(roomId, userId)
  }

  async setReady(roomId: string, userId: string, isReady: boolean): Promise<RoomDto> {
    const member = await this.getActiveMemberOrThrow(roomId, userId)
    member.isReady = isReady
    await member.save()
    return this.toDto(roomId)
  }

  async selectGame(roomId: string, hostId: string, gameId: GameId): Promise<RoomDto> {
    await this.assertHost(roomId, hostId)
    if (!GAME_CATALOG.some((game) => game.id === gameId)) {
      throw new BadRequestException(`Unknown game: ${gameId}`)
    }

    const room = await this.getRoomOrThrow(roomId)
    room.selectedGameId = gameId
    await room.save()
    return this.toDto(roomId)
  }

  async transferHost(roomId: string, hostId: string, targetId: string): Promise<RoomDto> {
    await this.assertHost(roomId, hostId)
    const target = await this.getActiveMemberOrThrow(roomId, targetId)

    const room = await this.getRoomOrThrow(roomId)
    room.hostId = target.userId
    await room.save()
    return this.toDto(roomId)
  }

  async kick(roomId: string, hostId: string, targetId: string): Promise<RoomDto> {
    await this.assertHost(roomId, hostId)
    if (targetId === hostId) {
      throw new BadRequestException('Host cannot kick themself')
    }

    await this.removeActiveMember(roomId, targetId)
    return this.toDto(roomId)
  }

  async ban(roomId: string, hostId: string, targetId: string, reason?: string): Promise<RoomDto> {
    await this.assertHost(roomId, hostId)
    if (targetId === hostId) {
      throw new BadRequestException('Host cannot ban themself')
    }

    const existingBan = await this.roomBanModel.findOne({ where: { roomId, userId: targetId } })
    if (!existingBan) {
      await this.roomBanModel.create({
        roomId,
        userId: targetId,
        bannedBy: hostId,
        reason: reason ?? null,
      })
    }

    await this.removeActiveMember(roomId, targetId)
    return this.toDto(roomId)
  }

  /** A room member flags another member for later moderation review.
   * Persists a `RoomReport` row. Self-reports are rejected, but reporting
   * the same user twice in the same room is allowed on purpose — repeat
   * offences are a moderation signal, so there is no uniqueness constraint
   * on (room, reporter, reported user). */
  async report(
    roomId: string,
    reporterId: string,
    targetId: string,
    reason?: string,
  ): Promise<void> {
    await this.getRoomOrThrow(roomId)
    const reporter = await this.roomMemberModel.findOne({
      where: { roomId, userId: reporterId },
    })
    if (!reporter || reporter.leftAt !== null) {
      throw new ForbiddenException('Only current room members can file a report')
    }
    if (!targetId) {
      throw new BadRequestException('targetId is required')
    }
    if (targetId === reporterId) {
      throw new BadRequestException('You cannot report yourself')
    }

    await this.roomReportModel.create({
      roomId,
      reporterId,
      reportedUserId: targetId,
      reason: reason ?? null,
    })
  }

  async browse(params: BrowseRoomsParams): Promise<RoomBrowserEntry[]> {
    const limit = params.limit > 0 ? params.limit : DEFAULT_BROWSE_LIMIT
    const offset = params.offset >= 0 ? params.offset : 0

    const publicRooms = await this.roomModel.findAll({ where: { visibility: 'public' } })
    let candidates = publicRooms.filter((room) => room.closedAt === null)
    if (params.gameId) {
      candidates = candidates.filter((room) => room.selectedGameId === params.gameId)
    }

    const withCounts = await Promise.all(
      candidates.map(async (room) => {
        const active = await this.activeMembers(room.id)
        const host = await this.userModel.findByPk(room.hostId)
        return { room, playerCount: active.length, hostNickname: host?.nickname ?? 'Unknown' }
      }),
    )

    const filtered = params.hasFreeSlots
      ? withCounts.filter((entry) => entry.playerCount < entry.room.maxPlayers)
      : withCounts

    return filtered
      .sort((a, b) => b.room.createdAt.getTime() - a.room.createdAt.getTime())
      .slice(offset, offset + limit)
      .map((entry) => toRoomBrowserEntry(entry.room, entry.hostNickname, entry.playerCount))
  }

  async toDto(roomId: string): Promise<RoomDto> {
    const room = await this.getRoomOrThrow(roomId)
    const active = await this.activeMembers(roomId)
    const sorted = [...active].sort((a, b) => a.joinedAt.getTime() - b.joinedAt.getTime())

    const members = await Promise.all(
      sorted.map(async (member) => {
        const user = await this.userModel.findByPk(member.userId)
        if (!user) {
          throw new NotFoundException(`User ${member.userId} not found`)
        }
        return toRoomMemberDto(member, this.usersService.toPublicUser(user), room.hostId)
      }),
    )

    return toRoomDto(room, members)
  }

  /** Reused by Task 15's gateway to gate host-only socket events. */
  async assertHost(roomId: string, userId: string): Promise<void> {
    const room = await this.getRoomOrThrow(roomId)
    if (room.hostId !== userId) {
      throw new ForbiddenException('Only the host can perform this action')
    }
  }

  private async createRoomWithUniqueCode(hostId: string, input: CreateRoomInput): Promise<Room> {
    for (let attempt = 0; attempt < MAX_CODE_GENERATION_ATTEMPTS; attempt++) {
      const code = this.roomCodeService.generate()
      try {
        return await this.roomModel.create({
          code,
          visibility: input.visibility,
          hostId,
          maxPlayers: input.maxPlayers,
          selectedGameId: input.gameId ?? null,
        })
      } catch (err) {
        if (err instanceof UniqueConstraintError) {
          continue
        }
        throw err
      }
    }
    throw new ConflictException('Could not generate a unique room code, please try again')
  }

  /** Sets `leftAt` on the member's row (or no-ops if they are not currently
   * active), then reassigns the host to the earliest-joined remaining
   * member, or closes the room if that was the last active member. Backs
   * both `leave` (self-service) and `kick` (host-initiated). */
  private async removeActiveMember(roomId: string, userId: string): Promise<void> {
    const room = await this.getRoomOrThrow(roomId)
    const member = await this.roomMemberModel.findOne({ where: { roomId, userId } })
    if (!member || member.leftAt !== null) {
      return
    }

    member.leftAt = new Date()
    await member.save()

    const remaining = await this.activeMembers(roomId)
    if (remaining.length === 0) {
      room.closedAt = new Date()
      await room.save()
      return
    }

    if (room.hostId === userId) {
      const earliest = remaining.reduce((min, candidate) =>
        candidate.joinedAt < min.joinedAt ? candidate : min,
      )
      room.hostId = earliest.userId
      await room.save()
    }
  }

  private async getRoomOrThrow(roomId: string): Promise<Room> {
    const room = await this.roomModel.findByPk(roomId)
    if (!room) {
      throw new NotFoundException('Room not found')
    }
    return room
  }

  private async getActiveMemberOrThrow(roomId: string, userId: string): Promise<RoomMember> {
    const member = await this.roomMemberModel.findOne({ where: { roomId, userId } })
    if (!member || member.leftAt !== null) {
      throw new NotFoundException('Not an active member of this room')
    }
    return member
  }

  private async activeMembers(roomId: string): Promise<RoomMember[]> {
    const members = await this.roomMemberModel.findAll({ where: { roomId } })
    return members.filter((member) => member.leftAt === null)
  }
}
