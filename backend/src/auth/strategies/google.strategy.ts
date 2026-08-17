import { Injectable } from '@nestjs/common'
import { PassportStrategy } from '@nestjs/passport'
import { type Profile, Strategy } from 'passport-google-oauth20'
import { AppConfigService } from '../../config/env.config'
import { AuthService, type AuthSession } from '../auth.service'

/** Only ever constructed by AuthModule's factory provider when
 * config.oauthEnabled is true — passport-oauth2 throws synchronously if
 * clientID/clientSecret are missing, so this must never be `new`'d otherwise. */
@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: AppConfigService,
    private readonly authService: AuthService,
  ) {
    super({
      clientID: config.googleClientId ?? '',
      clientSecret: config.googleClientSecret ?? '',
      callbackURL: config.googleCallbackUrl,
      scope: ['email', 'profile'],
    })
  }

  // Returning the result (rather than calling the passport `done` callback
  // ourselves) is deliberate: Nest's PassportStrategy mixin already wraps
  // this method and calls `done(null, returnValue)` for us. Calling `done`
  // manually here as well would settle the passport callback twice.
  async validate(
    _accessToken: string,
    _refreshToken: string,
    profile: Profile,
  ): Promise<AuthSession> {
    const email = profile.emails?.[0]?.value ?? null
    const avatarUrl = profile.photos?.[0]?.value ?? null

    return this.authService.findOrCreateOAuthUser({
      provider: 'google',
      providerId: profile.id,
      email,
      nickname: profile.displayName || email || 'Player',
      avatarUrl,
    })
  }
}
