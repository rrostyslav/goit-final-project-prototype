import type { PublicUser } from '@gp/shared'
import {
  createParamDecorator,
  type ExecutionContext,
  InternalServerErrorException,
} from '@nestjs/common'

interface RequestWithUser {
  user?: PublicUser
}

/** Pulls the user attached by JwtAuthGuard off the request. Only valid on
 * routes behind JwtAuthGuard, which already rejects unauthenticated
 * requests with 401 — so `request.user` is guaranteed present by the time
 * this runs. If it is ever reached with no user attached (e.g. mistakenly
 * paired with OptionalJwtGuard instead), it throws immediately rather than
 * silently returning `undefined` typed as `PublicUser`; use `@OptionalUser()`
 * for routes behind OptionalJwtGuard instead. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): PublicUser => {
    const request = ctx.switchToHttp().getRequest<RequestWithUser>()
    if (!request.user) {
      throw new InternalServerErrorException(
        '@CurrentUser() found no user on the request — this route is likely behind ' +
          'OptionalJwtGuard, not JwtAuthGuard; use @OptionalUser() instead',
      )
    }
    return request.user
  },
)

/** Pulls the user attached by OptionalJwtGuard off the request, or `null`
 * for anonymous callers. Use this (not `@CurrentUser()`) on routes behind
 * OptionalJwtGuard, where the caller may not be authenticated at all. */
export const OptionalUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): PublicUser | null => {
    const request = ctx.switchToHttp().getRequest<RequestWithUser>()
    return request.user ?? null
  },
)
