import {
  type Card,
  type CardGameView,
  type CardOpponentView,
  type GameAction,
  type GameEvent,
  type GamePhase,
  getGameMeta,
  type PlayerId,
  type Rank,
  type Suit,
} from '@gp/shared'
import type { ActionContext, Effect, GameDefinition, GameResultRow, InitContext } from '../contract'
import { InvalidActionError } from '../contract'
import {
  beats,
  buildDeck36,
  cardKey,
  dealHands,
  nextPlayer,
  pickTrump,
  refillHands,
} from '../engines/card-engine'
import { createRng } from '../rng'

/** One card on the table: the attack it answers, and the card that beat it (or null if still open). */
export interface DurakTableEntry {
  attack: Card
  defend: Card | null
}

/**
 * Full Durak game state. Matches the shape from the task brief (order, hands,
 * deck, trump, table, attackerId, defenderId, discard, finished, phase) plus
 * one internal bookkeeping field, `passed`: the set of attacking players
 * (i.e. everyone except the defender) who have already declared "nothing
 * more to add" for the *current* bout. It resets to `[]` every time a new
 * card lands on the table (attack or defend), because a newly-landed card
 * can make a rank available to a player who couldn't add anything before -
 * see the "podkidnoy" note in the report. A bout only closes when every
 * eligible attacker is in `passed` *and* every table entry is defended.
 */
export interface DurakState {
  order: PlayerId[]
  hands: Record<PlayerId, Card[]>
  deck: Card[]
  trump: Card | null
  table: DurakTableEntry[]
  attackerId: PlayerId
  defenderId: PlayerId
  discard: Card[]
  finished: PlayerId[]
  phase: GamePhase
  passed: PlayerId[]
}

const HAND_SIZE = 6
/** Classic podkidnoy cap: never more than 6 attack cards in one bout. */
const MAX_ATTACKS = 6

function handOf(hands: Record<PlayerId, Card[]>, playerId: PlayerId): Card[] {
  return hands[playerId] ?? []
}

function findCardIndex(hand: Card[], card: Card): number {
  const key = cardKey(card)
  return hand.findIndex((c) => cardKey(c) === key)
}

/** Every rank currently physically on the table, attack side and defend side alike. */
function ranksOnTable(table: DurakTableEntry[]): Set<Rank> {
  const ranks = new Set<Rank>()
  for (const entry of table) {
    ranks.add(entry.attack.rank)
    if (entry.defend) ranks.add(entry.defend.rank)
  }
  return ranks
}

/**
 * The maximum number of attack cards allowed in the current bout: at most
 * MAX_ATTACKS (6), and never more than the defender held at the moment the
 * bout began. That starting hand size isn't stored anywhere - it's derived
 * as (defender's current hand) + (cards they've already used to defend this
 * bout), which is invariant across the whole bout because every successful
 * defend moves exactly one card out of the first pile and into the second.
 */
function maxAttacksAllowed(state: DurakState): number {
  const defenderHand = handOf(state.hands, state.defenderId).length
  const alreadyDefended = state.table.filter((entry) => entry.defend !== null).length
  return Math.min(MAX_ATTACKS, defenderHand + alreadyDefended)
}

function eligibleAttackers(state: DurakState): PlayerId[] {
  return state.order.filter((p) => p !== state.defenderId && !state.finished.includes(p))
}

function requireActivePlayer(state: DurakState, actorId: PlayerId): void {
  if (!state.order.includes(actorId) || state.finished.includes(actorId)) {
    throw new InvalidActionError('not_a_player', `${actorId} is not an active player in this game`)
  }
}

/** Rotates `order` to start at `startId`, then drops anyone already finished. */
function rotateFrom(order: PlayerId[], startId: PlayerId, finished: PlayerId[]): PlayerId[] {
  const index = order.indexOf(startId)
  const rotated = index === -1 ? [...order] : [...order.slice(index), ...order.slice(0, index)]
  return rotated.filter((p) => !finished.includes(p))
}

/**
 * The player holding the lowest-ranked card of `trumpSuit`, across every
 * hand - the classic Durak opening-attacker rule. Returns null if nobody
 * holds a trump (including the trump-less edge case where `trumpSuit` itself
 * is null, e.g. a deal that used every card and left none to reveal).
 */
