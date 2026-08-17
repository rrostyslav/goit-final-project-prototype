import type { PublicUser } from '@gp/shared'
import { createParamDecorator, ExecutionContext } from '@nestjs/common'

interface RequestWithUser {
  user?: PublicUser
}

/** Pulls the user attached by JwtAuthGuard/OptionalJwtGuard off the request.
 * Under JwtAuthGuard the guard already rejected unauthenticated requests
 * with 401, so `user` is guaranteed present there; under OptionalJwtGuard
 * callers should treat the result as possibly undefined. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): PublicUser => {
    const request = ctx.switchToHttp().getRequest<RequestWithUser>()
    return request.user as PublicUser
  },
)
