import type { GameEvent, PlayerId, TeamView, WordGameView } from '@gp/shared'
import type { ActionContext, Effect, GameResultRow } from '../contract'
import { InvalidActionError } from '../contract'

/**
 * State for any word-guessing team game (Alias, Hat, Crocodile). Every function
 * here is pure: no Date.now(), no Math.random(), no I/O. Time arrives via `now`
 * parameters; the deck is supplied already shuffled by the caller (createRng
 * lives in ../rng.ts and is the caller's job to invoke before init).
 */
/**
 * Clamps `value` to the inclusive [min, max] range, flooring to an integer.
 * Shared by every word game's option parsing (Alias/Hat's `roundMs` and
 * `teamCount`, Crocodile's `roundMs`) so the clamping rule lives in one place.
 */
export function clampInt(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.floor(value)))
}

/**
 * Reads an untrusted `options` field defensively: returns `value` only if it
 * is actually a finite number, `fallback` otherwise. `InitContext.options` is
 * `Record<string, unknown>` (it crosses a JSON boundary from Task 16 onward),
 * so every word game reads it through this rather than trusting or casting.
 */
export function finiteNumberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

export interface WordRoundState {
  teams: TeamView[]
  activeTeamIndex: number
  /** Index into a team's memberIds of whoever explains next for that team. */
  explainerIndexByTeam: Record<string, number>
  /** Turns taken so far (one per advanceTurn call, across all teams). Not a cycle count - see currentRound. */
  turn: number
  totalTurns: number
  /** The fixed per-round time budget in ms, retained so startRound can set a deadline for turn 2, 3, ... */
  roundMs: number
  deck: string[]
  deckCursor: number
  currentWord: string | null
  roundEndsAt: number | null
  pausedRemainingMs: number | null
  /**
   * Every word scored so far, all game, tagged with the `turn` it was scored
   * on. This is the full history - kept on state deliberately (e.g. Task 16
   * persists the final state, and a full per-word history is worth keeping)
   * - not a per-turn view. Games that want just the turn that ended, not the
   * whole game's pile, use `resultsForTurn` below rather than reading this
   * array directly.
   */
  roundResults: { word: string; guessed: boolean; turn: number }[]
}

/**
 * Splits players into `teamCount` teams, balanced to within one member, by
 * dealing players round-robin (index i -> team i % teamCount). Deterministic:
 * no RNG is used here, so callers who want randomized teams must shuffle the
 * player list themselves (e.g. with createRng(seed).shuffle) before calling.
 */
export function buildTeams(players: PlayerId[], teamCount: number): TeamView[] {
  const count = Math.max(1, teamCount)
  const teams: TeamView[] = Array.from({ length: count }, (_, index) => ({
    id: `team-${index}`,
    name: `Team ${index + 1}`,
    memberIds: [],
    score: 0,
  }))
  players.forEach((playerId, index) => {
    const team = teams[index % count]
    if (team) {
      team.memberIds.push(playerId)
    }
  })
  return teams
}

/**
 * Builds the initial round state. The clock is genuinely unset - roundEndsAt
 * is null and pausedRemainingMs is null, not a banked value - so a fresh state
 * is distinguishable from one paused mid-round (which has a non-null
 * pausedRemainingMs). Call `startRound(state, now)` to actually start the
 * clock; `resumeRound` is reserved for un-pausing a round already in progress.
 *
 * `totalTurns` counts individual turns (one per player who explains), not
 * cycles through the team order: a caller who wants "N rounds where every team
 * plays N times" passes `totalTurns: N * teamCount`. Use `currentRound(state)`
 * to translate the turn counter back into a 1-based cycle number for display.
 */
