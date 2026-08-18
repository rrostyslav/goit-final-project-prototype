import { type GameAction, getGameMeta, type PlayerId, type WordGameView } from '@gp/shared'
import type { ActionContext, Effect, GameDefinition, GameResultRow, InitContext } from '../contract'
import { InvalidActionError } from '../contract'
import {
  buildWordGameView,
  clampInt,
  createWordRound,
  currentRound,
  drawWord,
  finishWordTurn,
  finiteNumberOr,
  isWordGameOver,
  pauseWordTurn,
  requireExplainer,
  resumeWordTurn,
  scoreTeamAt,
  scoreWord,
  startRound,
  type WordRoundState,
  wordGameResults,
} from '../engines/word-engine'

/**
 * Crocodile reuses the word-engine round exactly as Alias/Hat do, with one
 * twist in how it is configured: `teamCount` is set to the player count, so
 * `createWordRound` (via `buildTeams`) hands out one single-member team per
 * player instead of grouping players into real teams. `WordGameView.teams`
 * is therefore already the desired per-player scoreboard - no separate
 * mapping code is needed.
 *
 * Turn/timer/view/ranking machinery (`requireExplainer`, `finishWordTurn`,
 * `buildWordGameView`, `wordGameResults`, the option clamp helpers) is
 * shared with Alias/Hat via word-engine.ts. What is genuinely Crocodile's
 * own rule is who a correct guess pays: unlike Alias/Hat, where a correct
 * guess only ever moves the active team's own score, Crocodile's explainer
 * must name a specific other player as the guesser (`word/correct`'s
 * optional `guesserId`, see @gp/shared's GameAction), and that player's
 * score is credited too via `scoreTeamAt` - the engine primitive that lets a
 * scoring event pay a team other than the active one, added for this game
 * (`scoreWord` always credits `state.activeTeamIndex`; a client cannot
 * claim credit for an arbitrary player because `word/correct` may only be
 * sent by the explainer, and `guesserId` is validated below against the
 * actual players in the round before anyone is scored).
 */
export interface CrocodileState {
  round: WordRoundState
  started: boolean
  finished: boolean
}

interface CrocodileOptions {
  totalRounds: number
  roundMs: number
}

const DEFAULT_OPTIONS: CrocodileOptions = { totalRounds: 3, roundMs: 60_000 }
const MIN_ROUND_MS = 5_000
const MAX_ROUND_MS = 600_000
/** A correct guess pays both participants this many points; a skip costs nobody anything. */
const POINTS = { correct: 1, skip: 0 }

/**
 * Reads `options` defensively, same rationale as Alias's `parseOptions`:
 * `InitContext.options` crosses a JSON boundary from Task 16 onward. There
 * is no `teamCount` option here - Crocodile's team count is always the
 * player count, not a configurable value.
 */
function parseOptions(options: Record<string, unknown>): CrocodileOptions {
  const totalRounds = Math.max(
    1,
    Math.floor(finiteNumberOr(options.totalRounds, DEFAULT_OPTIONS.totalRounds)),
  )
  const roundMs = clampInt(
    finiteNumberOr(options.roundMs, DEFAULT_OPTIONS.roundMs),
    MIN_ROUND_MS,
    MAX_ROUND_MS,
  )
  return { totalRounds, roundMs }
}

/**
 * Validates the `guesserId` the explainer sent with `word/correct`. Throws
 * `InvalidActionError` - never silently ignored or defaulted - for every way
 * the field can be wrong: absent, naming the explainer themself, or naming
 * someone not currently in the game. A client cannot credit an arbitrary
 * player by other means: this action may only be sent by the explainer
 * (`requireExplainer`, enforced by the caller before this runs), and the
 * guesser identity is only ever trusted after passing every check here.
 *
 * An assertion function rather than one returning a validated value so the
 * caller's own `guesserId` narrows from `PlayerId | undefined` to `PlayerId`
 * in place, with no second lookup needed to reuse it.
 */
function assertValidGuesser(
  round: WordRoundState,
  explainerId: PlayerId,
  guesserId: PlayerId | undefined,
): asserts guesserId is PlayerId {
  if (guesserId === undefined) {
    throw new InvalidActionError(
      'missing_guesser',
      'word/correct requires a guesserId naming who guessed the word',
    )
  }
  if (guesserId === explainerId) {
    throw new InvalidActionError(
      'guesser_is_explainer',
      'The explainer cannot be credited as the guesser',
    )
  }
  const isCurrentPlayer = round.teams.some((team) => team.memberIds.includes(guesserId))
  if (!isCurrentPlayer) {
    throw new InvalidActionError(
      'unknown_guesser',
      'guesserId must name a player currently in the game',
    )
  }
}