function findLowestTrumpHolder(
  hands: Record<PlayerId, Card[]>,
  order: PlayerId[],
  trumpSuit: Suit | null,
): PlayerId | null {
  if (trumpSuit === null) return null
  let best: { playerId: PlayerId; rank: Rank } | null = null
  for (const playerId of order) {
    for (const card of handOf(hands, playerId)) {
      if (card.suit === trumpSuit && (best === null || card.rank < best.rank)) {
        best = { playerId, rank: card.rank }
      }
    }
  }
  return best?.playerId ?? null
}

interface BoutResolution {
  hands: Record<PlayerId, Card[]>
  deck: Card[]
  finished: PlayerId[]
  attackerId: PlayerId
  defenderId: PlayerId
  phase: GamePhase
  events: GameEvent[]
  gameFinished: boolean
}

/**
 * Shared tail end of both `card/pass` (once every attacker has passed on a
 * fully-defended table) and `card/take`: refills hands, works out who just
 * ran out of cards, checks for a lone survivor (the durak), and rotates
 * attacker/defender for the next bout. `handsAfterTableMove` already has the
 * table's cards folded in (or not, for a pass, where they went to discard
 * instead) - this function only adds the refill on top.
 *
 * Rotation: on a successful pass, the old defender becomes the new attacker
 * (roles swap) and the next player after them defends. On a take, the player
 * *after* the old defender becomes the new attacker (the taking defender is
 * skipped for a turn) and the player after that defends - which collapses to
 * "the same attacker goes again, same defender" in a 2-player game.
 */
function finalizeBout(
  state: DurakState,
  mode: 'pass' | 'take',
  handsAfterTableMove: Record<PlayerId, Card[]>,
): BoutResolution {
  const oldAttackerId = state.attackerId
  const oldDefenderId = state.defenderId

  // "Hands refill to 6 in turn order starting from the attacker" - the
  // attacker of the bout that just ended, regardless of pass vs take.
  const refillOrder = rotateFrom(state.order, oldAttackerId, state.finished)
  const { hands: refilledHands, deck } = refillHands(
    handsAfterTableMove,
    state.deck,
    refillOrder,
    HAND_SIZE,
  )

  let finished = [...state.finished]
  const events: GameEvent[] = []
  for (const playerId of refillOrder) {
    const hand = refilledHands[playerId] ?? []
    if (hand.length === 0 && deck.length === 0 && !finished.includes(playerId)) {
      finished = [...finished, playerId]
      events.push({ type: 'player_finished', playerId, placement: finished.length })
    }
  }

  let phase: GamePhase = 'active'
  let gameFinished = false
  const remaining = state.order.filter((p) => !finished.includes(p))
  if (remaining.length <= 1) {
    for (const playerId of remaining) {
      finished = [...finished, playerId]
      events.push({ type: 'player_finished', playerId, placement: finished.length })
    }
    phase = 'finished'
    gameFinished = true
    events.push({ type: 'game_finished' })
  }

  let attackerId = oldAttackerId
  let defenderId = oldDefenderId
  if (!gameFinished) {
    // On a pass, the old defender becomes the new attacker - but only if
    // they're still in the game. The refill loop above can finish the old
    // defender in this very call (ran out of cards with an empty deck), in
    // which case rotation must skip past them exactly like the 'take'
    // branch already does, or attackerId ends up pointing at a finished
    // player while phase stays 'active' - a full deadlock (see regression
    // test).
    attackerId =
      mode === 'pass' && !finished.includes(oldDefenderId)
        ? oldDefenderId
        : nextPlayer(state.order, oldDefenderId, finished)
    defenderId = nextPlayer(state.order, attackerId, finished)
  }

  return {
    hands: refilledHands,
    deck,
    finished,
    attackerId,
    defenderId,
    phase,
    events,
    gameFinished,
  }
}

