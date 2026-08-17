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
  round: number
  totalRounds: number
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
 * Builds the initial round state. The round has not started yet: roundEndsAt
 * is null, and the full `roundMs` budget is banked in pausedRemainingMs so the
 * caller starts the clock with a plain `resumeRound(state, now)` call - the
 * same primitive used to resume after a pause, so there is only one code path
 * that turns "time budget" into an actual deadline.
 */
export function createWordRound(
  players: PlayerId[],
  deck: string[],
  opts: { totalRounds: number; teamCount: number; roundMs: number },
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
    round: 1,
    totalRounds: opts.totalRounds,
    deck: [...deck],
    deckCursor: 0,
    currentWord: null,
    roundEndsAt: null,
    pausedRemainingMs: opts.roundMs,
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
 * null) is a no-op - it does not extend or reset the existing deadline. Also
 * a no-op if there is nothing banked to resume from.
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
 * member. `round` counts turns taken (one per advanceTurn call, across all
 * teams), and isWordGameOver compares it against totalRounds.
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
    round: state.round + 1,
  }
}

/** True once the turn counter has moved past the configured totalRounds. */
export function isWordGameOver(state: WordRoundState): boolean {
  return state.round > state.totalRounds
}
