import type { PublicUser } from '@gp/shared'
import type { AppConfigService } from '../src/config/env.config'
import { VoiceService } from '../src/voice/voice.service'

const user: PublicUser = { id: 'user-1', nickname: 'Ada', avatarUrl: null, isGuest: true }

const enabledConfig = {
  voiceEnabled: true,
  livekitUrl: 'ws://localhost:7880',
  livekitApiKey: 'devkey',
  livekitApiSecret: 'devsecretdevsecretdevsecretdevsecret32',
} as AppConfigService

/** Decodes a JWT's payload without verifying its signature — enough to
 * assert on the claims this suite cares about (this is a unit test of what
 * `VoiceService` puts INTO the token; signature verification against a real
 * LiveKit server is covered separately, see task-18-report.md). */
function decodePayload(token: string): Record<string, unknown> {
  const parts = token.split('.')
  const payload = parts[1]
  if (!payload) throw new Error('unreachable: a JWT always has a payload segment')
  return JSON.parse(Buffer.from(payload, 'base64').toString()) as Record<string, unknown>
}

describe('VoiceService', () => {
  describe('disabled voice', () => {
    it('reports voice disabled when LIVEKIT_URL is absent', async () => {
      const svc = new VoiceService({ voiceEnabled: false } as AppConfigService)
      expect(await svc.issueToken('r1', user)).toEqual({
        enabled: false,
        url: null,
        token: null,
        roomName: null,
      })
    })

    it('never touches livekit-server-sdk when voice is disabled', async () => {
      // No apiKey/apiSecret on this fake config at all — if `issueToken`
      // tried to build a real AccessToken on the disabled path, this would
      // throw synchronously ("api-key and api-secret must be set") instead
      // of resolving.
      const svc = new VoiceService({ voiceEnabled: false } as AppConfigService)
      await expect(svc.issueToken('r1', user)).resolves.toEqual({
        enabled: false,
        url: null,
        token: null,
        roomName: null,
      })
    })
  })

  describe('enabled voice', () => {
    it('issues a token scoped to the requested room only', async () => {
      const svc = new VoiceService(enabledConfig)
      const creds = await svc.issueToken('r1', user)

      expect(creds.enabled).toBe(true)
      expect(creds.url).toBe('ws://localhost:7880')
      expect(creds.roomName).toBe('room-r1')
      expect(creds.token).not.toBeNull()

      const token = creds.token
      if (!token) throw new Error('unreachable')
      const decoded = decodePayload(token)
      const video = decoded.video as Record<string, unknown>
      expect(video.room).toBe('room-r1')
      expect(video.roomJoin).toBe(true)
      expect(decoded.sub).toBe(user.id)
    })

    it('grants exactly publish+subscribe on the room — nothing broader', async () => {
      const svc = new VoiceService(enabledConfig)
      const creds = await svc.issueToken('r1', user)
      const token = creds.token
      if (!token) throw new Error('unreachable')
      const video = decodePayload(token).video as Record<string, unknown>

      expect(video.canPublish).toBe(true)
      expect(video.canSubscribe).toBe(true)
      // Nothing this task's brief asked for: no room-admin/create/list
      // powers leak into a per-room participant token.
      expect(video.roomAdmin).toBeUndefined()
      expect(video.roomCreate).toBeUndefined()
      expect(video.roomList).toBeUndefined()
    })

    it('sets identity to the user id and name to the nickname', async () => {
      const svc = new VoiceService(enabledConfig)
      const creds = await svc.issueToken('r1', user)
      const token = creds.token
      if (!token) throw new Error('unreachable')
      const decoded = decodePayload(token)

      expect(decoded.sub).toBe('user-1')
      expect(decoded.name).toBe('Ada')
    })

    it('scopes two different rooms to two different, non-overlapping tokens', async () => {
      const svc = new VoiceService(enabledConfig)
      const credsA = await svc.issueToken('room-a', user)
      const credsB = await svc.issueToken('room-b', user)
      if (!credsA.token || !credsB.token) throw new Error('unreachable')

      const videoA = decodePayload(credsA.token).video as Record<string, unknown>
      const videoB = decodePayload(credsB.token).video as Record<string, unknown>
      expect(videoA.room).toBe('room-room-a')
      expect(videoB.room).toBe('room-room-b')
      expect(videoA.room).not.toBe(videoB.room)
    })

    it('sets a 6 hour TTL', async () => {
      const svc = new VoiceService(enabledConfig)
      const creds = await svc.issueToken('r1', user)
      const token = creds.token
      if (!token) throw new Error('unreachable')
      const decoded = decodePayload(token)
      // livekit-server-sdk's AccessToken does not set a standard `iat`
      // claim — it sets `nbf` ("not before") to the signing instant instead
      // (see the printed payload this test was written against), so the
      // TTL is `exp - nbf`, not `exp - iat`.
      const nbf = decoded.nbf as number
      const exp = decoded.exp as number
      expect(exp - nbf).toBe(6 * 60 * 60)
    })
  })

  describe('roomName', () => {
    it('derives the LiveKit room name from the room id', () => {
      const svc = new VoiceService(enabledConfig)
      expect(svc.roomName('abc123')).toBe('room-abc123')
    })
  })
})
