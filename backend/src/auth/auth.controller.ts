import type { AuthTokens, PublicUser } from '@gp/shared'
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common'
import type { Request, Response } from 'express'
import { AuthService, type AuthSession } from './auth.service'
import { CurrentUser } from './decorators/current-user.decorator'
import { GuestDto } from './dto/guest.dto'
import { LoginDto } from './dto/login.dto'
import { RegisterDto } from './dto/register.dto'
import { UpgradeDto } from './dto/upgrade.dto'
import { GoogleAuthGuard } from './guards/google-auth.guard'
import { JwtAuthGuard } from './guards/jwt-auth.guard'

const REFRESH_COOKIE_NAME = 'refresh_token'
const REFRESH_COOKIE_PATH = '/api/auth'

interface RequestWithSession extends Request {
  user: AuthSession
}

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('guest')
  @HttpCode(HttpStatus.OK)
  async guest(
    @Body() dto: GuestDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthTokens> {
    const session = await this.authService.createGuest(dto.nickname)
    return this.respondWithSession(session, res)
  }

  @Post('register')
  async register(
    @Body() dto: RegisterDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthTokens> {
    const session = await this.authService.register(dto.email, dto.password, dto.nickname)
    return this.respondWithSession(session, res)
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthTokens> {
    const session = await this.authService.login(dto.email, dto.password)
    return this.respondWithSession(session, res)
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthTokens> {
    const token: unknown = req.cookies?.[REFRESH_COOKIE_NAME]
    if (typeof token !== 'string' || token.length === 0) {
      throw new UnauthorizedException('Missing refresh token')
    }
    const session = await this.authService.refresh(token)
    return this.respondWithSession(session, res)
  }

  /** Only clears the `refresh_token` cookie client-side — it does not
   * revoke the refresh JWT itself. That token stays valid server-side for
   * its full `jwtRefreshTtl` (30d by default), so a refresh token captured
   * before logout (e.g. via XSS or a synced device) still mints new access
   * tokens until it naturally expires. Acceptable tradeoff for this
   * prototype; a real fix needs either a server-side revocation blocklist
   * (reject a token's `jti`/`sub` once logged out) or rotating
   * refresh-token families (invalidate the whole family when a stale token
   * in the chain is reused). */
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  logout(@Res({ passthrough: true }) res: Response): { success: true } {
    res.clearCookie(REFRESH_COOKIE_NAME, { path: REFRESH_COOKIE_PATH })
    return { success: true }
  }

  @Post('upgrade')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  async upgrade(
    @CurrentUser() user: PublicUser,
    @Body() dto: UpgradeDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthTokens> {
    const session = await this.authService.upgradeGuest(user.id, dto.email, dto.password)
    return this.respondWithSession(session, res)
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  me(@CurrentUser() user: PublicUser): PublicUser {
    return user
  }

  @Get('google')
  @UseGuards(GoogleAuthGuard)
  googleAuth(): void {
    // Guard redirects to Google's consent screen; nothing to do here. Only
    // reached at all when config.oauthEnabled (see GoogleAuthGuard).
  }

  @Get('google/callback')
  @UseGuards(GoogleAuthGuard)
  googleCallback(
    @Req() req: RequestWithSession,
    @Res({ passthrough: true }) res: Response,
  ): AuthTokens {
    return this.respondWithSession(req.user, res)
  }

  private respondWithSession(session: AuthSession, res: Response): AuthTokens {
    res.cookie(REFRESH_COOKIE_NAME, session.refreshToken, {
      httpOnly: true,
      sameSite: 'lax',
      path: REFRESH_COOKIE_PATH,
    })
    return { accessToken: session.accessToken, user: session.user }
  }
}
