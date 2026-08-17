import type { GameId, RoomVisibility } from '@gp/shared'
import { GAME_CATALOG, ROOM_MAX_PLAYERS, ROOM_MIN_PLAYERS } from '@gp/shared'
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator'

const GAME_IDS = GAME_CATALOG.map((game) => game.id)

export class CreateRoomDto {
  @IsIn(['public', 'private'] satisfies RoomVisibility[])
  visibility!: RoomVisibility

  @IsInt()
  @Min(ROOM_MIN_PLAYERS)
  @Max(ROOM_MAX_PLAYERS)
  maxPlayers!: number

  @IsOptional()
  @IsIn(GAME_IDS)
  gameId?: GameId
}
