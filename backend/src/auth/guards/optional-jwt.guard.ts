import type { PublicUser } from '@gp/shared'
import { Injectable } from '@nestjs/common'
import { AuthGuard } from '@nestjs/passport'

/** Attaches the user when a valid access token is present, but never
 * rejects the request when it is absent or invalid — routes behind this
 * guard read `@OptionalUser()`, which returns `PublicUser | null`. */
@Injectable()
export class OptionalJwtGuard extends AuthGuard('jwt') {
  override handleRequest<TUser = PublicUser>(
    _err: unknown,
    user: TUser | false,
  ): TUser | undefined {
    return user === false ? undefined : user
  }
}
