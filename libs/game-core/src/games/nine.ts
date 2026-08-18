import {
  type Card,
  type CardGameView,
  type CardOpponentView,
  type GameAction,
  type GameEvent,
  type GamePhase,
  getGameMeta,
  type PlayerId,
  type Suit,
} from '@gp/shared'
import type { ActionContext, Effect, GameDefinition, GameResultRow, InitContext } from '../contract'
import { InvalidActionError } from '../contract'
import { buildDeck36, cardKey, dealHands, nextPlayer } from '../engines/card-engine'
import { createRng } from '../rng'

/**
 * Nine is a "Sevens"-style layout game built on card-engine: the whole
 * 36-card deck is dealt out (no draw pile - `dealHands` with
 * `perPlayer = ceil(36 / playerCount)` naturally stops the moment the deck
 * runs dry, so earlier players in turn order get one extra card when the
 * count doesn't divide evenly, exactly like a real deal). `layout` is the
 * tableau: every card played so far, as a flat array - see the report for
 * why a flat `Card[]` is enough to reconstruct each suit's contiguous run
 * (min/max rank per suit) without a richer shape. There is no trump, no
 * beat logic, and no refill: `beats`, `pickTrump`, and `refillHands` from
 * card-engine simply do not apply to this game, which is why they are not
 * imported here.
 */
export interface NineState {
  order: PlayerId[]
  hands: Record<PlayerId, Card[]>
  layout: Card[]
  turnPlayerId: PlayerId
  /** At most one entry: the player who emptied their hand first (the winner). Ends the game immediately. */
  finished: PlayerId[]
  phase: GamePhase
}

function handOf(hands: Record<PlayerId, Card[]>, playerId: PlayerId): Card[] {
  return hands[playerId] ?? []
}

function findCardIndex(hand: Card[], card: Card): number {
  const key = cardKey(card)
  return hand.findIndex((c) => cardKey(c) === key)
}

/** The contiguous [low, high] rank range currently on the table for `suit`, or null if that suit hasn't been opened yet. */
function suitBounds(layout: Card[], suit: Suit): { low: number; high: number } | null {
  const ranks = layout.filter((c) => c.suit === suit).map((c) => c.rank)
  if (ranks.length === 0) return null
  return { low: Math.min(...ranks), high: Math.max(...ranks) }
}

/**
 * True if `card` may legally be played onto `layout`: the very first play of
 * the game must be the nine of spades (no suit is open yet, so nothing else
 * qualifies); after that, any nine of a suit not yet opened is always legal
 * (it opens that suit's run), and any other card is legal only if it is
 * immediately adjacent to the low or high end of its own suit's existing
 * run.
 */
function isLegalPlay(layout: Card[], card: Card): boolean {
  if (layout.length === 0) {
    return card.suit === 'spades' && card.rank === 9
  }
  if (card.rank === 9) {
    return suitBounds(layout, card.suit) === null
  }
  const bounds = suitBounds(layout, card.suit)
  if (!bounds) return false
  return card.rank === bounds.low - 1 || card.rank === bounds.high + 1
}

function requireActivePlayer(state: NineState, actorId: PlayerId): void {
  if (!state.order.includes(actorId) || state.finished.includes(actorId)) {
    throw new InvalidActionError('not_a_player', `${actorId} is not an active player in this game`)
  }
}

function requireTurn(state: NineState, actorId: PlayerId): void {
  if (actorId !== state.turnPlayerId) {
    throw new InvalidActionError('not_your_turn', 'It is not your turn')
  }
}

function handlePlay(state: NineState, card: Card, ctx: ActionContext): Effect<NineState> {
  const actorId = ctx.actorId
  requireActivePlayer(state, actorId)
  requireTurn(state, actorId)

  const hand = handOf(state.hands, actorId)
  const cardIndex = findCardIndex(hand, card)
  if (cardIndex === -1) {
    throw new InvalidActionError('card_not_in_hand', 'That card is not in your hand')
  }
  if (!isLegalPlay(state.layout, card)) {
    throw new InvalidActionError(
      'illegal_play',
      'That card does not extend a run and is not an unplayed nine',
    )
  }

  const newHand = [...hand.slice(0, cardIndex), ...hand.slice(cardIndex + 1)]
  const hands = { ...state.hands, [actorId]: newHand }
  const layout = [...state.layout, card]
  const events: GameEvent[] = [{ type: 'card_played', playerId: actorId, card }]

  if (newHand.length === 0) {
    const finished = [...state.finished, actorId]
    events.push({ type: 'player_finished', playerId: actorId, placement: 1 })
    events.push({ type: 'game_finished' })
    return {
      state: { ...state, hands, layout, finished, phase: 'finished', turnPlayerId: actorId },
      events,
      finished: true,
    }
  }

  const turnPlayerId = nextPlayer(state.order, actorId, state.finished)
  return {
    state: { ...state, hands, layout, turnPlayerId },
    events,
  }
}

