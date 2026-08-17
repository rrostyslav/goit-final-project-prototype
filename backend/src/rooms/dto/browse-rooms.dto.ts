import type { GameId } from '@gp/shared'
import { GAME_CATALOG } from '@gp/shared'
import { Transform } from 'class-transformer'
import { IsBoolean, IsIn, IsInt, IsOptional, Max, Min } from 'class-validator'

const GAME_IDS = GAME_CATALOG.map((game) => game.id)

export class BrowseRoomsDto {
  @IsOptional()
  @IsIn(GAME_IDS)
  gameId?: GameId

  // Query params arrive as strings — normalize "true"/"false" explicitly
  // rather than relying on `Boolean(value)`, which treats the string
  // "false" as truthy.
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  hasFreeSlots?: boolean

  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number

  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(0)
  offset?: number
}
