import { describe, expect, it } from 'vitest'
import {
  advanceTurn,
  buildTeams,
  createWordRound,
  currentExplainer,
  drawWord,
  isWordGameOver,
  pauseRound,
  resumeRound,
  scoreWord,
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
      totalRounds: 2,
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
      totalRounds: 1,
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
      totalRounds: 1,
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
      totalRounds: 1,
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
    let s = createWordRound(['a', 'b'], ['w1'], { totalRounds: 1, teamCount: 2, roundMs: 60_000 })
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
      totalRounds: 1,
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
      totalRounds: 1,
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
      totalRounds: 1,
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
      totalRounds: 2,
      teamCount: 2,
      roundMs: 60_000,
    })
    const before = JSON.parse(JSON.stringify(s)) as typeof s
    advanceTurn(s)
    expect(s).toEqual(before)
  })

  it('isWordGameOver is true once the total rounds are exceeded', () => {
    let s = createWordRound(['a', 'b'], ['w1', 'w2'], {
      totalRounds: 1,
      teamCount: 2,
      roundMs: 60_000,
    })
    expect(isWordGameOver(s)).toBe(false)
    s = { ...s, round: 2 }
    expect(isWordGameOver(s)).toBe(true)
  })
})
