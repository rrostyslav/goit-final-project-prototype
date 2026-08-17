import { AppConfigService } from '../src/config/env.config'

const validEnv: Record<string, string> = {
  NODE_ENV: 'test',
  PORT: '4000',
  CORS_ORIGIN: 'http://localhost:3000',
  DATABASE_URL: 'postgres://gameplatform:gameplatform@localhost:5432/gameplatform',
  REDIS_URL: 'redis://localhost:6379',
  JWT_ACCESS_SECRET: 'access-secret-12345',
  JWT_REFRESH_SECRET: 'refresh-secret-12345',
  JWT_ACCESS_TTL: '15m',
  JWT_REFRESH_TTL: '30d',
  LIVEKIT_URL: 'ws://localhost:7880',
  LIVEKIT_API_KEY: 'devkey',
  LIVEKIT_API_SECRET: 'devsecretdevsecretdevsecretdevsecret32',
  GOOGLE_CLIENT_ID: 'google-client-id',
  GOOGLE_CLIENT_SECRET: 'google-client-secret',
  GOOGLE_CALLBACK_URL: 'http://localhost:4000/api/auth/google/callback',
}

// Builds a fully-isolated env object for one test case: starts from a known-valid
// baseline (never the developer's real process.env / backend/.env) and applies
// overrides. Passing `undefined` for a key removes it entirely, simulating an
// absent variable rather than an empty string.
function buildEnv(overrides: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  const env: Record<string, string> = { ...validEnv }
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) {
      delete env[key]
    } else {
      env[key] = value
    }
  }
  return env
}