export const crocodileDefinition: GameDefinition<CrocodileState, GameAction> = {
  id: 'crocodile',
  meta: getGameMeta('crocodile'),

  init(ctx: InitContext): CrocodileState {
    const options = parseOptions(ctx.options)
    const teamCount = Math.max(1, ctx.players.length)
    const round = createWordRound(ctx.players, ctx.deck ?? [], {
      totalTurns: options.totalRounds * teamCount,
      teamCount,
      roundMs: options.roundMs,
    })
    return { round, started: false, finished: isWordGameOver(round) }
  },

  reduce(state: CrocodileState, action: GameAction, ctx: ActionContext): Effect<CrocodileState> {
    if (state.finished) {
      throw new InvalidActionError('game_finished', 'This game has already finished')
    }

    switch (action.type) {
      case 'word/start_round': {
        const explainer = requireExplainer(state.round, ctx)
        if (state.started) {
          throw new InvalidActionError('already_started', 'The round is already in progress')
        }
        const round = startRound(drawWord(state.round), ctx.now)
        return {
          state: { ...state, round, started: true },
          events: [{ type: 'round_started', round: currentRound(round), explainerId: explainer }],
          timers: [{ op: 'set', id: 'round', delayMs: state.round.roundMs }],
        }
      }

      case 'word/correct': {
        const explainer = requireExplainer(state.round, ctx)
        if (!state.started) {
          throw new InvalidActionError('round_not_started', 'Call word/start_round first')
        }
        if (state.round.currentWord === null) {
          throw new InvalidActionError('no_current_word', 'No word is currently in play')
        }
        const guesserId = action.guesserId
        assertValidGuesser(state.round, explainer, guesserId)
        // Crocodile's teamCount === players.length (see `init`), so every
        // player has their own single-member team - the guesser's team
        // index is just wherever their id turns up.
        const guesserIndex = state.round.teams.findIndex((team) =>
          team.memberIds.includes(guesserId),
        )

        // scoreWord credits the explainer's own (active) team and records the
        // roundResults entry for this word; scoreTeamAt then credits the
        // guesser's team directly, without touching roundResults again -
        // this is still one word, scored once, just paying two people.
        let round = scoreWord(state.round, true, POINTS)
        round = scoreTeamAt(round, guesserIndex, POINTS.correct)
        round = drawWord(round)

        return {
          state: { ...state, round },
          events: [
            { type: 'word_scored', playerId: explainer, guessed: true },
            { type: 'word_scored', playerId: guesserId, guessed: true },
          ],
        }
      }

      case 'word/skip': {
        const explainer = requireExplainer(state.round, ctx)
        if (!state.started) {
          throw new InvalidActionError('round_not_started', 'Call word/start_round first')
        }
        if (state.round.currentWord === null) {
          throw new InvalidActionError('no_current_word', 'No word is currently in play')
        }
        const round = drawWord(scoreWord(state.round, false, POINTS))
        return {
          state: { ...state, round },
          events: [{ type: 'word_scored', playerId: explainer, guessed: false }],
        }
      }

      case 'word/end_round': {
        requireExplainer(state.round, ctx)
        if (!state.started) {
          throw new InvalidActionError('round_not_started', 'The round has not started yet')
        }
        return finishWordTurn(state)
      }

      default:
        throw new InvalidActionError('unknown_action', `Unsupported action: ${action.type}`)
    }
  },

  onTimer(state: CrocodileState, timerId: string, _ctx: ActionContext): Effect<CrocodileState> {
    if (timerId !== 'round' || state.finished || !state.started) {
      return { state, events: [] }
    }
    return finishWordTurn(state)
  },

  view(state: CrocodileState, viewerId: PlayerId): WordGameView {
    return buildWordGameView(state, 'crocodile', viewerId)
  },

  pause(state: CrocodileState, now: number): Effect<CrocodileState> {
    return pauseWordTurn(state, now)
  },

  resume(state: CrocodileState, now: number): Effect<CrocodileState> {
    return resumeWordTurn(state, now)
  },

  /**
   * One player per team (see `init`), so this is plain standard competition
   * ranking (1, 1, 3, ...) by per-player score - see `wordGameResults` in
   * word-engine.ts for the full rationale.
   */
  results(state: CrocodileState): GameResultRow[] {
    return wordGameResults(state.round)
  },
}
