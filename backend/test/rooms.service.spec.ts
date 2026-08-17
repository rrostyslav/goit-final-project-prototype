import { ROOM_MAX_PLAYERS, ROOM_MIN_PLAYERS } from '@gp/shared'
import { ForbiddenException } from '@nestjs/common'
import { UniqueConstraintError } from 'sequelize'
import type { Room } from '../src/database/models/room.model'
import type { RoomBan } from '../src/database/models/room-ban.model'
import type { RoomMember } from '../src/database/models/room-member.model'
import type { User } from '../src/database/models/user.model'
import type { RoomCodeService } from '../src/rooms/room-code.service'
import {
  RoomBannedError,
  RoomClosedError,
  RoomFullError,
  RoomsService,
} from '../src/rooms/rooms.service'
import { UsersService } from '../src/users/users.service'

// ---------------------------------------------------------------------------
// Fakes — minimal in-memory stand-ins for the Sequelize models, mirroring the
// style already used in friends.service.spec.ts / auth.service.spec.ts. Rows
// are plain mutable objects held by reference in `rows`, so `.save()` can be
// a no-op: mutations made on the object the service holds are already
// reflected in the backing store.
// ---------------------------------------------------------------------------

interface FakeUserRow {
  id: string
  nickname: string
  avatarUrl: string | null
  isGuest: boolean
}

function createFakeUserModel(seed: FakeUserRow[]) {
  return {
    async findByPk(id: string): Promise<FakeUserRow | null> {
      return seed.find((row) => row.id === id) ?? null
    },
  }
}

interface FakeRoomRow {
  id: string
  code: string
  visibility: 'private' | 'public'
  status: 'lobby' | 'in_game' | 'results'
  hostId: string
  maxPlayers: number
  selectedGameId: string | null
  inviteToken: string
  closedAt: Date | null
  createdAt: Date
  updatedAt: Date
  save: () => Promise<void>
}

type FakeRoomCreateAttrs = Partial<Omit<FakeRoomRow, 'save' | 'id' | 'createdAt' | 'updatedAt'>> & {
  code: string
  visibility: 'private' | 'public'
  hostId: string
  maxPlayers: number
}
type FakeRoomWhere = Partial<Pick<FakeRoomRow, 'id' | 'code' | 'inviteToken' | 'visibility'>>

function createFakeRoomModel() {
  const rows: FakeRoomRow[] = []
  let counter = 0

  return {
    rows,
    async create(attrs: FakeRoomCreateAttrs): Promise<FakeRoomRow> {
      if (rows.some((r) => r.code === attrs.code)) {
        throw new UniqueConstraintError({ message: 'Validation error' })
      }
      counter += 1
      const now = new Date()
      const row: FakeRoomRow = {
        id: `room-${counter}`,
        code: attrs.code,
        visibility: attrs.visibility,
        status: attrs.status ?? 'lobby',
        hostId: attrs.hostId,
        maxPlayers: attrs.maxPlayers,
        selectedGameId: attrs.selectedGameId ?? null,
        inviteToken: attrs.inviteToken ?? `invite-${counter}`,
        closedAt: attrs.closedAt ?? null,
        createdAt: now,
        updatedAt: now,
        save: async () => {},
      }
      rows.push(row)
      return row
    },
    async findByPk(id: string): Promise<FakeRoomRow | null> {
      return rows.find((row) => row.id === id) ?? null
    },
    async findOne({ where }: { where: FakeRoomWhere }): Promise<FakeRoomRow | null> {
      const entries = Object.entries(where) as Array<[keyof FakeRoomWhere, unknown]>
      return rows.find((row) => entries.every(([key, value]) => row[key] === value)) ?? null
    },
    async findAll({ where }: { where: FakeRoomWhere }): Promise<FakeRoomRow[]> {
      const entries = Object.entries(where) as Array<[keyof FakeRoomWhere, unknown]>
      return rows.filter((row) => entries.every(([key, value]) => row[key] === value))
    },
  }
}

