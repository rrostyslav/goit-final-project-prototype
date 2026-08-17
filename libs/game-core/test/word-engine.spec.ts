import { describe, expect, it } from 'vitest'
import {
  advanceTurn,
  buildTeams,
  createWordRound,
  currentExplainer,
  currentRound,
  drawWord,
  isWordGameOver,
  pauseRound,
  resultsForTurn,
  resumeRound,
  scoreWord,
  startRound,
} from '../src/engines/word-engine'

describe('word-engine', () => {
  it('splits players into balanced teams', () => {
    const teams = buildTeams(['a', 'b', 'c', 'd', 'e'], 2)
    expect(teams).toHaveLength(2)
    const [team0, team1] = teams
    if (!team0 || !team1) throw new Error('expected two teams')
    expect(team0.memberIds.length + team1.memberIds.length).toBe(5)
    expect(Math.abs(team0.memberIds.length - team1.memberIds.length)).toBeLessThanOrEqual(1)
  })

  it("rotates the explainer within a team across that team's turns", () => {
    let s = createWordRound(['a', 'b', 'c', 'd'], ['w1', 'w2'], {
      totalTurns: 2,
      teamCount: 2,
      roundMs: 60_000,
    })
    const first = currentExplainer(s)
    s = advanceTurn(s) // other team
    s = advanceTurn(s) // back to the first team
    expect(currentExplainer(s)).not.toBe(first)
  })

  it('scoreWord adds a point for a guess and subtracts for a skip', () => {
    let s = createWordRound(['a', 'b', 'c', 'd'], ['w1', 'w2', 'w3'], {
      totalTurns: 1,
      teamCount: 2,
      roundMs: 60_000,
    })
    s = drawWord(s)
    s = scoreWord(s, true, { correct: 1, skip: -1 })
    const afterCorrect = s.teams[s.activeTeamIndex]
    if (!afterCorrect) throw new Error('expected an active team')
    expect(afterCorrect.score).toBe(1)
    s = drawWord(s)
    s = scoreWord(s, false, { correct: 1, skip: -1 })
    const afterSkip = s.teams[s.activeTeamIndex]
    if (!afterSkip) throw new Error('expected an active team')
    expect(afterSkip.score).toBe(0)
  })

  it('pause and resume preserve the remaining round time', () => {
    let s = createWordRound(['a', 'b', 'c', 'd'], ['w'], {
      totalTurns: 1,
      teamCount: 2,
      roundMs: 60_000,
    })
    s = { ...s, roundEndsAt: 1_000_000 }
    s = pauseRound(s, 970_000)
    expect(s.pausedRemainingMs).toBe(30_000)
    s = resumeRound(s, 2_000_000)
    expect(s.roundEndsAt).toBe(2_030_000)
    expect(s.pausedRemainingMs).toBeNull()
  })

  it('never serves the same word twice within a game', () => {
    let s = createWordRound(['a', 'b'], ['w1', 'w2', 'w3'], {
      totalTurns: 1,
      teamCount: 2,
      roundMs: 60_000,
    })
    const seen: string[] = []
    for (let i = 0; i < 3; i++) {
      s = drawWord(s)
      if (s.currentWord === null) throw new Error('expected a word')
      seen.push(s.currentWord)
    }
    expect(new Set(seen).size).toBe(3)
  })

  // --- Additional edge-case tests beyond the brief ---

  it('drawWord does not crash or loop when the deck is exhausted; currentWord becomes null', () => {
    let s = createWordRound(['a', 'b'], ['w1'], { totalTurns: 1, teamCount: 2, roundMs: 60_000 })
    s = drawWord(s)
    expect(s.currentWord).toBe('w1')
    s = drawWord(s) // deck exhausted
    expect(s.currentWord).toBeNull()
    // Calling again stays stable, does not throw and does not resurrect a word.
    s = drawWord(s)
    expect(s.currentWord).toBeNull()
  })

  it('pausing an already-paused round is a no-op (keeps the first pausedRemainingMs)', () => {
    let s = createWordRound(['a', 'b', 'c', 'd'], ['w'], {
      totalTurns: 1,
      teamCount: 2,
      roundMs: 60_000,
    })
    s = { ...s, roundEndsAt: 1_000_000 }
    s = pauseRound(s, 970_000)
    expect(s.pausedRemainingMs).toBe(30_000)
    // Pausing again later must not overwrite the stored remaining time.
    const again = pauseRound(s, 999_000)
    expect(again.pausedRemainingMs).toBe(30_000)
    expect(again.roundEndsAt).toBeNull()
  })

  it('resuming a round that is not paused is a no-op', () => {
    let s = createWordRound(['a', 'b', 'c', 'd'], ['w'], {
      totalTurns: 1,
      teamCount: 2,
      roundMs: 60_000,
    })
    // Model a normal "running" round: a deadline is set and nothing is banked.
    s = { ...s, roundEndsAt: 1_000_000, pausedRemainingMs: null }
    const resumed = resumeRound(s, 1_500_000)
    expect(resumed.roundEndsAt).toBe(1_000_000)
    expect(resumed.pausedRemainingMs).toBeNull()
  })

  it('scoreWord does not mutate the state or teams passed in', () => {
    let s = createWordRound(['a', 'b', 'c', 'd'], ['w1', 'w2'], {
      totalTurns: 1,
      teamCount: 2,
      roundMs: 60_000,
    })
    s = drawWord(s)
    const before = JSON.parse(JSON.stringify(s)) as typeof s
    const teamsRefBefore = s.teams
    scoreWord(s, true, { correct: 1, skip: -1 })
    expect(s).toEqual(before)
    expect(s.teams).toBe(teamsRefBefore)
  })

  it('advanceTurn does not mutate the state passed in', () => {
    const s = createWordRound(['a', 'b', 'c', 'd'], ['w1', 'w2'], {
      totalTurns: 2,
      teamCount: 2,
      roundMs: 60_000,
    })
    const before = JSON.parse(JSON.stringify(s)) as typeof s
    advanceTurn(s)
    expect(s).toEqual(before)
  })

  it('isWordGameOver is true once the total turns are exceeded', () => {
    let s = createWordRound(['a', 'b'], ['w1', 'w2'], {
      totalTurns: 1,
      teamCount: 2,
      roundMs: 60_000,
    })
    expect(isWordGameOver(s)).toBe(false)
    s = { ...s, turn: 2 }
    expect(isWordGameOver(s)).toBe(true)
  })

  it('a freshly-created state has never started: no deadline, nothing banked', () => {
    const s = createWordRound(['a', 'b', 'c', 'd'], ['w'], {
      totalTurns: 1,
      teamCount: 2,
      roundMs: 60_000,
    })
    expect(s.roundEndsAt).toBeNull()
    expect(s.pausedRemainingMs).toBeNull()
    expect(s.roundMs).toBe(60_000)
  })

  it('a fresh (never-started) state is distinguishable from a paused one', () => {
    const fresh = createWordRound(['a', 'b', 'c', 'd'], ['w'], {
      totalTurns: 1,
      teamCount: 2,
      roundMs: 60_000,
    })
    let paused = startRound(fresh, 1_000_000)
    paused = pauseRound(paused, 1_030_000)
    // Both have roundEndsAt: null, but only the paused one has a banked value.
    expect(fresh.roundEndsAt).toBeNull()
    expect(fresh.pausedRemainingMs).toBeNull()
    expect(paused.roundEndsAt).toBeNull()
    expect(paused.pausedRemainingMs).not.toBeNull()
  })

  it('startRound sets a deadline roundMs in the future and clears any banked value', () => {
    const s = createWordRound(['a', 'b', 'c', 'd'], ['w'], {
      totalTurns: 1,
      teamCount: 2,
      roundMs: 60_000,
    })
    const started = startRound(s, 1_000_000)
    expect(started.roundEndsAt).toBe(1_060_000)
    expect(started.pausedRemainingMs).toBeNull()
  })

  it('startRound does not mutate the state passed in', () => {
    const s = createWordRound(['a', 'b', 'c', 'd'], ['w'], {
      totalTurns: 1,
      teamCount: 2,
      roundMs: 60_000,
    })
    const before = JSON.parse(JSON.stringify(s)) as typeof s
    startRound(s, 1_000_000)
    expect(s).toEqual(before)
  })

  it('resumeRound on a never-started state is a no-op: it does not invent a deadline', () => {
    const fresh = createWordRound(['a', 'b', 'c', 'd'], ['w'], {
      totalTurns: 1,
      teamCount: 2,
      roundMs: 60_000,
    })
    expect(fresh.roundEndsAt).toBeNull()
    expect(fresh.pausedRemainingMs).toBeNull()
    const resumed = resumeRound(fresh, 1_000_000)
    expect(resumed.roundEndsAt).toBeNull()
    expect(resumed.pausedRemainingMs).toBeNull()
  })

  it('currentRound derives the 1-based cycle number from turn and team count', () => {
    const s = createWordRound(['a', 'b', 'c', 'd'], ['w'], {
      totalTurns: 6,
      teamCount: 3,
      roundMs: 60_000,
    })
    // 3 teams: turns 1-3 are round 1, turns 4-6 are round 2.
    expect(currentRound({ ...s, turn: 1 })).toBe(1)
    expect(currentRound({ ...s, turn: 3 })).toBe(1)
    expect(currentRound({ ...s, turn: 4 })).toBe(2)
    expect(currentRound({ ...s, turn: 6 })).toBe(2)
    expect(currentRound({ ...s, turn: 7 })).toBe(3)
  })

  it('currentRound with a single team: every turn is its own round', () => {
    const s = createWordRound(['a', 'b'], ['w'], {
      totalTurns: 4,
      teamCount: 1,
      roundMs: 60_000,
    })
    expect(currentRound({ ...s, turn: 1 })).toBe(1)
    expect(currentRound({ ...s, turn: 2 })).toBe(2)
    expect(currentRound({ ...s, turn: 4 })).toBe(4)
  })

  it('isWordGameOver is true from turn 1 when totalTurns is 0', () => {
    // turn starts at 1, so a totalTurns of 0 must report over immediately -
    // no bogus playable turn before the game reports finished.
    const s = createWordRound(['a', 'b'], ['w1'], {
      totalTurns: 0,
      teamCount: 2,
      roundMs: 60_000,
    })
    expect(s.turn).toBe(1)
    expect(isWordGameOver(s)).toBe(true)
  })

  it('scoreWord tags each roundResults entry with the turn it was scored on', () => {
    let s = createWordRound(['a', 'b', 'c', 'd'], ['w1', 'w2', 'w3'], {
      totalTurns: 2,
      teamCount: 2,
      roundMs: 60_000,
    })
    s = drawWord(s) // 'w1', turn 1
    s = scoreWord(s, true, { correct: 1, skip: -1 })
    s = advanceTurn(s) // turn 2
    s = drawWord(s) // 'w2', turn 2
    s = scoreWord(s, false, { correct: 1, skip: -1 })
    expect(s.roundResults).toEqual([
      { word: 'w1', guessed: true, turn: 1 },
      { word: 'w2', guessed: false, turn: 2 },
    ])
  })

  it('resultsForTurn returns only the entries for the given turn, with the tag stripped', () => {
    let s = createWordRound(['a', 'b', 'c', 'd'], ['w1', 'w2', 'w3'], {
      totalTurns: 2,
      teamCount: 2,
      roundMs: 60_000,
    })
    s = drawWord(s) // 'w1', turn 1
    s = scoreWord(s, true, { correct: 1, skip: -1 })
    s = advanceTurn(s) // turn 2
    s = drawWord(s) // 'w2', turn 2
    s = scoreWord(s, false, { correct: 1, skip: -1 })
    expect(resultsForTurn(s, 1)).toEqual([{ word: 'w1', guessed: true }])
    expect(resultsForTurn(s, 2)).toEqual([{ word: 'w2', guessed: false }])
    // A turn with no scored words yet (or one that never happened) yields [].
    expect(resultsForTurn(s, 3)).toEqual([])
  })
})