export function createWordRound(
  players: PlayerId[],
  deck: string[],
  opts: { totalTurns: number; teamCount: number; roundMs: number },
): WordRoundState {
  const teams = buildTeams(players, opts.teamCount)
  const explainerIndexByTeam: Record<string, number> = {}
  for (const team of teams) {
    explainerIndexByTeam[team.id] = 0
  }
  return {
    teams,
    activeTeamIndex: 0,
    explainerIndexByTeam,
    turn: 1,
    totalTurns: opts.totalTurns,
    roundMs: opts.roundMs,
    deck: [...deck],
    deckCursor: 0,
    currentWord: null,
    roundEndsAt: null,
    pausedRemainingMs: null,
    roundResults: [],
  }
}

/** The player currently explaining for the active team, or null if it has no members. */
export function currentExplainer(state: WordRoundState): PlayerId | null {
  const team = state.teams[state.activeTeamIndex]
  if (!team || team.memberIds.length === 0) {
    return null
  }
  const explainerIndex = state.explainerIndexByTeam[team.id] ?? 0
  return team.memberIds[explainerIndex % team.memberIds.length] ?? null
}

/**
 * Throws `InvalidActionError('not_explainer', ...)` unless `ctx.actorId` is
 * the player currently explaining for `round`; otherwise returns that id.
 * Shared by every word game's action handlers (Alias/Hat, Crocodile): only
 * the current explainer may start a round, score a word, or end a turn.
 */
export function requireExplainer(round: WordRoundState, ctx: ActionContext): PlayerId {
  const explainer = currentExplainer(round)
  if (explainer === null || explainer !== ctx.actorId) {
    throw new InvalidActionError(
      'not_explainer',
      'Only the current explainer may perform this action',
    )
  }
  return explainer
}

/**
 * Advances deckCursor and serves the next word. Reshuffles nothing - the deck
 * order is fixed at createWordRound time. Once the deck is exhausted this
 * returns currentWord: null instead of throwing or wrapping around, so a game
 * that outlasts its 120+ word deck degrades to "no more words" rather than
 * crashing or repeating a word.
 */
export function drawWord(state: WordRoundState): WordRoundState {
  const word = state.deck[state.deckCursor]
  if (word === undefined) {
    return { ...state, currentWord: null }
  }
  return { ...state, deckCursor: state.deckCursor + 1, currentWord: word }
}

/** Adds `points.correct` for a guess or `points.skip` for a skip to the active team's score. */
export function scoreWord(
  state: WordRoundState,
  guessed: boolean,
  points: { correct: number; skip: number },
): WordRoundState {
  const delta = guessed ? points.correct : points.skip
  const teams = state.teams.map((team, index) =>
    index === state.activeTeamIndex ? { ...team, score: team.score + delta } : team,
  )
  const roundResults = [
    ...state.roundResults,
    { word: state.currentWord ?? '', guessed, turn: state.turn },
  ]
  return { ...state, teams, roundResults }
}

/**
 * Adds `delta` points directly to the team at `teamIndex`, without touching
 * `roundResults` and without requiring that team be the active one.
 * `scoreWord` always credits `state.activeTeamIndex` (whoever is currently
 * explaining) and appends a `roundResults` entry for the word; games where
 * credit for the *same* word also belongs to a different participant - e.g.
 * Crocodile, where a correct guess pays both the explainer (the active team)
 * and whichever other player is credited with the guess - need a way to
 * credit that second team without inventing a second `roundResults` entry
 * for what is still just one word. A `teamIndex` out of range is a no-op
 * (state returned unchanged, new object) rather than a throw, since it is
 * only ever reachable if a caller's own index bookkeeping is wrong, and a
 * silently-ignored stray credit is safer than corrupting an unrelated team.
 */
export function scoreTeamAt(
  state: WordRoundState,
  teamIndex: number,
  delta: number,
): WordRoundState {
  if (teamIndex < 0 || teamIndex >= state.teams.length) {
    return { ...state }
  }
  const teams = state.teams.map((team, index) =>
    index === teamIndex ? { ...team, score: team.score + delta } : team,
  )
  return { ...state, teams }
}

