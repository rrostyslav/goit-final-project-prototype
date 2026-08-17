export type GameId = 'alias' | 'hat' | 'crocodile' | 'durak' | 'nine'
export type EngineId = 'word' | 'card'

export interface GameMeta {
  id: GameId
  engine: EngineId
  titleKey: string
  minPlayers: number
  maxPlayers: number
  teamBased: boolean
}

export const GAME_CATALOG: readonly GameMeta[] = [
  {
    id: 'alias',
    engine: 'word',
    titleKey: 'game.alias',
    minPlayers: 4,
    maxPlayers: 10,
    teamBased: true,
  },
  {
    id: 'hat',
    engine: 'word',
    titleKey: 'game.hat',
    minPlayers: 4,
    maxPlayers: 10,
    teamBased: true,
  },
  {
    id: 'crocodile',
    engine: 'word',
    titleKey: 'game.crocodile',
    minPlayers: 3,
    maxPlayers: 10,
    teamBased: false,
  },
  {
    id: 'durak',
    engine: 'card',
    titleKey: 'game.durak',
    minPlayers: 2,
    maxPlayers: 6,
    teamBased: false,
  },
  {
    id: 'nine',
    engine: 'card',
    titleKey: 'game.nine',
    minPlayers: 2,
    maxPlayers: 6,
    teamBased: false,
  },
]

export function getGameMeta(id: GameId): GameMeta {
  const meta = GAME_CATALOG.find((g) => g.id === id)
  if (!meta) throw new Error(`Unknown game: ${id}`)
  return meta
}
