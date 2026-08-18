import type { PublicUser, RoomId, VoiceCredentials } from '@gp/shared'
import { Injectable } from '@nestjs/common'
import { AccessToken } from 'livekit-server-sdk'
import { AppConfigService } from '../config/env.config'

/** Fixed per the brief: "Token TTL is 6 hours." The client is responsible
 * for refreshing before this expires (see `voice:token`'s doc comment on
 * `RealtimeGateway`) — this service only ever issues, never refreshes. */
const TOKEN_TTL_SECONDS = 6 * 60 * 60

/** Issues scoped LiveKit access tokens for the voice room that shadows every
 * game room 1:1 (`room-{roomId}`). Never talks to the LiveKit server itself
 * (no admin API calls, no room list/create) — a token is a self-contained
 * signed JWT the LiveKit server verifies on connect using the same
 * `LIVEKIT_API_KEY`/`LIVEKIT_API_SECRET` this service signs with. */
@Injectable()
export class VoiceService {
  constructor(private readonly config: AppConfigService) {}

  /** The LiveKit room name for a given game room. A stable 1:1 mapping so a
   * voice room can never be confused with another game room's — declared as
   * its own method (rather than inlined at each call site) because both
   * `issueToken` below and a future admin/moderation caller need the exact
   * same derivation. */
  roomName(roomId: RoomId): string {
    return `room-${roomId}`
  }

  /**
   * Returns `{ enabled: false, url: null, token: null, roomName: null }`
   * without ever constructing a LiveKit `AccessToken` when
   * `config.voiceEnabled` is false (LIVEKIT_URL/KEY/SECRET not configured) —
   * voice is an optional feature, not a hard dependency of the room itself.
   *
   * Otherwise returns a JWT that grants access to EXACTLY ONE LiveKit room —
   * `roomJoin: true, room: this.roomName(roomId)` — and nothing broader (no
   * `roomAdmin`/`roomCreate`/`roomList`): this is the whole security
   * boundary between "may sit in this game's voice room" and "may do
   * anything else on the LiveKit server." `identity` is always the caller's
   * own authenticated user id, taken from `user.id` — never accept an
   * `identity` from the client, and never let a caller pass an
   * arbitrary `roomId` unchecked: `RealtimeGateway.onVoiceToken` verifies
   * the caller is actually a member of `roomId` (via the same
   * `assertMember` every other room-scoped socket handler uses) BEFORE
   * calling this method, since a plain string `roomId` param here has no
   * way to enforce that itself.
   */
  async issueToken(roomId: RoomId, user: PublicUser): Promise<VoiceCredentials> {
    // Destructured once so the null-narrowing below applies to these local
    // bindings, not to `this.config`'s getters (TypeScript cannot narrow a
    // getter across the `voiceEnabled` boolean check alone).
    const { livekitUrl, livekitApiKey, livekitApiSecret } = this.config
    if (
      !this.config.voiceEnabled ||
      livekitUrl === null ||
      livekitApiKey === null ||
      livekitApiSecret === null
    ) {
      return { enabled: false, url: null, token: null, roomName: null }
    }

    const roomName = this.roomName(roomId)
    const token = new AccessToken(livekitApiKey, livekitApiSecret, {
      identity: user.id,
      name: user.nickname,
      ttl: TOKEN_TTL_SECONDS,
    })
    token.addGrant({ roomJoin: true, room: roomName, canPublish: true, canSubscribe: true })
    const jwt = await token.toJwt()

    return { enabled: true, url: livekitUrl, token: jwt, roomName }
  }
}
