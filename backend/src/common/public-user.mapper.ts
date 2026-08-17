import type { PublicUser } from '@gp/shared'
import { User } from '../database/models/user.model'

/** The single allowlist deciding what leaves the server about a user.
 * Every route that returns user data goes through here, so `passwordHash`,
 * `email`, `oauthId` and `oauthProvider` cannot leak by omission. */
export function toPublicUser(user: User): PublicUser {
  return {
    id: user.id,
    nickname: user.nickname,
    avatarUrl: user.avatarUrl,
    isGuest: user.isGuest,
  }
}
