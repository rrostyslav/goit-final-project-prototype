import type { PlayerId } from './domain'
import type { GameId } from './games'

export type Suit = 'spades' | 'hearts' | 'diamonds' | 'clubs'
export type Rank = 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14
export interface Card {
  suit: Suit
  rank: Rank
}

export type GamePhase = 'preparing' | 'active' | 'between_rounds' | 'finished'

export interface TeamView {
  id: string
  name: string
  memberIds: PlayerId[]
  score: number
}

export interface WordGameView {
  kind: 'word'
  gameId: Extract<GameId, 'alias' | 'hat' | 'crocodile'>
  phase: GamePhase
  round: number
  totalRounds: number
  teams: TeamView[]
  activeTeamId: string | null
  explainerId: PlayerId | null
  /** Present only for the explainer. Everyone else receives null. */
  secretWord: string | null
  roundEndsAt: number | null
  roundPaused: boolean
  lastResults: { word: string; guessed: boolean }[]
  winnerTeamIds: string[]
}

export interface CardOpponentView {
  playerId: PlayerId
  cardCount: number
  finished: boolean
}

export interface CardGameView {
  kind: 'card'
  gameId: Extract<GameId, 'durak' | 'nine'>
  phase: GamePhase
  /** Only the viewer's own cards. */
  hand: Card[]
  opponents: CardOpponentView[]
  table: { attack: Card; defend: Card | null }[]
  layout: Card[]
  trump: Card | null
  deckCount: number
  turnPlayerId: PlayerId | null
  defenderId: PlayerId | null
  placements: PlayerId[]
}

export type PlayerView = WordGameView | CardGameView

export type GameAction =
  | { type: 'word/start_round' }
  | { type: 'word/correct' }
  | { type: 'word/skip' }
  | { type: 'word/end_round' }
  | { type: 'card/attack'; card: Card }
  | { type: 'card/defend'; card: Card; against: Card }
  | { type: 'card/take' }
  | { type: 'card/pass' }
  | { type: 'nine/play'; card: Card }
  | { type: 'nine/pass' }

export type GameEvent =
  | { type: 'round_started'; round: number; explainerId: PlayerId }
  | { type: 'word_scored'; playerId: PlayerId; guessed: boolean }
  | { type: 'round_ended'; round: number }
  | { type: 'card_played'; playerId: PlayerId; card: Card }
  | { type: 'cards_taken'; playerId: PlayerId; count: number }
  | { type: 'player_finished'; playerId: PlayerId; placement: number }
  | { type: 'game_finished' }

export interface DrawStroke {
  points: [number, number][]
  color: string
  width: number
}
