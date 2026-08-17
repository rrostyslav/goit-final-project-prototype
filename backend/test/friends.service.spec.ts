import type { PublicUser } from '@gp/shared'
import type { Friendship } from '../src/database/models/friendship.model'
import type { User } from '../src/database/models/user.model'
import { FriendsService } from '../src/friends/friends.service'
import type { NotificationsService } from '../src/notifications/notifications.service'
import { UsersService } from '../src/users/users.service'

interface FakeUserRow {
  id: string
  nickname: string
  avatarUrl: string | null
  isGuest: boolean
}

const ALICE: FakeUserRow = { id: 'alice-id', nickname: 'Alice', avatarUrl: null, isGuest: true }
const BOHDAN: FakeUserRow = { id: 'bohdan-id', nickname: 'Bohdan', avatarUrl: null, isGuest: true }

// Minimal in-memory stand-in for the Sequelize `User` model — only
// `findByPk` is exercised by FriendsService/UsersService in this spec.
function createFakeUserModel(seed: FakeUserRow[]) {
  return {
    async findByPk(id: string): Promise<FakeUserRow | null> {
      return seed.find((row) => row.id === id) ?? null
    },
  }
}

interface FakeFriendshipRow {
  id: string
  userId: string
  friendId: string
  status: 'pending' | 'accepted' | 'blocked'
  save: () => Promise<void>
  destroy: () => Promise<void>
}

type FakeFriendshipAttrs = Pick<FakeFriendshipRow, 'userId' | 'friendId' | 'status'>
type FakeFriendshipWhere = Partial<Pick<FakeFriendshipRow, 'id' | 'userId' | 'friendId' | 'status'>>

// A minimal in-memory stand-in for the Sequelize `Friendship` model, mirroring
// the style of the fake User model in auth.service.spec.ts: rows are plain
// mutable objects held by reference, so `.save()` can be a no-op.
function createFakeFriendshipModel() {
  const rows: FakeFriendshipRow[] = []
  let counter = 0

  return {
    rows,
    async create(attrs: FakeFriendshipAttrs): Promise<FakeFriendshipRow> {
      counter += 1
      const id = `friendship-${counter}`
      const row: FakeFriendshipRow = {
        id,
        userId: attrs.userId,
        friendId: attrs.friendId,
        status: attrs.status,
        save: async () => {},
        destroy: async () => {
          const index = rows.findIndex((r) => r.id === id)
          if (index !== -1) {
            rows.splice(index, 1)
          }
        },
      }
      rows.push(row)
      return row
    },
    async findOne({ where }: { where: FakeFriendshipWhere }): Promise<FakeFriendshipRow | null> {
      const entries = Object.entries(where) as Array<[keyof FakeFriendshipWhere, unknown]>
      return rows.find((row) => entries.every(([key, value]) => row[key] === value)) ?? null
    },
    async findAll({ where }: { where: FakeFriendshipWhere }): Promise<FakeFriendshipRow[]> {
      const entries = Object.entries(where) as Array<[keyof FakeFriendshipWhere, unknown]>
      return rows.filter((row) => entries.every(([key, value]) => row[key] === value))
    },
    async findByPk(id: string): Promise<FakeFriendshipRow | null> {
      return rows.find((row) => row.id === id) ?? null
    },
  }
}

interface PushedNotification {
  userId: string
  type: string
  payload: Record<string, string>
}

function createFakeNotificationsService() {
  const pushed: PushedNotification[] = []
  return {
    pushed,
    async push(userId: string, type: string, payload: Record<string, string>) {
      pushed.push({ userId, type, payload })
      return {
        id: `notif-${pushed.length}`,
        type,
        payload,
        createdAt: new Date().toISOString(),
        readAt: null,
      }
    },
  }
}

function createService() {
  const friendshipModel = createFakeFriendshipModel()
  const userModel = createFakeUserModel([ALICE, BOHDAN])
  const usersService = new UsersService(userModel as unknown as typeof User)
  const notificationsService = createFakeNotificationsService()
  const service = new FriendsService(
    friendshipModel as unknown as typeof Friendship,
    userModel as unknown as typeof User,
    usersService,
    notificationsService as unknown as NotificationsService,
  )
  return { service, friendshipModel, notificationsService }
}

describe('FriendsService', () => {
  it('creates a pending friendship on sendRequest', async () => {
    const { service, notificationsService } = createService()

    const request = await service.sendRequest(ALICE.id, BOHDAN.id)

    expect(request.status).toBe('pending')
    expect(request.userId).toBe(ALICE.id)
    expect(request.friendId).toBe(BOHDAN.id)
    expect(notificationsService.pushed).toEqual([
      {
        userId: BOHDAN.id,
        type: 'friend_request',
        payload: { fromId: ALICE.id, fromNickname: ALICE.nickname },
      },
    ])
  })

  it('refuses a duplicate request in either direction', async () => {
    const { service } = createService()
    await service.sendRequest(ALICE.id, BOHDAN.id)

    await expect(service.sendRequest(ALICE.id, BOHDAN.id)).rejects.toThrow()
    await expect(service.sendRequest(BOHDAN.id, ALICE.id)).rejects.toThrow()
  })

  it('refuses a self-request', async () => {
    const { service } = createService()

    await expect(service.sendRequest(ALICE.id, ALICE.id)).rejects.toThrow()
  })

  it('accept flips status to accepted and listFriends returns the pair symmetrically', async () => {
    const { service } = createService()
    const req = await service.sendRequest(ALICE.id, BOHDAN.id)

    await service.accept(BOHDAN.id, req.id)

    expect((await service.listFriends(ALICE.id)).map((u: PublicUser) => u.id)).toEqual([BOHDAN.id])
    expect((await service.listFriends(BOHDAN.id)).map((u: PublicUser) => u.id)).toEqual([ALICE.id])
  })

  it('remove deletes the friendship for both sides', async () => {
    const { service } = createService()
    const req = await service.sendRequest(ALICE.id, BOHDAN.id)
    await service.accept(BOHDAN.id, req.id)

    await service.remove(ALICE.id, BOHDAN.id)

    expect(await service.listFriends(ALICE.id)).toEqual([])
    expect(await service.listFriends(BOHDAN.id)).toEqual([])
  })
})
