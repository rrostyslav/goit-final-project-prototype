import { type GameAction, type GameMeta, getGameMeta, type WordGameView } from '@gp/shared'
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
  requireExplainer,
  scoreWord,
  startRound,
  type WordRoundState,
  wordGameResults,
} from '../engines/word-engine'

/**
 * Shared state for both Alias and Hat - the two games are the same word-engine
 * round wrapped in the same rules, differing only in the points a skip is
 * worth (see `createAliasDefinition`). `started` tracks whether the *current*
 * turn's clock has been kicked off (word/start_round called, a word drawn);
 * it resets to false every time a turn ends so the next explainer must start
 * their own turn explicitly. `finished` is true once the underlying
 * WordRoundState has used up its totalTurns budget.
 */
export interface AliasState {
  round: WordRoundState
  mode: 'alias' | 'hat'
  started: boolean
  finished: boolean
}

interface AliasOptions {
  totalRounds: number
  roundMs: number
  teamCount: number
}

const DEFAULT_OPTIONS: AliasOptions = { totalRounds: 4, roundMs: 60_000, teamCount: 2 }

/** teamCount is never allowed below this - a "team game" with one team isn't one. */
const MIN_TEAM_COUNT = 2
/** roundMs sane band: at least 5s (a round that ends before anyone can act is pointless)
 *  and at most 10 minutes (a runaway value should not be able to wedge a turn open forever). */
const MIN_ROUND_MS = 5_000
const MAX_ROUND_MS = 600_000

/**
 * Reads `options` defensively: InitContext.options is `Record<string, unknown>`
 * (it crosses a JSON boundary from Task 16 onward), so each field is checked
 * for its expected type before use rather than trusted or cast.
 *
 * `teamCount` is additionally clamped against `playerCount`: `buildTeams`
 * deals players round-robin, so a `teamCount` that outruns the player count
 * leaves some teams empty, and an empty active team means `currentExplainer`
 * returns null and every action permanently throws `not_explainer` - a
 * soft-lock with no recovery path. The rule applied here: every team needs
 * at least one member, and a team-based word game needs at least two members
 * per team to be meaningful (someone to explain, someone to guess), so
 * `teamCount` is capped at `Math.floor(playerCount / 2)`. It is never let
 * below `MIN_TEAM_COUNT` (2) either, even if that cap would otherwise dip
 * under it (a `playerCount` below this game's own catalog `minPlayers` of 4
 * should not happen via the normal room/lobby flow, but `options` - unlike
 * `players` - arrives already untrusted, so the floor stays absolute rather
 * than silently going below "two teams").
 */
function parseOptions(options: Record<string, unknown>, playerCount: number): AliasOptions {
  const totalRounds = Math.max(
    1,
    Math.floor(finiteNumberOr(options.totalRounds, DEFAULT_OPTIONS.totalRounds)),
  )

  const roundMs = clampInt(
    finiteNumberOr(options.roundMs, DEFAULT_OPTIONS.roundMs),
    MIN_ROUND_MS,
    MAX_ROUND_MS,
  )

  const maxTeamCount = Math.max(MIN_TEAM_COUNT, Math.floor(playerCount / 2))
  const teamCount = clampInt(
    finiteNumberOr(options.teamCount, DEFAULT_OPTIONS.teamCount),
    MIN_TEAM_COUNT,
    maxTeamCount,
  )

  return { totalRounds, roundMs, teamCount }
}

/**
 * Builds the Alias/Hat game definition. Both games are the same word-engine
 * round; they differ only in what a skip is worth (`pointsForSkip`) and their
 * catalog metadata (titleKey etc, read from @gp/shared's GAME_CATALOG so it
 * stays the single source of truth for player-facing copy).
 */
export function createAliasDefinition(
  mode: 'alias' | 'hat',
): GameDefinition<AliasState, GameAction> {
  const points = { correct: 1, skip: mode === 'alias' ? -1 : 0 }
  const meta: GameMeta = getGameMeta(mode)

  return {
    id: mode,
    meta,

    init(ctx: InitContext): AliasState {
      const options = parseOptions(ctx.options, ctx.players.length)
      const round = createWordRound(ctx.players, ctx.deck ?? [], {
        totalTurns: options.totalRounds * options.teamCount,
        teamCount: options.teamCount,
        roundMs: options.roundMs,
      })
      // Settle `finished` from whatever totalTurns actually came out to,
      // rather than assuming init always yields a playable game. parseOptions
      // clamps totalRounds to at least 1, so this is normally false, but the
      // invariant ("finished reflects isWordGameOver") should hold regardless
      // of how options arrive rather than relying on that clamp alone.
      return { round, mode, started: false, finished: isWordGameOver(round) }
    },

    reduce(state: AliasState, action: GameAction, ctx: ActionContext): Effect<AliasState> {
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

        case 'word/correct':
        case 'word/skip': {
          const explainer = requireExplainer(state.round, ctx)
          if (!state.started) {
            throw new InvalidActionError('round_not_started', 'Call word/start_round first')
          }
          if (state.round.currentWord === null) {
            throw new InvalidActionError('no_current_word', 'No word is currently in play')
          }
          const guessed = action.type === 'word/correct'
          const round = drawWord(scoreWord(state.round, guessed, points))
          return {
            state: { ...state, round },
            events: [{ type: 'word_scored', playerId: explainer, guessed }],
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

    onTimer(state: AliasState, timerId: string, _ctx: ActionContext): Effect<AliasState> {
      // A timer for a different id, or one that fires after the turn was
      // already ended manually (word/end_round beat the clock), is a no-op:
      // acting on it again would double-advance the turn.
      if (timerId !== 'round' || state.finished || !state.started) {
        return { state, events: [] }
      }
      return finishWordTurn(state)
    },

    view(state: AliasState, viewerId): WordGameView {
      return buildWordGameView(state, mode, viewerId)
    },

    /**
     * Ranks teams by score (standard competition ranking) and expands every
     * member into a `GameResultRow` inheriting that team's score and
     * placement - see `wordGameResults` in word-engine.ts for the full
     * rationale.
     */
    results(state: AliasState): GameResultRow[] {
      return wordGameResults(state.round)
    },
  }
}

export const aliasDefinition = createAliasDefinition('alias')
export const hatDefinition = createAliasDefinition('hat')