/**
 * The subset of `roundResults` scored during turn `turn`, with the turn tag
 * stripped back off. `roundResults` on state accumulates every word played
 * all game; a game's `view()` uses this to show only the turn that is
 * currently active or that just ended, not the whole game's history, so a
 * "last turn" field on the client doesn't grow into "every turn ever".
 */
export function resultsForTurn(
  state: WordRoundState,
  turn: number,
): { word: string; guessed: boolean }[] {
  return state.roundResults
    .filter((entry) => entry.turn === turn)
    .map((entry) => ({ word: entry.word, guessed: entry.guessed }))
}

/**
 * Sets roundEndsAt to `now + state.roundMs`, starting the clock for the
 * current turn from its full time budget. Distinct from `resumeRound`, which
 * only ever restores a previously-banked `pausedRemainingMs` - `startRound` is
 * the one function that turns the fixed `roundMs` budget into a fresh
 * deadline, so it is what a caller invokes for turn 1, turn 2, and every turn
 * after that. Starting a round that is already running (roundEndsAt is not
 * null) overwrites the deadline with a fresh full-budget one; callers that
 * want to avoid resetting an in-progress clock should check `roundEndsAt`
 * first.
 */
export function startRound(state: WordRoundState, now: number): WordRoundState {
  return { ...state, roundEndsAt: now + state.roundMs, pausedRemainingMs: null }
}

/**
 * Stores the time remaining until roundEndsAt and clears the deadline.
 * Pausing an already-paused round (roundEndsAt already null) is a no-op: the
 * first pause's pausedRemainingMs is kept rather than overwritten, so a
 * second pause request (e.g. a duplicate disconnect event) can never corrupt
 * the banked time.
 */
export function pauseRound(state: WordRoundState, now: number): WordRoundState {
  if (state.roundEndsAt === null) {
    return { ...state }
  }
  const remaining = Math.max(0, state.roundEndsAt - now)
  return { ...state, roundEndsAt: null, pausedRemainingMs: remaining }
}

/**
 * Restores a deadline `pausedRemainingMs` into the future and clears the
 * banked value. Resuming a round that is already running (roundEndsAt is not
 * null) is a no-op - it does not extend or reset the existing deadline.
 *
 * Also a no-op - deliberately, not by accident - if there is nothing banked
 * to resume from (`pausedRemainingMs === null`). This covers both "already
 * running" and "never started": a fresh state from `createWordRound` has
 * `roundEndsAt: null` and `pausedRemainingMs: null`, which is NOT the same
 * state as "paused" (`roundEndsAt: null`, `pausedRemainingMs` a number), so
 * `resumeRound` does not invent a deadline for it. Use `startRound` to start
 * a round for the first time; `resumeRound` only un-pauses one already in
 * progress.
 */
export function resumeRound(state: WordRoundState, now: number): WordRoundState {
  if (state.roundEndsAt !== null || state.pausedRemainingMs === null) {
    return { ...state }
  }
  return { ...state, roundEndsAt: now + state.pausedRemainingMs, pausedRemainingMs: null }
}

/**
 * Moves to the next team in round-robin order and bumps the explainer index
 * of the team being left, so that team's next turn goes to a different
 * member. `turn` counts individual turns taken (one per advanceTurn call,
 * across all teams), and isWordGameOver compares it against totalTurns. Use
 * `currentRound(state)` to translate `turn` into a 1-based cycle number.
 */
export function advanceTurn(state: WordRoundState): WordRoundState {
  const leavingTeam = state.teams[state.activeTeamIndex]
  const explainerIndexByTeam = { ...state.explainerIndexByTeam }
  if (leavingTeam) {
    explainerIndexByTeam[leavingTeam.id] = (explainerIndexByTeam[leavingTeam.id] ?? 0) + 1
  }
  const teamCount = state.teams.length
  const activeTeamIndex = teamCount === 0 ? 0 : (state.activeTeamIndex + 1) % teamCount
  return {
    ...state,
    activeTeamIndex,
    explainerIndexByTeam,
    turn: state.turn + 1,
  }
}

