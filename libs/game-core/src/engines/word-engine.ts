import type { PlayerId, TeamView } from '@gp/shared'

/**
 * State for any word-guessing team game (Alias, Hat, Crocodile). Every function
 * here is pure: no Date.now(), no Math.random(), no I/O. Time arrives via `now`
 * parameters; the deck is supplied already shuffled by the caller (createRng
 * lives in ../rng.ts and is the caller's job to invoke before init).
 */
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
  roundResults: { word: string; guessed: boolean }[]
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
  const roundResults = [...state.roundResults, { word: state.currentWord ?? '', guessed }]
  return { ...state, teams, roundResults }
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
