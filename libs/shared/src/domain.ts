import type { GameId } from './games'

export type UserId = string
export type RoomId = string
export type SessionId = string
export type PlayerId = UserId

export type RoomStatus = 'lobby' | 'in_game' | 'results'
export type RoomVisibility = 'private' | 'public'
export type ConnectionState = 'online' | 'disconnected'
export type FriendshipStatus = 'pending' | 'accepted' | 'blocked'

export interface PublicUser {
  id: UserId
  nickname: string
  avatarUrl: string | null
  isGuest: boolean
}

export interface RoomMemberDto {
  user: PublicUser
  isHost: boolean
  isReady: boolean
  connection: ConnectionState
  joinedAt: string
}

export interface RoomDto {
  id: RoomId
  code: string
  visibility: RoomVisibility
  status: RoomStatus
  hostId: UserId
  maxPlayers: number
  selectedGameId: GameId | null
  members: RoomMemberDto[]
  createdAt: string
}

/** Row in the public room browser. Never includes member identities. */
export interface RoomBrowserEntry {
  id: RoomId
  code: string
  status: RoomStatus
  selectedGameId: GameId | null
  playerCount: number
  maxPlayers: number
  hostNickname: string
  createdAt: string
}

export interface ChatMessageDto {
  id: string
  roomId: RoomId
  author: PublicUser
  text: string
  sentAt: string
}

export interface AuthTokens {
  accessToken: string
  user: PublicUser
}

export interface NotificationDto {
  id: string
  type: 'friend_request' | 'room_invite'
  payload: Record<string, string>
  createdAt: string
  readAt: string | null
}

export interface GameResultDto {
  sessionId: SessionId
  gameId: GameId
  userId: UserId
  nickname: string
  score: number
  placement: number
}

export interface MatchHistoryEntry {
  sessionId: SessionId
  gameId: GameId
  roomCode: string
  score: number
  placement: number
  playerCount: number
  endedAt: string
}
