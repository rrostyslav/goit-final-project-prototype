import type { GameId } from '@gp/shared'
import { GAME_CATALOG } from '@gp/shared'
import { IsIn } from 'class-validator'

const GAME_IDS = GAME_CATALOG.map((game) => game.id)

export class SelectGameDto {
  @IsIn(GAME_IDS)
  gameId!: GameId
}
