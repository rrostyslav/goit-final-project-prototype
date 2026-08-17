import { Module } from '@nestjs/common'
import { JwtModule } from '@nestjs/jwt'
import { PassportModule } from '@nestjs/passport'
import { AppConfigModule } from '../config/config.module'
import { AppConfigService } from '../config/env.config'
import { DatabaseModule } from '../database/database.module'
import { AuthController } from './auth.controller'
import { AuthService } from './auth.service'
import { GoogleAuthGuard } from './guards/google-auth.guard'
import { JwtAuthGuard } from './guards/jwt-auth.guard'
import { OptionalJwtGuard } from './guards/optional-jwt.guard'
import { GoogleStrategy } from './strategies/google.strategy'
import { JwtStrategy } from './strategies/jwt.strategy'

@Module({
  imports: [AppConfigModule, DatabaseModule, PassportModule, JwtModule.register({})],
  controllers: [AuthController],
  providers: [
    AuthService,
    JwtStrategy,
    JwtAuthGuard,
    OptionalJwtGuard,
    GoogleAuthGuard,
    // Registered conditionally: passport-google-oauth20's Strategy throws
    // synchronously in its constructor when clientID/clientSecret are
    // missing, so GoogleStrategy must only ever be `new`'d when OAuth is
    // configured. A factory provider (rather than splicing the class in/out
    // of this array based on a directly-read env var) is required here
    // because `process.env` is not fully populated from `backend/.env`
    // until `loadEnvFile()` runs inside `bootstrap()` in main.ts — which
    // happens *after* this module file is first imported/required, but
    // *before* Nest actually instantiates providers. Reading config through
    // AppConfigService via DI (as this factory does) lands after the env
    // file is loaded; reading `process.env` directly at module-decoration
    // time would not.
    {
      provide: GoogleStrategy,
      inject: [AppConfigService, AuthService],
      useFactory: (config: AppConfigService, authService: AuthService): GoogleStrategy | null =>
        config.oauthEnabled ? new GoogleStrategy(config, authService) : null,
    },
  ],
  exports: [AuthService],
})
export class AuthModule {}
