import type { GameEvent, WordGameView } from '@gp/shared'
import { describe, expect, it } from 'vitest'
import type { ActionContext } from '../src/contract'
import { InvalidActionError } from '../src/contract'
import { getGameDefinition } from '../src/registry'

const CTX = (actorId: string, now = 1_000): ActionContext => ({ actorId, now, seed: 42 })
const PLAYERS = ['a', 'b', 'c', 'd']

function start() {
  const def = getGameDefinition('crocodile')
  return def.init({
    players: PLAYERS,
    seed: 42,
    options: {},
    deck: ['w1', 'w2', 'w3', 'w4', 'w5', 'w6', 'w7', 'w8'],
    now: 1000,
  })
}

function wordView(view: { kind: string }): WordGameView {
  if (view.kind !== 'word') throw new Error('expected a word game view')
  return view as WordGameView
}

function wordScoredEvents(events: GameEvent[]): { playerId: string; guessed: boolean }[] {
  return events.filter(
    (e): e is Extract<GameEvent, { type: 'word_scored' }> => e.type === 'word_scored',
  )
}

describe('crocodile', () => {
  it('every player gets their own single-member team (not-team-based scoreboard)', () => {
    const def = getGameDefinition('crocodile')
    const s = start()
    const view = wordView(def.view(s, 'a'))
    expect(view.teams).toHaveLength(4)
    const allMembers = view.teams.flatMap((t) => t.memberIds)
    for (const team of view.teams) {
      expect(team.memberIds).toHaveLength(1)
    }
    expect(new Set(allMembers)).toEqual(new Set(PLAYERS))
  })

  it('scores both the explainer and the guesser on a correct guess', () => {
    const def = getGameDefinition('crocodile')
    let s = start()
    const explainerId = wordView(def.view(s, 'a')).explainerId
    if (!explainerId) throw new Error('expected an explainer')
    s = def.reduce(s, { type: 'word/start_round' }, CTX(explainerId)).state

    const eff = def.reduce(s, { type: 'word/correct' }, CTX(explainerId))
    const view = wordView(def.view(eff.state, explainerId))

    const explainerTeam = view.teams.find((t) => t.memberIds.includes(explainerId))
    if (!explainerTeam) throw new Error('expected the explainer to have a team')
    expect(explainerTeam.score).toBe(1)

    const scoredOthers = view.teams.filter((t) => !t.memberIds.includes(explainerId) && t.score > 0)
    // Exactly one other player was credited with the guess.
    expect(scoredOthers).toHaveLength(1)
    const guesserId = scoredOthers[0]?.memberIds[0]
    if (!guesserId) throw new Error('expected a credited guesser')
    expect(scoredOthers[0]?.score).toBe(1)

    const scored = wordScoredEvents(eff.events)
    expect(scored).toContainEqual({ type: 'word_scored', playerId: explainerId, guessed: true })
    expect(scored).toContainEqual({ type: 'word_scored', playerId: guesserId, guessed: true })
    expect(scored).toHaveLength(2)
  })

  it('rejects word/correct from anyone but the explainer', () => {
    const def = getGameDefinition('crocodile')
    let s = start()
    const explainerId = wordView(def.view(s, 'a')).explainerId
    if (!explainerId) throw new Error('expected an explainer')
    s = def.reduce(s, { type: 'word/start_round' }, CTX(explainerId)).state
    const other = PLAYERS.find((p) => p !== explainerId)
    if (!other) throw new Error('expected a non-explainer player')
    expect(() => def.reduce(s, { type: 'word/correct' }, CTX(other))).toThrow(InvalidActionError)
  })

  it('hides the word from every non-explainer', () => {
    const def = getGameDefinition('crocodile')
    let s = start()
    const explainerId = wordView(def.view(s, 'a')).explainerId
    if (!explainerId) throw new Error('expected an explainer')
    s = def.reduce(s, { type: 'word/start_round' }, CTX(explainerId)).state
    for (const player of PLAYERS) {
      const view = wordView(def.view(s, player))
      if (player === explainerId) {
        expect(view.secretWord).toBeTruthy()
      } else {
        expect(view.secretWord).toBeNull()
      }
    }
  })

  it('successive correct guesses within one turn credit a different player each time', () => {
    const def = getGameDefinition('crocodile')
    let s = start()
    const explainerId = wordView(def.view(s, 'a')).explainerId
    if (!explainerId) throw new Error('expected an explainer')
    s = def.reduce(s, { type: 'word/start_round' }, CTX(explainerId)).state
    const others = PLAYERS.filter((p) => p !== explainerId)

    const credited: string[] = []
    for (let i = 0; i < others.length; i++) {
      const eff = def.reduce(s, { type: 'word/correct' }, CTX(explainerId))
      s = eff.state
      const guessEvent = wordScoredEvents(eff.events).find((e) => e.playerId !== explainerId)
      if (!guessEvent) throw new Error('expected a guess-credit event')
      credited.push(guessEvent.playerId)
    }

    expect(credited).toHaveLength(others.length)
    expect(new Set(credited)).toEqual(new Set(others))
  })

  it('a correct guess never credits the explainer as the guesser', () => {
    const def = getGameDefinition('crocodile')
    let s = start()
    const explainerId = wordView(def.view(s, 'a')).explainerId
    if (!explainerId) throw new Error('expected an explainer')
    s = def.reduce(s, { type: 'word/start_round' }, CTX(explainerId)).state
    for (let i = 0; i < 6; i++) {
      const eff = def.reduce(s, { type: 'word/correct' }, CTX(explainerId))
      s = eff.state
      const guessEvent = wordScoredEvents(eff.events).find((e) => e.playerId !== explainerId)
      expect(guessEvent?.playerId).not.toBe(explainerId)
    }
  })

  it('a skip scores nobody', () => {
    const def = getGameDefinition('crocodile')
    let s = start()
    const explainerId = wordView(def.view(s, 'a')).explainerId
    if (!explainerId) throw new Error('expected an explainer')
    s = def.reduce(s, { type: 'word/start_round' }, CTX(explainerId)).state
    s = def.reduce(s, { type: 'word/skip' }, CTX(explainerId)).state
    const view = wordView(def.view(s, explainerId))
    for (const team of view.teams) {
      expect(team.score).toBe(0)
    }
  })

  it('rejects a correct guess before the round has started', () => {
    const def = getGameDefinition('crocodile')
    const s = start()
    const explainerId = wordView(def.view(s, 'a')).explainerId
    if (!explainerId) throw new Error('expected an explainer')
    expect(() => def.reduce(s, { type: 'word/correct' }, CTX(explainerId))).toThrow(
      InvalidActionError,
    )
  })

  it('rejects actions once the game has finished', () => {
    const def = getGameDefinition('crocodile')
    let s = def.init({
      players: ['a', 'b', 'c'],
      seed: 7,
      options: { totalRounds: 1 },
      deck: ['w1', 'w2', 'w3'],
      now: 0,
    })
    let explainerId = wordView(def.view(s, 'a')).explainerId
    if (!explainerId) throw new Error('expected an explainer')
    s = def.reduce(s, { type: 'word/start_round' }, CTX(explainerId)).state
    s = def.reduce(s, { type: 'word/end_round' }, CTX(explainerId)).state
    explainerId = wordView(def.view(s, 'b')).explainerId
    if (!explainerId) throw new Error('expected an explainer')
    s = def.reduce(s, { type: 'word/start_round' }, CTX(explainerId)).state
    s = def.reduce(s, { type: 'word/end_round' }, CTX(explainerId)).state
    explainerId = wordView(def.view(s, 'c')).explainerId
    if (!explainerId) throw new Error('expected an explainer')
    s = def.reduce(s, { type: 'word/start_round' }, CTX(explainerId)).state
    s = def.reduce(s, { type: 'word/end_round' }, CTX(explainerId)).state
    expect((s as { finished: boolean }).finished).toBe(true)
    expect(() => def.reduce(s, { type: 'word/start_round' }, CTX(explainerId))).toThrow(
      InvalidActionError,
    )
  })

  it('finishes after totalRounds and reports per-player placements from per-player scores', () => {
    // 3 players -> teamCount 3 -> totalTurns = 1 * 3 = 3 (one turn per player).
    const def = getGameDefinition('crocodile')
    let s = def.init({
      players: ['a', 'b', 'c'],
      seed: 7,
      options: { totalRounds: 1 },
      deck: ['w1', 'w2', 'w3', 'w4', 'w5', 'w6'],
      now: 0,
    })

    // Turn 1: a explains, offset 1 credits b. a:1, b:1, c:0.
    let explainerId = wordView(def.view(s, 'a')).explainerId
    if (!explainerId) throw new Error('expected an explainer')
    expect(explainerId).toBe('a')
    s = def.reduce(s, { type: 'word/start_round' }, CTX(explainerId)).state
    s = def.reduce(s, { type: 'word/correct' }, CTX(explainerId)).state
    s = def.reduce(s, { type: 'word/end_round' }, CTX(explainerId)).state

    // Turn 2: b explains, no correct guesses this turn.
    explainerId = wordView(def.view(s, 'b')).explainerId
    if (!explainerId) throw new Error('expected an explainer')
    expect(explainerId).toBe('b')
    s = def.reduce(s, { type: 'word/start_round' }, CTX(explainerId)).state
    s = def.reduce(s, { type: 'word/end_round' }, CTX(explainerId)).state

    // Turn 3: c explains, no correct guesses; game finishes after this turn.
    explainerId = wordView(def.view(s, 'c')).explainerId
    if (!explainerId) throw new Error('expected an explainer')
    expect(explainerId).toBe('c')
    s = def.reduce(s, { type: 'word/start_round' }, CTX(explainerId)).state
    const finalEff = def.reduce(s, { type: 'word/end_round' }, CTX(explainerId))
    s = finalEff.state
    expect((s as { finished: boolean }).finished).toBe(true)
    expect(finalEff.finished).toBe(true)

    const results = def.results(s)
    expect(results).toHaveLength(3)
    const byPlayer = Object.fromEntries(results.map((r) => [r.playerId, r]))
    expect(byPlayer.a).toEqual({ playerId: 'a', score: 1, placement: 1 })
    expect(byPlayer.b).toEqual({ playerId: 'b', score: 1, placement: 1 })
    expect(byPlayer.c).toEqual({ playerId: 'c', score: 0, placement: 3 })
  })

  it('an action of a type this game does not understand throws InvalidActionError', () => {
    const def = getGameDefinition('crocodile')
    const s = start()
    expect(() => def.reduce(s, { type: 'card/take' }, CTX('a'))).toThrow(InvalidActionError)
  })

  it('lastResults reflects only the turn that just ended, not the whole game history', () => {
    const def = getGameDefinition('crocodile')
    let s = def.init({
      players: ['a', 'b', 'c'],
      seed: 5,
      options: { totalRounds: 2 },
      deck: ['w1', 'w2', 'w3', 'w4', 'w5', 'w6'],
      now: 0,
    })

    let explainerId = wordView(def.view(s, 'a')).explainerId
    if (!explainerId) throw new Error('expected an explainer')
    s = def.reduce(s, { type: 'word/start_round' }, CTX(explainerId)).state
    s = def.reduce(s, { type: 'word/correct' }, CTX(explainerId)).state
    s = def.reduce(s, { type: 'word/skip' }, CTX(explainerId)).state
    s = def.reduce(s, { type: 'word/end_round' }, CTX(explainerId)).state
    const afterTurn1 = wordView(def.view(s, explainerId)).lastResults
    expect(afterTurn1).toEqual([
      { word: 'w1', guessed: true },
      { word: 'w2', guessed: false },
    ])

    explainerId = wordView(def.view(s, 'b')).explainerId
    if (!explainerId) throw new Error('expected an explainer')
    s = def.reduce(s, { type: 'word/start_round' }, CTX(explainerId)).state
    s = def.reduce(s, { type: 'word/correct' }, CTX(explainerId)).state
    s = def.reduce(s, { type: 'word/end_round' }, CTX(explainerId)).state
    const afterTurn2 = wordView(def.view(s, explainerId)).lastResults
    expect(afterTurn2).toEqual([{ word: 'w4', guessed: true }])
  })

  it('state survives a JSON round-trip after a sequence of actions', () => {
    const def = getGameDefinition('crocodile')
    let s = start()
    const explainerId = wordView(def.view(s, 'a')).explainerId
    if (!explainerId) throw new Error('expected an explainer')
    s = def.reduce(s, { type: 'word/start_round' }, CTX(explainerId)).state
    s = def.reduce(s, { type: 'word/correct' }, CTX(explainerId)).state
    s = def.reduce(s, { type: 'word/skip' }, CTX(explainerId)).state
    s = def.reduce(s, { type: 'word/end_round' }, CTX(explainerId)).state
    const roundTripped = JSON.parse(JSON.stringify(s))
    expect(roundTripped).toEqual(s)
  })

  it('does not mutate the state object passed into reduce', () => {
    const def = getGameDefinition('crocodile')
    const s = start()
    const explainerId = wordView(def.view(s, 'a')).explainerId
    if (!explainerId) throw new Error('expected an explainer')
    const before = JSON.parse(JSON.stringify(s))
    def.reduce(s, { type: 'word/start_round' }, CTX(explainerId))
    expect(s).toEqual(before)
  })

  it('the serialized view for a non-explainer never contains the secret word', () => {
    const def = getGameDefinition('crocodile')
    let s = def.init({
      players: PLAYERS,
      seed: 3,
      options: {},
      deck: ['giraffe', 'w2', 'w3'],
      now: 0,
    })
    const explainerId = wordView(def.view(s, 'a')).explainerId
    if (!explainerId) throw new Error('expected an explainer')
    s = def.reduce(s, { type: 'word/start_round' }, CTX(explainerId)).state
    const secretWord = wordView(def.view(s, explainerId)).secretWord
    if (!secretWord) throw new Error('expected a secret word')
    for (const other of PLAYERS.filter((p) => p !== explainerId)) {
      const serialized = JSON.stringify(def.view(s, other))
      expect(serialized.includes(secretWord)).toBe(false)
    }
  })
})
