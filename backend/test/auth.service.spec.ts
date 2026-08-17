import { JwtService } from '@nestjs/jwt'
import { AuthService } from '../src/auth/auth.service'
import type { AppConfigService } from '../src/config/env.config'
import type { User } from '../src/database/models/user.model'

interface FakeUserRow {
  id: string
  email: string | null
  passwordHash: string | null
  oauthProvider: string | null
  oauthId: string | null
  nickname: string
  avatarUrl: string | null
  isGuest: boolean
  save: () => Promise<void>
}

type FakeUserAttrs = Partial<Omit<FakeUserRow, 'save'>>

// A minimal in-memory stand-in for the Sequelize `User` model. It only
// implements the handful of static methods AuthService actually calls
// (create / findOne / findByPk). Rows are plain mutable objects held by
// reference in `rows`, so `.save()` can be a no-op: mutations made on the
// object the service holds are already reflected in the backing store.
function createFakeUserModel() {
  const rows: FakeUserRow[] = []
  let counter = 0

  return {
    rows,
    async create(attrs: FakeUserAttrs): Promise<FakeUserRow> {
      counter += 1
      const row: FakeUserRow = {
        id: attrs.id ?? `user-${counter}`,
        email: attrs.email ?? null,
        passwordHash: attrs.passwordHash ?? null,
        oauthProvider: attrs.oauthProvider ?? null,
        oauthId: attrs.oauthId ?? null,
        nickname: attrs.nickname ?? '',
        avatarUrl: attrs.avatarUrl ?? null,
        isGuest: attrs.isGuest ?? false,
        save: async () => {},
      }
      rows.push(row)
      return row
    },
    async findOne({ where }: { where: FakeUserAttrs }): Promise<FakeUserRow | null> {
      const entries = Object.entries(where) as Array<[keyof FakeUserAttrs, unknown]>
      return rows.find((row) => entries.every(([key, value]) => row[key] === value)) ?? null
    },
    async findByPk(id: string): Promise<FakeUserRow | null> {
      return rows.find((row) => row.id === id) ?? null
    },
  }
}

const testConfig = {
  jwtAccessSecret: 'test-access-secret',
  jwtRefreshSecret: 'test-refresh-secret',
  jwtAccessTtl: '15m',
  jwtRefreshTtl: '30d',
} as unknown as AppConfigService

function createService() {
  const userModel = createFakeUserModel()
  const service = new AuthService(
    userModel as unknown as typeof User,
    new JwtService({}),
    testConfig,
  )
  return { service, userModel }
}

describe('AuthService', () => {
  it('creates a guest user with isGuest true and no email', async () => {
    const { service, userModel } = createService()

    const session = await service.createGuest('Тест')

    expect(session.user.isGuest).toBe(true)
    expect(session.user.nickname).toBe('Тест')
    expect(session.accessToken).toEqual(expect.any(String))
    expect(session.refreshToken).toEqual(expect.any(String))
    const row = userModel.rows.find((r) => r.id === session.user.id)
    expect(row?.email).toBeNull()
  })

  it('a second guest with the same nickname also succeeds', async () => {
    const { service } = createService()

    const first = await service.createGuest('Гравець')
    const second = await service.createGuest('Гравець')

    expect(first.user.id).not.toBe(second.user.id)
    expect(second.user.isGuest).toBe(true)
  })

  it('rejects registration when the email already exists', async () => {
    const { service } = createService()
    await service.register('dup@example.com', 'hunter22', 'First')

    await expect(service.register('dup@example.com', 'hunter23', 'Second')).rejects.toThrow()
  })

  it('rejects login with a wrong password', async () => {
    const { service } = createService()
    await service.register('user@example.com', 'correct-password', 'Nick')

    await expect(service.login('user@example.com', 'wrong-password')).rejects.toThrow()
  })

  it('upgrades a guest in place, keeping the same user id', async () => {
    const { service } = createService()
    const guest = await service.createGuest('Оксана')

    const upgraded = await service.upgradeGuest(guest.user.id, 'o@example.com', 'hunter22')

    expect(upgraded.user.id).toBe(guest.user.id)
    expect(upgraded.user.isGuest).toBe(false)
  })

  it('refuses to upgrade a user that is not a guest', async () => {
    const { service } = createService()
    const session = await service.register('real@example.com', 'hunter22', 'Real')

    await expect(
      service.upgradeGuest(session.user.id, 'new@example.com', 'newpass1'),
    ).rejects.toThrow()
  })

  it('verifyAccessToken rejects a token signed with the refresh secret', async () => {
    const { service } = createService()
    const jwt = new JwtService({})
    const tokenSignedWithRefreshSecret = jwt.sign(
      { sub: 'user-1', nickname: 'X', isGuest: false },
      { secret: testConfig.jwtRefreshSecret, expiresIn: '15m' },
    )

    await expect(service.verifyAccessToken(tokenSignedWithRefreshSecret)).rejects.toThrow()
  })
})