function handleAttack(state: DurakState, card: Card, ctx: ActionContext): Effect<DurakState> {
  const actorId = ctx.actorId
  requireActivePlayer(state, actorId)
  if (actorId === state.defenderId) {
    throw new InvalidActionError('defender_cannot_attack', 'The defender may not attack')
  }

  const hand = handOf(state.hands, actorId)
  const cardIndex = findCardIndex(hand, card)
  if (cardIndex === -1) {
    throw new InvalidActionError('card_not_in_hand', 'That card is not in your hand')
  }

  if (state.table.length === 0) {
    if (actorId !== state.attackerId) {
      throw new InvalidActionError('not_attacker', 'Only the attacker may open a bout')
    }
  } else {
    const ranks = ranksOnTable(state.table)
    if (!ranks.has(card.rank)) {
      throw new InvalidActionError('rank_not_on_table', 'That rank is not yet on the table')
    }
  }

  if (state.table.length >= maxAttacksAllowed(state)) {
    throw new InvalidActionError('attack_limit_reached', 'No more cards may be added to this bout')
  }

  const newHand = [...hand.slice(0, cardIndex), ...hand.slice(cardIndex + 1)]
  const newTable: DurakTableEntry[] = [...state.table, { attack: card, defend: null }]

  return {
    state: {
      ...state,
      hands: { ...state.hands, [actorId]: newHand },
      table: newTable,
      // A new card can open up a rank that a previously-passed attacker
      // couldn't act on before - give everyone a fresh chance.
      passed: [],
    },
    events: [{ type: 'card_played', playerId: actorId, card }],
  }
}

function handleDefend(
  state: DurakState,
  card: Card,
  against: Card,
  ctx: ActionContext,
): Effect<DurakState> {
  const actorId = ctx.actorId
  if (actorId !== state.defenderId) {
    throw new InvalidActionError('not_defender', 'Only the defender may defend')
  }

  const againstKey = cardKey(against)
  const entryIndex = state.table.findIndex(
    (entry) => entry.defend === null && cardKey(entry.attack) === againstKey,
  )
  if (entryIndex === -1) {
    throw new InvalidActionError('no_such_attack', 'No matching undefended attack on the table')
  }
  const entry = state.table[entryIndex]
  if (!entry) {
    throw new InvalidActionError('no_such_attack', 'No matching undefended attack on the table')
  }

  const hand = handOf(state.hands, actorId)
  const cardIndex = findCardIndex(hand, card)
  if (cardIndex === -1) {
    throw new InvalidActionError('card_not_in_hand', 'That card is not in your hand')
  }

  const trumpSuit = state.trump?.suit ?? null
  if (!beats(entry.attack, card, trumpSuit)) {
    throw new InvalidActionError('does_not_beat', 'That card does not beat the attack')
  }

  const newHand = [...hand.slice(0, cardIndex), ...hand.slice(cardIndex + 1)]
  const newTable = [...state.table]
  newTable[entryIndex] = { attack: entry.attack, defend: card }

  return {
    state: {
      ...state,
      hands: { ...state.hands, [actorId]: newHand },
      table: newTable,
      passed: [],
    },
    events: [{ type: 'card_played', playerId: actorId, card }],
  }
}

function handleTake(state: DurakState, ctx: ActionContext): Effect<DurakState> {
  const actorId = ctx.actorId
  if (actorId !== state.defenderId) {
    throw new InvalidActionError('not_defender', 'Only the defender may take')
  }
  if (state.table.length === 0) {
    throw new InvalidActionError('table_empty', 'There is nothing to take')
  }

  const collected = state.table.flatMap((entry) =>
    entry.defend ? [entry.attack, entry.defend] : [entry.attack],
  )
  const handsAfterTableMove = {
    ...state.hands,
    [actorId]: [...handOf(state.hands, actorId), ...collected],
  }

  const resolution = finalizeBout(state, 'take', handsAfterTableMove)

  return {
    state: {
      ...state,
      hands: resolution.hands,
      deck: resolution.deck,
      table: [],
      attackerId: resolution.attackerId,
      defenderId: resolution.defenderId,
      finished: resolution.finished,
      phase: resolution.phase,
      passed: [],
    },
    events: [
      { type: 'cards_taken', playerId: actorId, count: collected.length },
      ...resolution.events,
    ],
    finished: resolution.gameFinished,
  }
}

