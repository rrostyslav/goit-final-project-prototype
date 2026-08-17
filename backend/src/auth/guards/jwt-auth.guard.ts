import { Injectable } from '@nestjs/common'
import { AuthGuard } from '@nestjs/passport'

/** Requires a valid `Authorization: Bearer` access token; rejects with 401
 * otherwise (the default AuthGuard#handleRequest behaviour). */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {}
