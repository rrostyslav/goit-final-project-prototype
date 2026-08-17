import type { PublicUser } from '@gp/shared'
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { InjectModel } from '@nestjs/sequelize'
import { Friendship } from '../database/models/friendship.model'
import { User } from '../database/models/user.model'
import { NotificationsService } from '../notifications/notifications.service'
import { UsersService } from '../users/users.service'

/** A pending request as seen by one of its two participants: the row id
 * (needed to accept/decline) plus the public profile of the *other* party. */
export interface FriendRequestView {
  id: string
  user: PublicUser
}

// `Friendship` stores exactly one row per unordered pair — created in
// whichever direction `sendRequest` was called, with a unique index on
// (userId, friendId). Accept flips that single row's status in place; it is
// never mirrored into a second (friendId, userId) row. Every read that needs
// to be direction-agnostic (listFriends, the duplicate check in sendRequest,
// remove) therefore queries both directions explicitly and combines the
// results, rather than relying on a second row existing.
@Injectable()
export class FriendsService {
  constructor(
    @InjectModel(Friendship) private readonly friendshipModel: typeof Friendship,
    @InjectModel(User) private readonly userModel: typeof User,
    private readonly usersService: UsersService,
    private readonly notificationsService: NotificationsService,
  ) {}

  async sendRequest(fromId: string, toId: string): Promise<Friendship> {
    if (fromId === toId) {
      throw new BadRequestException('Cannot send a friend request to yourself')
    }

    const [fromUser, toUser] = await Promise.all([
      this.userModel.findByPk(fromId),
      this.userModel.findByPk(toId),
    ])
    if (!fromUser || !toUser) {
      throw new NotFoundException('User not found')
    }

    const [asRequester, asRecipient] = await Promise.all([
      this.friendshipModel.findOne({ where: { userId: fromId, friendId: toId } }),
      this.friendshipModel.findOne({ where: { userId: toId, friendId: fromId } }),
    ])
    if (asRequester || asRecipient) {
      throw new ConflictException('A friendship or request already exists between these users')
    }

    const request = await this.friendshipModel.create({
      userId: fromId,
      friendId: toId,
      status: 'pending',
    })

    await this.notificationsService.push(toId, 'friend_request', {
      fromId,
      fromNickname: fromUser.nickname,
    })

    return request
  }

  async accept(userId: string, requestId: string): Promise<Friendship> {
    const request = await this.findPendingRequestForRecipient(userId, requestId)
    request.status = 'accepted'
    await request.save()
    return request
  }

  async decline(userId: string, requestId: string): Promise<void> {
    const request = await this.findPendingRequestForRecipient(userId, requestId)
    await request.destroy()
  }

  /** `friendId` is the id of the other user, not a request/row id — this
   * removes an (accepted or still-pending) friendship between the caller and
   * that user, from both sides at once, since only one row backs the pair. */
  async remove(userId: string, friendId: string): Promise<void> {
    const [asRequester, asRecipient] = await Promise.all([
      this.friendshipModel.findOne({ where: { userId, friendId } }),
      this.friendshipModel.findOne({ where: { userId: friendId, friendId: userId } }),
    ])
    const row = asRequester ?? asRecipient
    if (!row) {
      throw new NotFoundException('Friendship not found')
    }

    await row.destroy()
  }

  async listFriends(userId: string): Promise<PublicUser[]> {
    const [asRequester, asRecipient] = await Promise.all([
      this.friendshipModel.findAll({ where: { userId, status: 'accepted' } }),
      this.friendshipModel.findAll({ where: { friendId: userId, status: 'accepted' } }),
    ])
    const otherIds = [
      ...asRequester.map((row) => row.friendId),
      ...asRecipient.map((row) => row.userId),
    ]
    return this.resolvePublicUsers(otherIds)
  }

  async listIncoming(userId: string): Promise<FriendRequestView[]> {
    const rows = await this.friendshipModel.findAll({
      where: { friendId: userId, status: 'pending' },
    })
    return this.toRequestViews(rows, (row) => row.userId)
  }

  async listOutgoing(userId: string): Promise<FriendRequestView[]> {
    const rows = await this.friendshipModel.findAll({
      where: { userId, status: 'pending' },
    })
    return this.toRequestViews(rows, (row) => row.friendId)
  }

  /** Enforces that only the request's recipient may act on it — a valid
   * request id alone is never enough, and a non-recipient gets 403 before
   * anything about the request's current status is revealed. */
  private async findPendingRequestForRecipient(
    userId: string,
    requestId: string,
  ): Promise<Friendship> {
    const request = await this.friendshipModel.findByPk(requestId)
    if (!request) {
      throw new NotFoundException('Friend request not found')
    }
    if (request.friendId !== userId) {
      throw new ForbiddenException('Only the recipient can act on this request')
    }
    if (request.status !== 'pending') {
      throw new ConflictException('Friend request is no longer pending')
    }
    return request
  }

  private async toRequestViews(
    rows: Friendship[],
    otherIdOf: (row: Friendship) => string,
  ): Promise<FriendRequestView[]> {
    const views = await Promise.all(
      rows.map(async (row) => {
        const other = await this.userModel.findByPk(otherIdOf(row))
        return other ? { id: row.id, user: this.usersService.toPublicUser(other) } : null
      }),
    )
    return views.filter((view): view is FriendRequestView => view !== null)
  }

  private async resolvePublicUsers(ids: string[]): Promise<PublicUser[]> {
    const users = await Promise.all(ids.map((id) => this.userModel.findByPk(id)))
    return users
      .filter((user): user is User => user !== null)
      .map((user) => this.usersService.toPublicUser(user))
  }
}