interface FakeRoomMemberRow {
  id: string
  roomId: string
  userId: string
  isReady: boolean
  joinedAt: Date
  leftAt: Date | null
  save: () => Promise<void>
}

type FakeRoomMemberCreateAttrs = Partial<Omit<FakeRoomMemberRow, 'save' | 'id'>> & {
  roomId: string
  userId: string
}
type FakeRoomMemberWhere = Partial<Pick<FakeRoomMemberRow, 'roomId' | 'userId'>>

function createFakeRoomMemberModel() {
  const rows: FakeRoomMemberRow[] = []
  let counter = 0

  return {
    rows,
    async create(attrs: FakeRoomMemberCreateAttrs): Promise<FakeRoomMemberRow> {
      counter += 1
      const row: FakeRoomMemberRow = {
        id: `member-${counter}`,
        roomId: attrs.roomId,
        userId: attrs.userId,
        isReady: attrs.isReady ?? false,
        joinedAt: attrs.joinedAt ?? new Date(),
        leftAt: attrs.leftAt ?? null,
        save: async () => {},
      }
      rows.push(row)
      return row
    },
    async findOne({ where }: { where: FakeRoomMemberWhere }): Promise<FakeRoomMemberRow | null> {
      const entries = Object.entries(where) as Array<[keyof FakeRoomMemberWhere, unknown]>
      return rows.find((row) => entries.every(([key, value]) => row[key] === value)) ?? null
    },
    async findAll({ where }: { where: FakeRoomMemberWhere }): Promise<FakeRoomMemberRow[]> {
      const entries = Object.entries(where) as Array<[keyof FakeRoomMemberWhere, unknown]>
      return rows.filter((row) => entries.every(([key, value]) => row[key] === value))
    },
  }
}

interface FakeRoomBanRow {
  id: string
  roomId: string
  userId: string
  bannedBy: string | null
  reason: string | null
  createdAt: Date
}

type FakeRoomBanCreateAttrs = Partial<Omit<FakeRoomBanRow, 'id' | 'createdAt'>> & {
  roomId: string
  userId: string
}
type FakeRoomBanWhere = Partial<Pick<FakeRoomBanRow, 'roomId' | 'userId'>>

function createFakeRoomBanModel() {
  const rows: FakeRoomBanRow[] = []
  let counter = 0

  return {
    rows,
    async create(attrs: FakeRoomBanCreateAttrs): Promise<FakeRoomBanRow> {
      counter += 1
      const row: FakeRoomBanRow = {
        id: `ban-${counter}`,
        roomId: attrs.roomId,
        userId: attrs.userId,
        bannedBy: attrs.bannedBy ?? null,
        reason: attrs.reason ?? null,
        createdAt: new Date(),
      }
      rows.push(row)
      return row
    },
    async findOne({ where }: { where: FakeRoomBanWhere }): Promise<FakeRoomBanRow | null> {
      const entries = Object.entries(where) as Array<[keyof FakeRoomBanWhere, unknown]>
      return rows.find((row) => entries.every(([key, value]) => row[key] === value)) ?? null
    },
  }
}

const HOST: FakeUserRow = { id: 'host-id', nickname: 'Host', avatarUrl: null, isGuest: true }
const GUEST: FakeUserRow = { id: 'guest-id', nickname: 'Guest', avatarUrl: null, isGuest: true }
const THIRD: FakeUserRow = { id: 'third-id', nickname: 'Third', avatarUrl: null, isGuest: true }

// Deterministic RoomCodeService double: returns codes from a fixed queue
// (falling back to a counter-based code once the queue is exhausted) instead
// of the real random generator, so collision-retry tests are not flaky.
function createFakeRoomCodeService(queue: string[] = []) {
  let counter = 0
  const q = [...queue]
  return {
    generate: jest.fn(() => {
      const next = q.shift()
      if (next) return next
      counter += 1
      return `CODE${String(counter).padStart(2, '0')}`
    }),
    isValid: () => true,
  }
}