describe('AppConfigService', () => {
  const originalEnv = process.env

  afterEach(() => {
    process.env = originalEnv
  })

  it('parses a valid environment and exposes each property', () => {
    process.env = buildEnv()

    const service = new AppConfigService()

    expect(service.nodeEnv).toBe('test')
    expect(service.port).toBe(4000)
    expect(service.corsOrigin).toBe('http://localhost:3000')
    expect(service.databaseUrl).toBe(
      'postgres://gameplatform:gameplatform@localhost:5432/gameplatform',
    )
    expect(service.redisUrl).toBe('redis://localhost:6379')
    expect(service.jwtAccessSecret).toBe('access-secret-12345')
    expect(service.jwtRefreshSecret).toBe('refresh-secret-12345')
    expect(service.jwtAccessTtl).toBe('15m')
    expect(service.jwtRefreshTtl).toBe('30d')
    expect(service.livekitUrl).toBe('ws://localhost:7880')
    expect(service.livekitApiKey).toBe('devkey')
    expect(service.livekitApiSecret).toBe('devsecretdevsecretdevsecretdevsecret32')
    expect(service.googleClientId).toBe('google-client-id')
    expect(service.googleClientSecret).toBe('google-client-secret')
    expect(service.googleCallbackUrl).toBe('http://localhost:4000/api/auth/google/callback')
    expect(service.voiceEnabled).toBe(true)
    expect(service.oauthEnabled).toBe(true)
  })

  it('throws when a required variable is missing', () => {
    process.env = buildEnv({ DATABASE_URL: undefined })

    expect(() => new AppConfigService()).toThrow()
  })

  it('throws when JWT_ACCESS_SECRET is shorter than the schema minimum', () => {
    process.env = buildEnv({ JWT_ACCESS_SECRET: 'short12' })

    expect(() => new AppConfigService()).toThrow()
  })

  it('coerces a string PORT to a number', () => {
    process.env = buildEnv({ PORT: '5050' })

    const service = new AppConfigService()

    expect(service.port).toBe(5050)
    expect(typeof service.port).toBe('number')
  })

  it('turns empty-string LiveKit variables into null', () => {
    process.env = buildEnv({
      LIVEKIT_URL: '',
      LIVEKIT_API_KEY: '',
      LIVEKIT_API_SECRET: '',
    })

    const service = new AppConfigService()

    expect(service.livekitUrl).toBeNull()
    expect(service.livekitApiKey).toBeNull()
    expect(service.livekitApiSecret).toBeNull()
  })

  it('turns absent LiveKit variables into null', () => {
    process.env = buildEnv({
      LIVEKIT_URL: undefined,
      LIVEKIT_API_KEY: undefined,
      LIVEKIT_API_SECRET: undefined,
    })

    const service = new AppConfigService()

    expect(service.livekitUrl).toBeNull()
    expect(service.livekitApiKey).toBeNull()
    expect(service.livekitApiSecret).toBeNull()
  })

  it('turns empty-string Google variables into null', () => {
    process.env = buildEnv({
      GOOGLE_CLIENT_ID: '',
      GOOGLE_CLIENT_SECRET: '',
    })

    const service = new AppConfigService()

    expect(service.googleClientId).toBeNull()
    expect(service.googleClientSecret).toBeNull()
  })

  it('turns absent Google variables into null', () => {
    process.env = buildEnv({
      GOOGLE_CLIENT_ID: undefined,
      GOOGLE_CLIENT_SECRET: undefined,
    })

    const service = new AppConfigService()

    expect(service.googleClientId).toBeNull()
    expect(service.googleClientSecret).toBeNull()
  })

  const voiceDisabledCases: Array<[string, Record<string, string | undefined>]> = [
    ['LIVEKIT_URL is missing', { LIVEKIT_URL: undefined }],
    ['LIVEKIT_URL is empty', { LIVEKIT_URL: '' }],
    ['LIVEKIT_API_KEY is missing', { LIVEKIT_API_KEY: undefined }],
    ['LIVEKIT_API_KEY is empty', { LIVEKIT_API_KEY: '' }],
    ['LIVEKIT_API_SECRET is missing', { LIVEKIT_API_SECRET: undefined }],
    ['LIVEKIT_API_SECRET is empty', { LIVEKIT_API_SECRET: '' }],
  ]

  it.each(voiceDisabledCases)('voiceEnabled is false when %s', (_description, overrides) => {
    process.env = buildEnv(overrides)

    const service = new AppConfigService()

    expect(service.voiceEnabled).toBe(false)
  })

  it('voiceEnabled is true only when all three LiveKit values are present', () => {
    process.env = buildEnv()

    const service = new AppConfigService()

    expect(service.voiceEnabled).toBe(true)
  })

  const oauthDisabledCases: Array<[string, Record<string, string | undefined>]> = [
    ['GOOGLE_CLIENT_ID is missing', { GOOGLE_CLIENT_ID: undefined }],
    ['GOOGLE_CLIENT_ID is empty', { GOOGLE_CLIENT_ID: '' }],
    ['GOOGLE_CLIENT_SECRET is missing', { GOOGLE_CLIENT_SECRET: undefined }],
    ['GOOGLE_CLIENT_SECRET is empty', { GOOGLE_CLIENT_SECRET: '' }],
  ]

  it.each(oauthDisabledCases)('oauthEnabled is false when %s', (_description, overrides) => {
    process.env = buildEnv(overrides)

    const service = new AppConfigService()

    expect(service.oauthEnabled).toBe(false)
  })

  it('oauthEnabled is true only when both Google values are present', () => {
    process.env = buildEnv()

    const service = new AppConfigService()

    expect(service.oauthEnabled).toBe(true)
  })

  it('applies defaults when optional variables are absent', () => {
    process.env = buildEnv({
      PORT: undefined,
      CORS_ORIGIN: undefined,
      JWT_ACCESS_TTL: undefined,
      JWT_REFRESH_TTL: undefined,
      GOOGLE_CALLBACK_URL: undefined,
      NODE_ENV: undefined,
    })

    const service = new AppConfigService()

    expect(service.port).toBe(4000)
    expect(service.corsOrigin).toBe('http://localhost:3000')
    expect(service.jwtAccessTtl).toBe('15m')
    expect(service.jwtRefreshTtl).toBe('30d')
    expect(service.googleCallbackUrl).toBe('http://localhost:4000/api/auth/google/callback')
    expect(service.nodeEnv).toBe('development')
  })
})