/** True once the turn counter has moved past the configured totalTurns. */
export function isWordGameOver(state: WordRoundState): boolean {
  return state.turn > state.totalTurns
}

/**
 * The slice of a word game's own state that `finishWordTurn` needs to read
 * and update. Every word game (Alias, Hat, Crocodile) satisfies this - it is
 * a structural constraint, not a type any game must declare against.
 */
export interface WordTurnState {
  round: WordRoundState
  started: boolean
  finished: boolean
}

/**
 * Core "a turn is over" transition, shared by every word game's explicit
 * word/end_round action and its 'round' timer firing. Advances the
 * word-engine turn (which rotates to the next team/player and bumps the
 * leaving team's explainer index), clears the now-stale word and deadline,
 * and flips `finished` once the engine reports the turn budget is used up.
 *
 * Generic over `S` so each game's own state shape (extra fields such as
 * Alias's `mode`) passes through untouched - only `round`, `started`, and
 * `finished` are read or overwritten.
 */
export function finishWordTurn<S extends WordTurnState>(state: S): Effect<S> {
  const endedRound = currentRound(state.round)
  const advanced = advanceTurn(state.round)
  const nextRound: WordRoundState = { ...advanced, currentWord: null, roundEndsAt: null }
  const finished = isWordGameOver(nextRound)
  const events: GameEvent[] = [{ type: 'round_ended', round: endedRound }]
  if (finished) {
    events.push({ type: 'game_finished' })
  }
  const nextState = { ...state, round: nextRound, started: false, finished } as S
  return {
    state: nextState,
    events,
    timers: [{ op: 'clear', id: 'round' }],
    finished,
  }
}

/**
 * Freezes the active turn's clock for `pause`/`resume` (Task 16's
 * `GameRuntimeService.pauseForDisconnect`/`resumeAfterReconnect`, called when
 * the current explainer disconnects). A no-op — new object, same values —
 * when there is no running turn to freeze (`!state.started`, already
 * `finished`, or `pauseRound` itself finds nothing running): pausing a turn
 * that was never started or has already ended must never invent a deadline
 * or double-count a clear. Emits `timers: [{ op: 'clear', id: 'round' }]`
 * unconditionally when a turn is running so the caller's in-process timer for
 * this session is cancelled alongside the state's own `pausedRemainingMs`
 * bookkeeping — otherwise the original timer would still fire mid-pause.
 */
export function pauseWordTurn<S extends WordTurnState>(state: S, now: number): Effect<S> {
  if (!state.started || state.finished) {
    return { state: { ...state }, events: [] }
  }
  const round = pauseRound(state.round, now)
  return {
    state: { ...state, round },
    events: [],
    timers: [{ op: 'clear', id: 'round' }],
  }
}

/**
 * Restores the clock frozen by `pauseWordTurn`. Also a no-op under the same
 * conditions (`!state.started`, `finished`), and additionally whenever
 * `resumeRound` itself has nothing banked to restore (never paused in the
 * first place) — in which case no fresh timer is set either, since there is
 * no new deadline to fire against. When a deadline *is* restored, re-arms
 * the caller's 'round' timer for exactly the remaining time, so a turn
 * paused with 10s left still gets exactly 10s after the reconnect, not a
 * fresh full `roundMs` budget.
 */
export function resumeWordTurn<S extends WordTurnState>(state: S, now: number): Effect<S> {
  // The `pausedRemainingMs === null` check (not just `!started`/`finished`)
  // is what makes this a true no-op for a round that is currently running
  // (never paused): `resumeRound` itself would also no-op in that case, but
  // only checking its output would still emit a spurious `timers: [{op:
  // 'set', ...}]` re-arming an already-correct timer for no reason.
  if (!state.started || state.finished || state.round.pausedRemainingMs === null) {
    return { state: { ...state }, events: [] }
  }
  const round = resumeRound(state.round, now)
  if (round.roundEndsAt === null) {
    return { state: { ...state, round }, events: [] }
  }
  return {
    state: { ...state, round },
    events: [],
    timers: [{ op: 'set', id: 'round', delayMs: round.roundEndsAt - now }],
  }
}

