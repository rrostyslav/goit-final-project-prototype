import type { GameId, PublicUser, RoomBrowserEntry, RoomDto, RoomMemberDto } from '@gp/shared'
import type { Room } from '../database/models/room.model'
import type { RoomMember } from '../database/models/room-member.model'

/** Builds the wire shape for a single member. `connection` is always
 * `'online'` here — this module has no socket knowledge, Task 15's gateway
 * overlays real presence (marking members `'disconnected'` when their
 * socket drops) on top of what this returns. */
export function toRoomMemberDto(
  member: RoomMember,
  user: PublicUser,
  hostId: string,
): RoomMemberDto {
  return {
    user,
    isHost: user.id === hostId,
    isReady: member.isReady,
    connection: 'online',
    joinedAt: member.joinedAt.toISOString(),
  }
}

export function toRoomDto(room: Room, members: RoomMemberDto[]): RoomDto {
  return {
    id: room.id,
    code: room.code,
    visibility: room.visibility,
    status: room.status,
    hostId: room.hostId,
    maxPlayers: room.maxPlayers,
    selectedGameId: (room.selectedGameId as GameId | null) ?? null,
    members,
    createdAt: room.createdAt.toISOString(),
  }
}

/** Row in the public room browser — deliberately built without member
 * identities: only the aggregate `playerCount` and the host's nickname. */
export function toRoomBrowserEntry(
  room: Room,
  hostNickname: string,
  playerCount: number,
): RoomBrowserEntry {
  return {
    id: room.id,
    code: room.code,
    status: room.status,
    selectedGameId: (room.selectedGameId as GameId | null) ?? null,
    playerCount,
    maxPlayers: room.maxPlayers,
    hostNickname,
    createdAt: room.createdAt.toISOString(),
  }
}