function handlePass(state: DurakState, ctx: ActionContext): Effect<DurakState> {
  const actorId = ctx.actorId
  requireActivePlayer(state, actorId)
  if (actorId === state.defenderId) {
    throw new InvalidActionError(
      'defender_cannot_pass',
      'The defender must defend or take, not pass',
    )
  }
  if (state.table.length === 0) {
    throw new InvalidActionError('table_empty', 'Nothing has been attacked yet')
  }
  if (state.passed.includes(actorId)) {
    throw new InvalidActionError('already_passed', 'You have already passed this bout')
  }

  const newPassed = [...state.passed, actorId]
  const allDefended = state.table.every((entry) => entry.defend !== null)
  const allPassed = eligibleAttackers(state).every((p) => newPassed.includes(p))

  if (!(allDefended && allPassed)) {
    return { state: { ...state, passed: newPassed }, events: [] }
  }

  const discard = [
    ...state.discard,
    ...state.table.flatMap((entry) =>
      entry.defend ? [entry.attack, entry.defend] : [entry.attack],
    ),
  ]
  const resolution = finalizeBout(state, 'pass', state.hands)

  return {
    state: {
      ...state,
      hands: resolution.hands,
      deck: resolution.deck,
      table: [],
      discard,
      attackerId: resolution.attackerId,
      defenderId: resolution.defenderId,
      finished: resolution.finished,
      phase: resolution.phase,
      passed: [],
    },
    events: resolution.events,
    finished: resolution.gameFinished,
  }
}

function toOpponentView(state: DurakState, playerId: PlayerId): CardOpponentView {
  return {
    playerId,
    cardCount: handOf(state.hands, playerId).length,
    finished: state.finished.includes(playerId),
  }
}

export const durakDefinition: GameDefinition<DurakState, GameAction> = {
  id: 'durak',
  meta: getGameMeta('durak'),

  init(ctx: InitContext): DurakState {
    const rng = createRng(ctx.seed)
    const shuffled = rng.shuffle(buildDeck36())
    const { hands, rest } = dealHands(shuffled, ctx.players, HAND_SIZE)
    const { trump, rest: deck } = pickTrump(rest)
    const trumpSuit = trump?.suit ?? null

    const firstPlayer = ctx.players[0]
    if (firstPlayer === undefined) {
      throw new Error('durak requires at least one player')
    }
    const attackerId = findLowestTrumpHolder(hands, ctx.players, trumpSuit) ?? firstPlayer
    const defenderId = nextPlayer(ctx.players, attackerId, [])

    return {
      order: [...ctx.players],
      hands,
      deck,
      trump,
      table: [],
      attackerId,
      defenderId,
      discard: [],
      finished: [],
      phase: 'active',
      passed: [],
    }
  },

  reduce(state: DurakState, action: GameAction, ctx: ActionContext): Effect<DurakState> {
    if (state.phase === 'finished') {
      throw new InvalidActionError('game_finished', 'This game has already finished')
    }

    switch (action.type) {
      case 'card/attack':
        return handleAttack(state, action.card, ctx)
      case 'card/defend':
        return handleDefend(state, action.card, action.against, ctx)
      case 'card/take':
        return handleTake(state, ctx)
      case 'card/pass':
        return handlePass(state, ctx)
      default:
        throw new InvalidActionError('unknown_action', `Unsupported action: ${action.type}`)
    }
  },

  onTimer(state: DurakState, _timerId: string, _ctx: ActionContext): Effect<DurakState> {
    // Durak has no clocked phases (unlike Alias' round timer): nothing to do.
    return { state, events: [] }
  },

  view(state: DurakState, viewerId: PlayerId): CardGameView {
    const finished = state.phase === 'finished'
    return {
      kind: 'card',
      gameId: 'durak',
      phase: state.phase,
      hand: [...handOf(state.hands, viewerId)],
      opponents: state.order.filter((p) => p !== viewerId).map((p) => toOpponentView(state, p)),
      table: state.table.map((entry) => ({ attack: entry.attack, defend: entry.defend })),
      layout: [],
      trump: state.trump,
      deckCount: state.deck.length,
      turnPlayerId: finished ? null : state.attackerId,
      defenderId: finished ? null : state.defenderId,
      placements: [...state.finished],
    }
  },

  /**
   * One row per player who has finished so far, best placement first. A
   * player still holding cards (game in progress) has no row yet - callers
   * are expected to read this once `phase` is 'finished', at which point
   * every player has been placed (the durak included, last).
   */
  results(state: DurakState): GameResultRow[] {
    const total = state.order.length
    return state.finished.map((playerId, index) => {
      const placement = index + 1
      return { playerId, score: total - placement + 1, placement }
    })
  },
}
