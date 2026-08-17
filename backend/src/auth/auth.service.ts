import type { AuthTokens, PublicUser, UserId } from '@gp/shared'
import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { InjectModel } from '@nestjs/sequelize'
import bcrypt from 'bcryptjs'
import type { SignOptions } from 'jsonwebtoken'
import { UniqueConstraintError } from 'sequelize'
import { toPublicUser } from '../common/public-user.mapper'
import { AppConfigService } from '../config/env.config'
import { User } from '../database/models/user.model'

const BCRYPT_COST = 10

interface AccessTokenPayload {
  sub: string
  nickname: string
  isGuest: boolean
}

interface RefreshTokenPayload {
  sub: string
}

export interface OAuthProfileInput {
  provider: string
  providerId: string
  email: string | null
  nickname: string
  avatarUrl: string | null
}

interface CreatableUserAttrs {
  email?: string | null
  passwordHash?: string | null
  oauthProvider?: string | null
  oauthId?: string | null
  nickname: string
  avatarUrl?: string | null
  isGuest?: boolean
}

/** What every session-minting method returns: the public API shape plus the
 * raw refresh token, which never leaves AuthService except via the
 * controller, which moves it straight into an httpOnly cookie. */
export type AuthSession = AuthTokens & { refreshToken: string }

@Injectable()
export class AuthService {
  constructor(
    @InjectModel(User) private readonly userModel: typeof User,
    private readonly jwtService: JwtService,
    private readonly config: AppConfigService,
  ) {}

  async createGuest(nickname: string): Promise<AuthSession> {
    const user = await this.userModel.create({ nickname, isGuest: true })
    return this.mintSession(user)
  }

  async register(email: string, password: string, nickname: string): Promise<AuthSession> {
    const normalizedEmail = normalizeEmail(email)
    const existing = await this.userModel.findOne({ where: { email: normalizedEmail } })
    if (existing) {
      throw new ConflictException('Email already registered')
    }

    const passwordHash = await bcrypt.hash(password, BCRYPT_COST)
    const user = await this.createUniqueUser({
      email: normalizedEmail,
      passwordHash,
      nickname,
      isGuest: false,
    })
    return this.mintSession(user)
  }

  async login(email: string, password: string): Promise<AuthSession> {
    const user = await this.userModel.findOne({ where: { email: normalizeEmail(email) } })
    if (!user?.passwordHash) {
      throw new UnauthorizedException('Invalid credentials')
    }

    const passwordMatches = await bcrypt.compare(password, user.passwordHash)
    if (!passwordMatches) {
      throw new UnauthorizedException('Invalid credentials')
    }

    return this.mintSession(user)
  }

  async refresh(refreshToken: string): Promise<AuthSession> {
    const payload = await this.verifyToken<RefreshTokenPayload>(
      refreshToken,
      this.config.jwtRefreshSecret,
    )
    const user = await this.userModel.findByPk(payload.sub)
    if (!user) {
      throw new UnauthorizedException('User not found')
    }

    return this.mintSession(user)
  }

  async upgradeGuest(userId: UserId, email: string, password: string): Promise<AuthSession> {
    const normalizedEmail = normalizeEmail(email)
    const user = await this.userModel.findByPk(userId)
    if (!user?.isGuest) {
      throw new BadRequestException('User is not a guest')
    }

    const existing = await this.userModel.findOne({ where: { email: normalizedEmail } })
    if (existing) {
      throw new ConflictException('Email already registered')
    }

    user.email = normalizedEmail
    user.passwordHash = await bcrypt.hash(password, BCRYPT_COST)
    user.isGuest = false
    await this.saveUnique(user)

    return this.mintSession(user)
  }

  async findOrCreateOAuthUser(profile: OAuthProfileInput): Promise<AuthSession> {
    const normalizedEmail = profile.email ? normalizeEmail(profile.email) : null

    const byOAuthId = await this.userModel.findOne({
      where: { oauthProvider: profile.provider, oauthId: profile.providerId },
    })
    if (byOAuthId) {
      return this.mintSession(byOAuthId)
    }

    const byEmail = normalizedEmail
      ? await this.userModel.findOne({ where: { email: normalizedEmail } })
      : null
    if (byEmail) {
      byEmail.oauthProvider = profile.provider
      byEmail.oauthId = profile.providerId
      await this.saveUnique(byEmail)
      return this.mintSession(byEmail)
    }

    const user = await this.createUniqueUser({
      email: normalizedEmail,
      oauthProvider: profile.provider,
      oauthId: profile.providerId,
      nickname: profile.nickname,
      avatarUrl: profile.avatarUrl,
      isGuest: false,
    })
    return this.mintSession(user)
  }

  async verifyAccessToken(token: string): Promise<PublicUser> {
    const payload = await this.verifyToken<AccessTokenPayload>(token, this.config.jwtAccessSecret)
    const user = await this.userModel.findByPk(payload.sub)
    if (!user) {
      throw new UnauthorizedException('User not found')
    }

    return toPublicUser(user)
  }

  private async verifyToken<T extends object>(token: string, secret: string): Promise<T> {
    try {
      return await this.jwtService.verifyAsync<T>(token, { secret })
    } catch {
      throw new UnauthorizedException('Invalid or expired token')
    }
  }

  /** Wraps `.create()` so a unique-email race (two concurrent requests
   * passing the pre-check) surfaces as 409 instead of an unhandled 500. */
  private async createUniqueUser(attrs: CreatableUserAttrs): Promise<User> {
    try {
      return await this.userModel.create(attrs)
    } catch (err) {
      if (err instanceof UniqueConstraintError) {
        throw new ConflictException('Email already registered')
      }
      throw err
    }
  }

  private async saveUnique(user: User): Promise<void> {
    try {
      await user.save()
    } catch (err) {
      if (err instanceof UniqueConstraintError) {
        throw new ConflictException('Email already registered')
      }
      throw err
    }
  }

  private mintSession(user: User): AuthSession {
    const payload: AccessTokenPayload = {
      sub: user.id,
      nickname: user.nickname,
      isGuest: user.isGuest,
    }
    const accessToken = this.jwtService.sign(payload, {
      secret: this.config.jwtAccessSecret,
      expiresIn: asExpiresIn(this.config.jwtAccessTtl),
    })
    const refreshTokenPayload: RefreshTokenPayload = { sub: user.id }
    const refreshToken = this.jwtService.sign(refreshTokenPayload, {
      secret: this.config.jwtRefreshSecret,
      expiresIn: asExpiresIn(this.config.jwtRefreshTtl),
    })

    return { accessToken, refreshToken, user: toPublicUser(user) }
  }
}

/** Single normalization point for every email that gets stored or looked
 * up (register/login/upgradeGuest/findOrCreateOAuthUser all go through
 * this), so `A@x.com` and `a@x.com` are always treated as the same
 * account. NOTE: this does not migrate any pre-existing mixed-case rows in
 * the local dev database — only newly written/looked-up emails are
 * normalized. */
function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

/** AppConfigService only validates JWT_*_TTL as a non-empty string; the
 * `StringValue` template-literal type jsonwebtoken's SignOptions expects
 * (via the `ms` package, e.g. '15m' | '30d') can't be derived from a plain
 * `string` at compile time. jwt.sign() still parses the actual value via
 * `ms()` at runtime, so a malformed TTL surfaces as a runtime error rather
 * than being silently swallowed. */
function asExpiresIn(ttl: string): SignOptions['expiresIn'] {
  return ttl as SignOptions['expiresIn']
}