function handlePass(state: NineState, ctx: ActionContext): Effect<NineState> {
  const actorId = ctx.actorId
  requireActivePlayer(state, actorId)
  requireTurn(state, actorId)

  const hand = handOf(state.hands, actorId)
  if (hand.some((card) => isLegalPlay(state.layout, card))) {
    throw new InvalidActionError('legal_move_available', 'You have a legal move and may not pass')
  }

  const turnPlayerId = nextPlayer(state.order, actorId, state.finished)
  return { state: { ...state, turnPlayerId }, events: [] }
}

function toOpponentView(state: NineState, playerId: PlayerId): CardOpponentView {
  return {
    playerId,
    cardCount: handOf(state.hands, playerId).length,
    finished: state.finished.includes(playerId),
  }
}

export const nineDefinition: GameDefinition<NineState, GameAction> = {
  id: 'nine',
  meta: getGameMeta('nine'),

  init(ctx: InitContext): NineState {
    const rng = createRng(ctx.seed)
    const shuffled = rng.shuffle(buildDeck36())
    const perPlayer = Math.ceil(shuffled.length / Math.max(1, ctx.players.length))
    const { hands } = dealHands(shuffled, ctx.players, perPlayer)

    const opener = ctx.players.find((playerId) =>
      handOf(hands, playerId).some((card) => card.suit === 'spades' && card.rank === 9),
    )
    if (opener === undefined) {
      throw new Error('nine requires the nine of spades to be dealt to some player')
    }

    return {
      order: [...ctx.players],
      hands,
      layout: [],
      turnPlayerId: opener,
      finished: [],
      phase: 'active',
    }
  },

  reduce(state: NineState, action: GameAction, ctx: ActionContext): Effect<NineState> {
    if (state.phase === 'finished') {
      throw new InvalidActionError('game_finished', 'This game has already finished')
    }

    switch (action.type) {
      case 'nine/play':
        return handlePlay(state, action.card, ctx)
      case 'nine/pass':
        return handlePass(state, ctx)
      default:
        throw new InvalidActionError('unknown_action', `Unsupported action: ${action.type}`)
    }
  },

  onTimer(state: NineState, _timerId: string, _ctx: ActionContext): Effect<NineState> {
    // Nine has no clocked phases (unlike Alias' round timer): nothing to do.
    return { state, events: [] }
  },

  view(state: NineState, viewerId: PlayerId): CardGameView {
    const finished = state.phase === 'finished'
    return {
      kind: 'card',
      gameId: 'nine',
      phase: state.phase,
      hand: [...handOf(state.hands, viewerId)],
      opponents: state.order.filter((p) => p !== viewerId).map((p) => toOpponentView(state, p)),
      table: [],
      layout: [...state.layout],
      trump: null,
      deckCount: 0,
      turnPlayerId: finished ? null : state.turnPlayerId,
      defenderId: null,
      placements: [...state.finished],
    }
  },

  /**
   * The player who emptied their hand (`state.finished`, at most one entry)
   * always takes placement 1 automatically, since nobody else can have
   * fewer than their 0 cards left; everyone else is ranked by cards
   * remaining, fewest first, with standard competition ranking for ties.
   * `score` mirrors Durak's convention for a game with no real point total:
   * it is derived purely from placement (higher is better), not a count of
   * anything.
   */
  results(state: NineState): GameResultRow[] {
    const total = state.order.length
    const rows = state.order.map((playerId) => ({
      playerId,
      cardsLeft: handOf(state.hands, playerId).length,
    }))
    return rows
      .map((row) => {
        const placement = 1 + rows.filter((other) => other.cardsLeft < row.cardsLeft).length
        return { playerId: row.playerId, score: total - placement + 1, placement }
      })
      .sort((a, b) => a.placement - b.placement)
  },
}
