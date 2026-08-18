import {
  type GameAction,
  type GameEvent,
  getGameMeta,
  type PlayerId,
  type WordGameView,
} from '@gp/shared'
import type { ActionContext, Effect, GameDefinition, GameResultRow, InitContext } from '../contract'
import { InvalidActionError } from '../contract'
import {
  advanceTurn,
  createWordRound,
  currentExplainer,
  currentRound,
  drawWord,
  isWordGameOver,
  resultsForTurn,
  scoreTeamAt,
  scoreWord,
  startRound,
  type WordRoundState,
} from '../engines/word-engine'

/**
 * Crocodile reuses the word-engine round exactly as Alias/Hat do, with one
 * twist in how it is configured: `teamCount` is set to the player count, so
 * `createWordRound` (via `buildTeams`) hands out one single-member team per
 * player instead of grouping players into real teams. `WordGameView.teams`
 * is therefore already the desired per-player scoreboard - no separate
 * mapping code is needed, see the report for why this is the chosen
 * resolution.
 *
 * `guesserOffset` is the one thing word-engine has no notion of: unlike
 * Alias/Hat, where a correct guess only ever moves the active team's own
 * score, Crocodile's correct guess pays *two* participants - the explainer
 * (the active team, scored the usual way via `scoreWord`) and whichever
 * other player is credited with the guess (a different team, scored via the
 * new `scoreTeamAt` engine primitive - see word-engine.ts). `currentWord`
 * being explainer-only is unchanged; the guess-crediting logic below is the
 * only genuinely new rule this game adds on top of the engine.
 */
export interface CrocodileState {
  round: WordRoundState
  /**
   * How many teams forward of the active (explaining) team the *next*
   * correct guess should credit, 1-based and reset to 1 every time a turn
   * ends (see `finishTurn`). Advancing it by 1 after every correct guess
   * means a single turn's credit rotates through every other player exactly
   * once before repeating - see `currentGuesserIndex`.
   */
  guesserOffset: number
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

function clampInt(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.floor(value)))
}

function finiteNumberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

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

/** Throws unless `ctx.actorId` is the player currently explaining; otherwise returns that id. */
function requireExplainer(state: CrocodileState, ctx: ActionContext): PlayerId {
  const explainer = currentExplainer(state.round)
  if (explainer === null || explainer !== ctx.actorId) {
    throw new InvalidActionError(
      'not_explainer',
      'Only the current explainer may perform this action',
    )
  }
  return explainer
}

/**
 * The team index to credit with the *next* correct guess. The active team
 * (the explainer) is never eligible - a correct guess always pays someone
 * else - so this walks `guesserOffset` teams forward from it, wrapping
 * within the `teamCount - 1` non-explainer teams. Returns null only if there
 * are fewer than two teams (not reachable through the normal room/lobby
 * flow, which enforces this game's catalog `minPlayers: 3`, but guarded
 * anyway rather than dividing by zero).
 */
function currentGuesserIndex(state: CrocodileState): number | null {
  const teamCount = state.round.teams.length
  if (teamCount < 2) return null
  const span = teamCount - 1
  const offset = ((state.guesserOffset - 1) % span) + 1
  return (state.round.activeTeamIndex + offset) % teamCount
}

/**
 * Core "a turn is over" transition - identical in shape to Alias's
 * `finishTurn` (advance the word-engine turn, clear the stale word/deadline,
 * flip `finished` once the turn budget is used up) plus resetting
 * `guesserOffset` back to 1, so the next explainer's turn always starts
 * crediting the very next player in line.
 */