function createService(codeQueue: string[] = []) {
  const roomModel = createFakeRoomModel()
  const roomMemberModel = createFakeRoomMemberModel()
  const roomBanModel = createFakeRoomBanModel()
  const userModel = createFakeUserModel([HOST, GUEST, THIRD])
  const usersService = new UsersService(userModel as unknown as typeof User)
  const roomCodeService = createFakeRoomCodeService(codeQueue)

  const service = new RoomsService(
    roomModel as unknown as typeof Room,
    roomMemberModel as unknown as typeof RoomMember,
    roomBanModel as unknown as typeof RoomBan,
    userModel as unknown as typeof User,
    usersService,
    roomCodeService as unknown as RoomCodeService,
  )

  return { service, roomModel, roomMemberModel, roomBanModel, roomCodeService }
}

describe('RoomsService', () => {
  describe('create', () => {
    it('creates a public room with the host as its sole member', async () => {
      const { service } = createService()

      const dto = await service.create(HOST.id, { visibility: 'public', maxPlayers: 10 })

      expect(dto.hostId).toBe(HOST.id)
      expect(dto.visibility).toBe('public')
      expect(dto.code).toMatch(/^[A-Z0-9]{4,6}/)
      expect(dto.members).toHaveLength(1)
      expect(dto.members[0]?.user.id).toBe(HOST.id)
      expect(dto.members[0]?.isHost).toBe(true)
      expect(dto.members[0]?.connection).toBe('online')
    })

    it('rejects maxPlayers below ROOM_MIN_PLAYERS or above ROOM_MAX_PLAYERS', async () => {
      const { service } = createService()

      await expect(
        service.create(HOST.id, { visibility: 'public', maxPlayers: ROOM_MIN_PLAYERS - 1 }),
      ).rejects.toThrow()
      await expect(
        service.create(HOST.id, { visibility: 'public', maxPlayers: ROOM_MAX_PLAYERS + 1 }),
      ).rejects.toThrow()
    })

    it('retries code generation on a unique-constraint collision', async () => {
      const { service, roomModel, roomCodeService } = createService(['DUPE01', 'DUPE01', 'FRESH1'])
      await roomModel.create({
        code: 'DUPE01',
        visibility: 'public',
        hostId: HOST.id,
        maxPlayers: 10,
      })

      const dto = await service.create(GUEST.id, { visibility: 'public', maxPlayers: 10 })

      expect(dto.code).toBe('FRESH1')
      expect(roomCodeService.generate).toHaveBeenCalledTimes(3)
    })

    it('throws after 10 consecutive unique-constraint collisions', async () => {
      const { service, roomModel, roomCodeService } = createService()
      await roomModel.create({
        code: 'CODE01',
        visibility: 'public',
        hostId: HOST.id,
        maxPlayers: 10,
      })
      // Every generated code collides with the pre-seeded row above.
      roomCodeService.generate.mockImplementation(() => 'CODE01')

      await expect(
        service.create(GUEST.id, { visibility: 'public', maxPlayers: 10 }),
      ).rejects.toThrow()
      expect(roomCodeService.generate).toHaveBeenCalledTimes(10)
    })
  })

  describe('findByCode / findByInviteToken', () => {
    it('resolves an existing room and returns null for an unknown code or token', async () => {
      const { service } = createService()
      const created = await service.create(HOST.id, { visibility: 'public', maxPlayers: 10 })

      expect((await service.findByCode(created.code))?.id).toBe(created.id)
      expect(await service.findByCode('ZZZZZZ')).toBeNull()

      const room = await service.findByCode(created.code)
      expect((await service.findByInviteToken(room?.inviteToken ?? ''))?.id).toBe(created.id)
      expect(await service.findByInviteToken('not-a-real-token')).toBeNull()
    })
  })

  describe('join', () => {
    it('refuses to join a room that already has maxPlayers members', async () => {
      const { service } = createService()
      const created = await service.create(HOST.id, { visibility: 'public', maxPlayers: 2 })
      await service.join(created.id, GUEST.id)

      await expect(service.join(created.id, THIRD.id)).rejects.toThrow(RoomFullError)
    })

    it('refuses to join when the user is banned from the room', async () => {
      const { service } = createService()
      const created = await service.create(HOST.id, { visibility: 'public', maxPlayers: 10 })
      await service.join(created.id, GUEST.id)
      await service.ban(created.id, HOST.id, GUEST.id)

      await expect(service.join(created.id, GUEST.id)).rejects.toThrow(RoomBannedError)
    })

    it('refuses to join a closed room', async () => {
      const { service } = createService()
      const created = await service.create(HOST.id, { visibility: 'public', maxPlayers: 10 })
      await service.leave(created.id, HOST.id) // last member leaves -> room closes

      await expect(service.join(created.id, GUEST.id)).rejects.toThrow(RoomClosedError)
    })

    it('a user banned by userId is also refused when entering via room code or invite token', async () => {
      const { service } = createService()
      const created = await service.create(HOST.id, { visibility: 'public', maxPlayers: 10 })
      await service.join(created.id, GUEST.id)
      await service.ban(created.id, HOST.id, GUEST.id)

      const byCode = await service.findByCode(created.code)
      const byInvite = await service.findByInviteToken(byCode?.inviteToken ?? '')
      expect(byCode).not.toBeNull()
      expect(byInvite).not.toBeNull()

      await expect(service.join(byCode?.id ?? '', GUEST.id)).rejects.toThrow(RoomBannedError)
      await expect(service.join(byInvite?.id ?? '', GUEST.id)).rejects.toThrow(RoomBannedError)
    })

    it('rejoining a room the user previously left reuses the same member row', async () => {
      const { service, roomMemberModel } = createService()
      const created = await service.create(HOST.id, { visibility: 'public', maxPlayers: 10 })
      await service.join(created.id, GUEST.id)
      await service.leave(created.id, GUEST.id)

      await service.join(created.id, GUEST.id)

      const rowsForGuest = roomMemberModel.rows.filter(
        (r) => r.roomId === created.id && r.userId === GUEST.id,
      )
      expect(rowsForGuest).toHaveLength(1)
      expect(rowsForGuest[0]?.leftAt).toBeNull()
    })
  })

  describe('leave', () => {
    it('reassigns the host to the earliest remaining member when the host leaves', async () => {
      const { service } = createService()
      const created = await service.create(HOST.id, { visibility: 'public', maxPlayers: 10 })
      await service.join(created.id, GUEST.id)
      await service.join(created.id, THIRD.id)

      await service.leave(created.id, HOST.id)

      const dto = await service.toDto(created.id)
      expect(dto.hostId).toBe(GUEST.id)
    })

    it('closes the room when the last member leaves', async () => {
      const { service, roomModel } = createService()
      const created = await service.create(HOST.id, { visibility: 'public', maxPlayers: 10 })

      await service.leave(created.id, HOST.id)

      const row = await roomModel.findByPk(created.id)
      expect(row?.closedAt).not.toBeNull()
    })

    it('a closed room is excluded from browse', async () => {
      const { service } = createService()
      const created = await service.create(HOST.id, { visibility: 'public', maxPlayers: 10 })
      await service.leave(created.id, HOST.id)

      const entries = await service.browse({ limit: 20, offset: 0 })

      expect(entries.find((e) => e.id === created.id)).toBeUndefined()
    })
  })

  describe('browse', () => {
    it('returns only public rooms and hides member identities', async () => {
      const { service } = createService()
      const publicRoom = await service.create(HOST.id, { visibility: 'public', maxPlayers: 10 })
      await service.create(GUEST.id, { visibility: 'private', maxPlayers: 10 })

      const entries = await service.browse({ limit: 20, offset: 0 })

      expect(entries).toHaveLength(1)
      const entry = entries[0]
      expect(entry?.id).toBe(publicRoom.id)
      expect(entry?.hostNickname).toBe(HOST.nickname)
      expect(entry?.playerCount).toBe(1)
      expect(entry).not.toHaveProperty('members')
      expect(entry).not.toHaveProperty('hostId')
    })

    it('excludes full rooms when hasFreeSlots is set', async () => {
      const { service } = createService()
      const full = await service.create(HOST.id, { visibility: 'public', maxPlayers: 2 })
      await service.join(full.id, GUEST.id)
      const open = await service.create(THIRD.id, { visibility: 'public', maxPlayers: 10 })

      const entries = await service.browse({ hasFreeSlots: true, limit: 20, offset: 0 })

      const ids = entries.map((e) => e.id)
      expect(ids).toContain(open.id)
      expect(ids).not.toContain(full.id)
    })
  })

  describe('host powers and moderation', () => {
    it('assertHost throws ForbiddenException for a non-host caller', async () => {
      const { service } = createService()
      const created = await service.create(HOST.id, { visibility: 'public', maxPlayers: 10 })

      await expect(service.assertHost(created.id, GUEST.id)).rejects.toThrow(ForbiddenException)
      await expect(service.assertHost(created.id, HOST.id)).resolves.toBeUndefined()
    })

    it('setReady updates isReady for the calling member', async () => {
      const { service } = createService()
      const created = await service.create(HOST.id, { visibility: 'public', maxPlayers: 10 })

      const dto = await service.setReady(created.id, HOST.id, true)

      expect(dto.members[0]?.isReady).toBe(true)
    })

    it('selectGame requires the host and sets selectedGameId', async () => {
      const { service } = createService()
      const created = await service.create(HOST.id, { visibility: 'public', maxPlayers: 10 })
      await service.join(created.id, GUEST.id)

      await expect(service.selectGame(created.id, GUEST.id, 'alias')).rejects.toThrow(
        ForbiddenException,
      )
      const dto = await service.selectGame(created.id, HOST.id, 'alias')
      expect(dto.selectedGameId).toBe('alias')
    })

    it('transferHost moves host status to the target member', async () => {
      const { service } = createService()
      const created = await service.create(HOST.id, { visibility: 'public', maxPlayers: 10 })
      await service.join(created.id, GUEST.id)

      const dto = await service.transferHost(created.id, HOST.id, GUEST.id)

      expect(dto.hostId).toBe(GUEST.id)
      expect(dto.members.find((m) => m.user.id === GUEST.id)?.isHost).toBe(true)
      expect(dto.members.find((m) => m.user.id === HOST.id)?.isHost).toBe(false)
    })

    it('kick removes the target but does not ban them — they can rejoin', async () => {
      const { service } = createService()
      const created = await service.create(HOST.id, { visibility: 'public', maxPlayers: 10 })
      await service.join(created.id, GUEST.id)

      await service.kick(created.id, HOST.id, GUEST.id)
      const afterKick = await service.toDto(created.id)
      expect(afterKick.members.find((m) => m.user.id === GUEST.id)).toBeUndefined()

      await expect(service.join(created.id, GUEST.id)).resolves.toBeDefined()
    })

    it('ban removes the target and refuses their rejoin', async () => {
      const { service } = createService()
      const created = await service.create(HOST.id, { visibility: 'public', maxPlayers: 10 })
      await service.join(created.id, GUEST.id)

      await service.ban(created.id, HOST.id, GUEST.id)

      await expect(service.join(created.id, GUEST.id)).rejects.toThrow(RoomBannedError)
    })

    it('a non-host cannot kick or ban', async () => {
      const { service } = createService()
      const created = await service.create(HOST.id, { visibility: 'public', maxPlayers: 10 })
      await service.join(created.id, GUEST.id)
      await service.join(created.id, THIRD.id)

      await expect(service.kick(created.id, GUEST.id, THIRD.id)).rejects.toThrow(ForbiddenException)
      await expect(service.ban(created.id, GUEST.id, THIRD.id)).rejects.toThrow(ForbiddenException)
    })
  })
})
