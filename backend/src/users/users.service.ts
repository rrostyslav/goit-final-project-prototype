import type { PublicUser } from '@gp/shared'
import { Injectable, NotFoundException } from '@nestjs/common'
import { InjectModel } from '@nestjs/sequelize'
import { Op } from 'sequelize'
import { toPublicUser as mapPublicUser } from '../common/public-user.mapper'
import { User } from '../database/models/user.model'

export interface UpdateProfileInput {
  nickname?: string
  avatarUrl?: string
}

const DEFAULT_SEARCH_LIMIT = 20
const MAX_SEARCH_LIMIT = 50

@Injectable()
export class UsersService {
  constructor(@InjectModel(User) private readonly userModel: typeof User) {}

  /** The single conversion point from the Sequelize `User` row to the
   * public wire shape — must never leak `passwordHash`, `email`,
   * `oauthProvider`/`oauthId`, or any other private field. Tasks 9, 15 and
   * 16 all build their DTOs on top of this. */
  toPublicUser(user: User): PublicUser {
    return mapPublicUser(user)
  }

  async updateProfile(userId: string, input: UpdateProfileInput): Promise<PublicUser> {
    const user = await this.userModel.findByPk(userId)
    if (!user) {
      throw new NotFoundException('User not found')
    }

    if (input.nickname !== undefined) {
      user.nickname = input.nickname
    }
    if (input.avatarUrl !== undefined) {
      user.avatarUrl = input.avatarUrl
    }
    await user.save()

    return this.toPublicUser(user)
  }

  /** `excludeUserId` is not part of the query string the caller types —
   * the controller passes the current user's id here so a search never
   * returns the caller themselves. */
  async searchByNickname(
    query: string,
    limit: number,
    excludeUserId: string,
  ): Promise<PublicUser[]> {
    const trimmed = query.trim()
    if (trimmed.length === 0) {
      return []
    }

    const boundedLimit = Math.min(Math.max(limit, 1), MAX_SEARCH_LIMIT) || DEFAULT_SEARCH_LIMIT
    const rows = await this.userModel.findAll({
      where: {
        nickname: { [Op.iLike]: `%${trimmed}%` },
        id: { [Op.ne]: excludeUserId },
      },
      limit: boundedLimit,
      order: [['nickname', 'ASC']],
    })

    return rows.map((row) => this.toPublicUser(row))
  }
}