/**
 * Derives the 1-based "round" (a full cycle through every team) that `turn`
 * falls in, so a reducer can present "round 2 of 4" to players without
 * recomputing the turn/team-count arithmetic itself. Turn 1..teamCount is
 * round 1, teamCount+1..2*teamCount is round 2, and so on. A team count of
 * zero degenerates to round 1 rather than dividing by zero.
 */
export function currentRound(state: WordRoundState): number {
  const teamCount = state.teams.length
  if (teamCount === 0) {
    return 1
  }
  return Math.floor((state.turn - 1) / teamCount) + 1
}

/**
 * Builds the `WordGameView` common to every word game: phase derivation,
 * active team, the explainer-only secret word, and `lastResults` scoped to
 * the turn that is active or that just ended (not the whole game's history -
 * `state.round.roundResults` accumulates every word played all game;
 * `resultsForTurn` narrows that to what a client should actually see for
 * "the turn that just happened"). `gameId` and `viewerId` are the only
 * per-call inputs a game supplies; everything else is read off `state.round`
 * and the shared `started`/`finished` flags.
 */
export function buildWordGameView<S extends WordTurnState>(
  state: S,
  gameId: WordGameView['gameId'],
  viewerId: PlayerId,
): WordGameView {
  const round = state.round
  const explainerId = currentExplainer(round)
  const activeTeam = round.teams[round.activeTeamIndex] ?? null
  const teamCount = Math.max(1, round.teams.length)
  const phase: WordGameView['phase'] = state.finished
    ? 'finished'
    : state.started
      ? 'active'
      : round.turn === 1
        ? 'preparing'
        : 'between_rounds'
  const maxScore = round.teams.reduce(
    (max, team) => Math.max(max, team.score),
    Number.NEGATIVE_INFINITY,
  )
  const lastResultsTurn = state.started ? round.turn : round.turn - 1

  return {
    kind: 'word',
    gameId,
    phase,
    round: currentRound(round),
    totalRounds: round.totalTurns / teamCount,
    teams: round.teams,
    activeTeamId: activeTeam?.id ?? null,
    explainerId,
    secretWord: explainerId !== null && viewerId === explainerId ? round.currentWord : null,
    roundEndsAt: round.roundEndsAt,
    roundPaused: round.pausedRemainingMs !== null,
    lastResults: resultsForTurn(round, lastResultsTurn),
    winnerTeamIds: state.finished
      ? round.teams.filter((team) => team.score === maxScore).map((team) => team.id)
      : [],
  }
}

/**
 * Ranks every team in `round` by score (standard competition ranking: teams
 * tied on score share a placement, and the next distinct score's placement
 * equals 1 + the number of teams strictly above it - so two teams tied for
 * first followed by a third-place team yields 1, 1, 3, not 1, 1, 2), then
 * expands each team into one `GameResultRow` per member, all inheriting that
 * team's score and placement. Shared by every word game: Alias/Hat rank real
 * teams; Crocodile (one single-member team per player, see `createWordRound`
 * called with `teamCount: players.length`) gets per-player placement for
 * free from the same loop.
 */
export function wordGameResults(round: WordRoundState): GameResultRow[] {
  const teams = round.teams
  const rows: GameResultRow[] = []
  for (const team of teams) {
    const placement = 1 + teams.filter((other) => other.score > team.score).length
    for (const playerId of team.memberIds) {
      rows.push({ playerId, score: team.score, placement })
    }
  }
  return rows.sort((a, b) => a.placement - b.placement)
}
