import { Injectable } from '@nestjs/common'
import { z } from 'zod'

const schema = z.object({
  NODE_ENV: z.string().default('development'),
  PORT: z.coerce.number().default(4000),
  CORS_ORIGIN: z.string().default('http://localhost:3000'),
  DATABASE_URL: z.string(),
  REDIS_URL: z.string(),
  JWT_ACCESS_SECRET: z.string().min(8),
  JWT_REFRESH_SECRET: z.string().min(8),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL: z.string().default('30d'),
  LIVEKIT_URL: z
    .string()
    .optional()
    .transform((v) => v || null),
  LIVEKIT_API_KEY: z
    .string()
    .optional()
    .transform((v) => v || null),
  LIVEKIT_API_SECRET: z
    .string()
    .optional()
    .transform((v) => v || null),
  GOOGLE_CLIENT_ID: z
    .string()
    .optional()
    .transform((v) => v || null),
  GOOGLE_CLIENT_SECRET: z
    .string()
    .optional()
    .transform((v) => v || null),
  GOOGLE_CALLBACK_URL: z.string().default('http://localhost:4000/api/auth/google/callback'),
})

type Env = z.infer<typeof schema>

@Injectable()
export class AppConfigService {
  private readonly env: Env

  constructor() {
    this.env = schema.parse(process.env)
  }

  get nodeEnv(): string {
    return this.env.NODE_ENV
  }

  get port(): number {
    return this.env.PORT
  }

  get corsOrigin(): string {
    return this.env.CORS_ORIGIN
  }

  get databaseUrl(): string {
    return this.env.DATABASE_URL
  }

  get redisUrl(): string {
    return this.env.REDIS_URL
  }

  get jwtAccessSecret(): string {
    return this.env.JWT_ACCESS_SECRET
  }

  get jwtRefreshSecret(): string {
    return this.env.JWT_REFRESH_SECRET
  }

  get jwtAccessTtl(): string {
    return this.env.JWT_ACCESS_TTL
  }

  get jwtRefreshTtl(): string {
    return this.env.JWT_REFRESH_TTL
  }

  get livekitUrl(): string | null {
    return this.env.LIVEKIT_URL
  }

  get livekitApiKey(): string | null {
    return this.env.LIVEKIT_API_KEY
  }

  get livekitApiSecret(): string | null {
    return this.env.LIVEKIT_API_SECRET
  }

  get googleClientId(): string | null {
    return this.env.GOOGLE_CLIENT_ID
  }

  get googleClientSecret(): string | null {
    return this.env.GOOGLE_CLIENT_SECRET
  }

  get googleCallbackUrl(): string {
    return this.env.GOOGLE_CALLBACK_URL
  }

  get voiceEnabled(): boolean {
    return this.livekitUrl !== null && this.livekitApiKey !== null && this.livekitApiSecret !== null
  }

  get oauthEnabled(): boolean {
    return this.googleClientId !== null && this.googleClientSecret !== null
  }
}
