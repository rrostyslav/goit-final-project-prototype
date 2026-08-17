import type { PublicUser } from '@gp/shared'
import { Injectable, UnauthorizedException } from '@nestjs/common'
import { PassportStrategy } from '@nestjs/passport'
import type { Request } from 'express'
import { ExtractJwt, Strategy } from 'passport-jwt'
import { AppConfigService } from '../../config/env.config'
import { AuthService } from '../auth.service'

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private readonly authService: AuthService,
    config: AppConfigService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.jwtAccessSecret,
      passReqToCallback: true,
    })
  }

  // passport-jwt already verified the signature/expiry before calling this;
  // we re-extract the raw token and hand off to AuthService.verifyAccessToken
  // so there is a single source of truth for "token -> PublicUser" that the
  // WS gateway (Task 15) can also call directly outside of an HTTP request.
  async validate(req: Request): Promise<PublicUser> {
    const token = ExtractJwt.fromAuthHeaderAsBearerToken()(req)
    if (!token) {
      throw new UnauthorizedException()
    }
    return this.authService.verifyAccessToken(token)
  }
}