function finishTurn(state: CrocodileState): Effect<CrocodileState> {
  const endedRound = currentRound(state.round)
  const advanced = advanceTurn(state.round)
  const nextRound: WordRoundState = { ...advanced, currentWord: null, roundEndsAt: null }
  const finished = isWordGameOver(nextRound)
  const events: GameEvent[] = [{ type: 'round_ended', round: endedRound }]
  if (finished) {
    events.push({ type: 'game_finished' })
  }
  return {
    state: { ...state, round: nextRound, guesserOffset: 1, started: false, finished },
    events,
    timers: [{ op: 'clear', id: 'round' }],
    finished,
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
    return { round, guesserOffset: 1, started: false, finished: isWordGameOver(round) }
  },

  reduce(state: CrocodileState, action: GameAction, ctx: ActionContext): Effect<CrocodileState> {
    if (state.finished) {
      throw new InvalidActionError('game_finished', 'This game has already finished')
    }

    switch (action.type) {
      case 'word/start_round': {
        const explainer = requireExplainer(state, ctx)
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
        const explainer = requireExplainer(state, ctx)
        if (!state.started) {
          throw new InvalidActionError('round_not_started', 'Call word/start_round first')
        }
        if (state.round.currentWord === null) {
          throw new InvalidActionError('no_current_word', 'No word is currently in play')
        }
        const guesserIndex = currentGuesserIndex(state)
        const guesserTeam = guesserIndex === null ? null : (state.round.teams[guesserIndex] ?? null)
        const guesserId = guesserTeam?.memberIds[0] ?? null
        if (guesserIndex === null || guesserId === null) {
          throw new InvalidActionError(
            'no_guesser_available',
            'No other player is available to be credited with the guess',
          )
        }

        // scoreWord credits the explainer's own (active) team and records the
        // roundResults entry for this word; scoreTeamAt then credits the
        // guesser's team directly, without touching roundResults again -
        // this is still one word, scored once, just paying two people.
        let round = scoreWord(state.round, true, POINTS)
        round = scoreTeamAt(round, guesserIndex, POINTS.correct)
        round = drawWord(round)

        return {
          state: { ...state, round, guesserOffset: state.guesserOffset + 1 },
          events: [
            { type: 'word_scored', playerId: explainer, guessed: true },
            { type: 'word_scored', playerId: guesserId, guessed: true },
          ],
        }
      }

      case 'word/skip': {
        const explainer = requireExplainer(state, ctx)
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
        requireExplainer(state, ctx)
        if (!state.started) {
          throw new InvalidActionError('round_not_started', 'The round has not started yet')
        }
        return finishTurn(state)
      }

      default:
        throw new InvalidActionError('unknown_action', `Unsupported action: ${action.type}`)
    }
  },

  onTimer(state: CrocodileState, timerId: string, _ctx: ActionContext): Effect<CrocodileState> {
    if (timerId !== 'round' || state.finished || !state.started) {
      return { state, events: [] }
    }
    return finishTurn(state)
  },

  view(state: CrocodileState, viewerId: PlayerId): WordGameView {
    const explainerId = currentExplainer(state.round)
    const activeTeam = state.round.teams[state.round.activeTeamIndex] ?? null
    const teamCount = Math.max(1, state.round.teams.length)
    const phase: WordGameView['phase'] = state.finished
      ? 'finished'
      : state.started
        ? 'active'
        : state.round.turn === 1
          ? 'preparing'
          : 'between_rounds'
    const maxScore = state.round.teams.reduce(
      (max, team) => Math.max(max, team.score),
      Number.NEGATIVE_INFINITY,
    )

    // Same "current or just-ended turn only" scoping as Alias - see its
    // view() for the full rationale.
    const lastResultsTurn = state.started ? state.round.turn : state.round.turn - 1

    return {
      kind: 'word',
      gameId: 'crocodile',
      phase,
      round: currentRound(state.round),
      totalRounds: state.round.totalTurns / teamCount,
      teams: state.round.teams,
      activeTeamId: activeTeam?.id ?? null,
      explainerId,
      secretWord: explainerId !== null && viewerId === explainerId ? state.round.currentWord : null,
      roundEndsAt: state.round.roundEndsAt,
      roundPaused: state.round.pausedRemainingMs !== null,
      lastResults: resultsForTurn(state.round, lastResultsTurn),
      winnerTeamIds: state.finished
        ? state.round.teams.filter((team) => team.score === maxScore).map((team) => team.id)
        : [],
    }
  },

  /**
   * One player per team (see `init`), so this is plain standard competition
   * ranking (1, 1, 3, ...) by per-player score - structurally the same
   * ranking Alias/Hat apply to real teams, just with `memberIds` always of
   * length 1.
   */
  results(state: CrocodileState): GameResultRow[] {
    const teams = state.round.teams
    const rows: GameResultRow[] = []
    for (const team of teams) {
      const placement = 1 + teams.filter((other) => other.score > team.score).length
      for (const playerId of team.memberIds) {
        rows.push({ playerId, score: team.score, placement })
      }
    }
    return rows.sort((a, b) => a.placement - b.placement)
  },
}
