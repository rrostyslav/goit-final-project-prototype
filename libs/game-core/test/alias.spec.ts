import type { WordGameView } from '@gp/shared'
import { describe, expect, it } from 'vitest'
import type { ActionContext } from '../src/contract'
import { InvalidActionError } from '../src/contract'
import { getGameDefinition } from '../src/registry'

const CTX = (actorId: string, now = 1_000): ActionContext => ({ actorId, now, seed: 42 })
const PLAYERS = ['a', 'b', 'c', 'd']

function start() {
  const def = getGameDefinition('alias')
  return def.init({
    players: PLAYERS,
    seed: 42,
    options: {},
    deck: ['w1', 'w2', 'w3', 'w4', 'w5'],
    now: 1000,
  })
}

function wordView(view: { kind: string }): WordGameView {
  if (view.kind !== 'word') throw new Error('expected a word game view')
  return view as WordGameView
}

describe('alias / hat', () => {
  it('only the explainer may start the round', () => {
    const def = getGameDefinition('alias')
    const s = start()
    const explainerId = wordView(def.view(s, 'a')).explainerId
    if (!explainerId) throw new Error('expected an explainer')
    const other = PLAYERS.find((p) => p !== explainerId)
    if (!other) throw new Error('expected a non-explainer player')
    expect(() => def.reduce(s, { type: 'word/start_round' }, CTX(other))).toThrow(
      InvalidActionError,
    )
  })

  it('hides the secret word from everyone except the explainer', () => {
    const def = getGameDefinition('alias')
    let s = start()
    const explainerId = wordView(def.view(s, 'a')).explainerId
    if (!explainerId) throw new Error('expected an explainer')
    s = def.reduce(s, { type: 'word/start_round' }, CTX(explainerId)).state
    const other = PLAYERS.find((p) => p !== explainerId)
    if (!other) throw new Error('expected a non-explainer player')
    expect(wordView(def.view(s, explainerId)).secretWord).toBeTruthy()
    expect(wordView(def.view(s, other)).secretWord).toBeNull()
  })

  it('a correct guess scores a point and serves a new word', () => {
    const def = getGameDefinition('alias')
    let s = start()
    const explainerId = wordView(def.view(s, 'a')).explainerId
    if (!explainerId) throw new Error('expected an explainer')
    s = def.reduce(s, { type: 'word/start_round' }, CTX(explainerId)).state
    const first = wordView(def.view(s, explainerId)).secretWord
    const eff = def.reduce(s, { type: 'word/correct' }, CTX(explainerId))
    const view = wordView(def.view(eff.state, explainerId))
    const activeTeam = view.teams.find((t) => t.id === view.activeTeamId)
    if (!activeTeam) throw new Error('expected an active team')
    expect(activeTeam.score).toBe(1)
    expect(view.secretWord).not.toBe(first)
    expect(eff.events).toContainEqual({
      type: 'word_scored',
      playerId: explainerId,
      guessed: true,
    })
  })

  it('a skip costs a point in alias mode but not in hat mode', () => {
    const run = (gameId: 'alias' | 'hat') => {
      const d = getGameDefinition(gameId)
      let s = d.init({
        players: PLAYERS,
        seed: 1,
        options: {},
        deck: ['w1', 'w2', 'w3'],
        now: 0,
      })
      const explainerId = wordView(d.view(s, 'a')).explainerId
      if (!explainerId) throw new Error('expected an explainer')
      s = d.reduce(s, { type: 'word/start_round' }, CTX(explainerId)).state
      s = d.reduce(s, { type: 'word/skip' }, CTX(explainerId)).state
      const v = wordView(d.view(s, explainerId))
      const activeTeam = v.teams.find((t) => t.id === v.activeTeamId)
      if (!activeTeam) throw new Error('expected an active team')
      return activeTeam.score
    }
    expect(run('alias')).toBe(-1)
    expect(run('hat')).toBe(0)
  })

  it('the round timer ends the round and passes the turn to the other team', () => {
    const def = getGameDefinition('alias')
    let s = start()
    const explainerId = wordView(def.view(s, 'a')).explainerId
    if (!explainerId) throw new Error('expected an explainer')
    s = def.reduce(s, { type: 'word/start_round' }, CTX(explainerId)).state
    const before = wordView(def.view(s, 'a')).activeTeamId
    const eff = def.onTimer(s, 'round', CTX(explainerId, 61_000))
    expect(wordView(def.view(eff.state, 'a')).activeTeamId).not.toBe(before)
    expect(eff.events).toContainEqual(expect.objectContaining({ type: 'round_ended' }))
  })

  it('finishes after totalRounds and reports placements by score', () => {
    // 4 players, default teamCount 2 -> team-0 = [a, c], team-1 = [b, d].
    // totalRounds: 1 -> totalTurns = 1 * 2 = 2 (one turn per team).
    const def = getGameDefinition('alias')
    let s = def.init({
      players: PLAYERS,
      seed: 7,
      options: { totalRounds: 1 },
      deck: ['w1', 'w2', 'w3', 'w4', 'w5', 'w6'],
      now: 0,
    })

    // Turn 1: team-0's explainer (a) scores two correct guesses.
    let explainerId = wordView(def.view(s, 'a')).explainerId
    if (!explainerId) throw new Error('expected an explainer')
    expect(explainerId).toBe('a')
    s = def.reduce(s, { type: 'word/start_round' }, CTX(explainerId)).state
    s = def.reduce(s, { type: 'word/correct' }, CTX(explainerId)).state
    s = def.reduce(s, { type: 'word/correct' }, CTX(explainerId)).state
    s = def.reduce(s, { type: 'word/end_round' }, CTX(explainerId)).state
    expect((s as { finished: boolean }).finished).toBe(false)

    // Turn 2: team-1's explainer (b) scores one correct guess, then the game ends.
    explainerId = wordView(def.view(s, 'b')).explainerId
    if (!explainerId) throw new Error('expected an explainer')
    expect(explainerId).toBe('b')
    s = def.reduce(s, { type: 'word/start_round' }, CTX(explainerId)).state
    s = def.reduce(s, { type: 'word/correct' }, CTX(explainerId)).state
    const finalEff = def.reduce(s, { type: 'word/end_round' }, CTX(explainerId))
    s = finalEff.state
    expect((s as { finished: boolean }).finished).toBe(true)
    expect(finalEff.finished).toBe(true)
    expect(finalEff.events).toContainEqual({ type: 'game_finished' })

    const results = def.results(s)
    expect(results).toHaveLength(4)
    // Sorted by score descending; team-0 (a, c) scored 2, team-1 (b, d) scored 1.
    expect(results.map((r) => r.score)).toEqual([2, 2, 1, 1])
    expect(results.map((r) => r.placement)).toEqual([1, 1, 2, 2])
    const byPlayer = Object.fromEntries(results.map((r) => [r.playerId, r]))
    expect(byPlayer.a).toEqual({ playerId: 'a', score: 2, placement: 1 })
    expect(byPlayer.c).toEqual({ playerId: 'c', score: 2, placement: 1 })
    expect(byPlayer.b).toEqual({ playerId: 'b', score: 1, placement: 2 })
    expect(byPlayer.d).toEqual({ playerId: 'd', score: 1, placement: 2 })
  })

  // --- Additional edge-case tests beyond the brief ---

  it('hat mode uses its own titleKey while sharing everything else with alias', () => {
    const alias = getGameDefinition('alias')
    const hat = getGameDefinition('hat')
    expect(alias.meta.titleKey).toBe('game.alias')
    expect(hat.meta.titleKey).toBe('game.hat')
    expect(alias.meta.minPlayers).toBe(hat.meta.minPlayers)
    expect(alias.meta.maxPlayers).toBe(hat.meta.maxPlayers)
  })

  it('only the explainer may score or end the round', () => {
    const def = getGameDefinition('alias')
    let s = start()
    const explainerId = wordView(def.view(s, 'a')).explainerId
    if (!explainerId) throw new Error('expected an explainer')
    s = def.reduce(s, { type: 'word/start_round' }, CTX(explainerId)).state
    const other = PLAYERS.find((p) => p !== explainerId)
    if (!other) throw new Error('expected a non-explainer player')
    expect(() => def.reduce(s, { type: 'word/correct' }, CTX(other))).toThrow(InvalidActionError)
    expect(() => def.reduce(s, { type: 'word/skip' }, CTX(other))).toThrow(InvalidActionError)
    expect(() => def.reduce(s, { type: 'word/end_round' }, CTX(other))).toThrow(InvalidActionError)
  })

  it('rejects scoring before the round has been started', () => {
    const def = getGameDefinition('alias')
    const s = start()
    const explainerId = wordView(def.view(s, 'a')).explainerId
    if (!explainerId) throw new Error('expected an explainer')
    expect(() => def.reduce(s, { type: 'word/correct' }, CTX(explainerId))).toThrow(
      InvalidActionError,
    )
    expect(() => def.reduce(s, { type: 'word/end_round' }, CTX(explainerId))).toThrow(
      InvalidActionError,
    )
  })

  it('rejects starting an already-started round', () => {
    const def = getGameDefinition('alias')
    let s = start()
    const explainerId = wordView(def.view(s, 'a')).explainerId
    if (!explainerId) throw new Error('expected an explainer')
    s = def.reduce(s, { type: 'word/start_round' }, CTX(explainerId)).state
    expect(() => def.reduce(s, { type: 'word/start_round' }, CTX(explainerId))).toThrow(
      InvalidActionError,
    )
  })

  it('rejects actions once the game has finished', () => {
    const def = getGameDefinition('alias')
    let s = def.init({
      players: PLAYERS,
      seed: 7,
      options: { totalRounds: 1 },
      deck: ['w1', 'w2'],
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
    expect((s as { finished: boolean }).finished).toBe(true)
    expect(() => def.reduce(s, { type: 'word/start_round' }, CTX(explainerId))).toThrow(
      InvalidActionError,
    )
  })

  it('an action of a type this game does not understand throws InvalidActionError', () => {
    const def = getGameDefinition('alias')
    const s = start()
    expect(() => def.reduce(s, { type: 'card/take' }, CTX('a'))).toThrow(InvalidActionError)
  })

  it('a stale round timer after the round has already ended manually is a no-op', () => {
    const def = getGameDefinition('alias')
    let s = start()
    const explainerId = wordView(def.view(s, 'a')).explainerId
    if (!explainerId) throw new Error('expected an explainer')
    s = def.reduce(s, { type: 'word/start_round' }, CTX(explainerId)).state
    s = def.reduce(s, { type: 'word/end_round' }, CTX(explainerId)).state
    const before = s
    const eff = def.onTimer(s, 'round', CTX(explainerId, 999_999))
    expect(eff.state).toEqual(before)
    expect(eff.events).toEqual([])
  })

  it('state survives a JSON round-trip after a sequence of actions', () => {
    const def = getGameDefinition('alias')
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
    const def = getGameDefinition('alias')
    const s = start()
    const explainerId = wordView(def.view(s, 'a')).explainerId
    if (!explainerId) throw new Error('expected an explainer')
    const before = JSON.parse(JSON.stringify(s))
    def.reduce(s, { type: 'word/start_round' }, CTX(explainerId))
    expect(s).toEqual(before)
  })

  it('the serialized view for a non-explainer never contains the secret word', () => {
    const def = getGameDefinition('alias')
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
    const other = PLAYERS.find((p) => p !== explainerId)
    if (!other) throw new Error('expected a non-explainer player')
    const serialized = JSON.stringify(def.view(s, other))
    expect(serialized.includes(secretWord)).toBe(false)
  })
})
