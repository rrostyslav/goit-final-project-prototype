import type { Locale } from './constants'
import type { ChatMessageDto, NotificationDto, PlayerId, RoomDto, RoomId } from './domain'
import type { DrawStroke, GameAction, GameEvent, PlayerView } from './game-view'
import type { GameId } from './games'

export interface Ack<T> {
  ok: boolean
  data?: T
  error?: { code: string; message: string }
}

export interface VoiceCredentials {
  enabled: boolean
  url: string | null
  token: string | null
  roomName: string | null
}

export interface ClientToServerEvents {
  'room:join': (p: { roomId: RoomId }, ack: (r: Ack<RoomDto>) => void) => void
  'room:leave': (p: { roomId: RoomId }, ack: (r: Ack<null>) => void) => void
  'room:ready': (p: { roomId: RoomId; isReady: boolean }, ack: (r: Ack<null>) => void) => void
  'room:chat': (p: { roomId: RoomId; text: string }, ack: (r: Ack<null>) => void) => void
  'room:select_game': (p: { roomId: RoomId; gameId: GameId }, ack: (r: Ack<null>) => void) => void
  'room:vote_game': (p: { roomId: RoomId; gameId: GameId }, ack: (r: Ack<null>) => void) => void
  'room:kick': (p: { roomId: RoomId; userId: PlayerId }, ack: (r: Ack<null>) => void) => void
  'room:ban': (p: { roomId: RoomId; userId: PlayerId }, ack: (r: Ack<null>) => void) => void
  'room:transfer_host': (
    p: { roomId: RoomId; userId: PlayerId },
    ack: (r: Ack<null>) => void,
  ) => void
  // `locale` is optional and additive (final-review finding D): older
  // clients that never send it still work exactly as before —
  // `GameRuntimeService` falls back to `uk` — this only lets a client that
  // DOES send one pick which seeded word deck (Alias/Hat/Crocodile) a game
  // draws from. The server validates it against `SUPPORTED_LOCALES` rather
  // than trusting the client outright (see that method's own doc comment).
  'game:start': (p: { roomId: RoomId; locale?: Locale }, ack: (r: Ack<null>) => void) => void
  'game:action': (p: { roomId: RoomId; action: GameAction }, ack: (r: Ack<null>) => void) => void
  'draw:stroke': (p: { roomId: RoomId; stroke: DrawStroke }) => void
  'draw:clear': (p: { roomId: RoomId }) => void
  'voice:token': (p: { roomId: RoomId }, ack: (r: Ack<VoiceCredentials>) => void) => void
}

export interface ServerToClientEvents {
  'room:state': (p: RoomDto) => void
  'room:votes': (p: Record<string, PlayerId[]>) => void
  'chat:message': (p: ChatMessageDto) => void
  'game:started': (p: { gameId: GameId; sessionId: string }) => void
  'game:state': (p: PlayerView) => void
  'game:event': (p: GameEvent) => void
  'game:ended': (p: {
    sessionId: string
    standings: { playerId: PlayerId; score: number; placement: number }[]
  }) => void
  'draw:stroke': (p: DrawStroke) => void
  'draw:sync': (p: DrawStroke[]) => void
  'room:kicked': (p: { reason: 'kick' | 'ban' }) => void
  notification: (p: NotificationDto) => void
  error: (p: { code: string; message: string }) => void
}

export const SOCKET_NAMESPACE = '/rt'
