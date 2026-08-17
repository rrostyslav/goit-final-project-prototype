import { ExecutionContext, Injectable, NotFoundException } from '@nestjs/common'
import { AuthGuard } from '@nestjs/passport'
import { AppConfigService } from '../../config/env.config'

/** Wraps AuthGuard('google') with an oauthEnabled check. The 'google'
 * passport strategy is only constructed (see AuthModule) when OAuth is
 * configured, so we must never let the base guard reach it otherwise —
 * that would throw "Unknown authentication strategy" instead of a clean
 * 404. This guard is always registered; only the strategy is conditional. */
@Injectable()
export class GoogleAuthGuard extends AuthGuard('google') {
  constructor(private readonly config: AppConfigService) {
    super()
  }

  override canActivate(context: ExecutionContext) {
    if (!this.config.oauthEnabled) {
      throw new NotFoundException()
    }
    return super.canActivate(context)
  }
}
