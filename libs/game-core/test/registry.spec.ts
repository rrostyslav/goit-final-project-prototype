import { describe, expect, it } from 'vitest'
import { getGameDefinition, registerGameDefinition } from '../src/registry'

describe('registry', () => {
  it('throws a clear error for an unregistered game id', () => {
    // 'nine' is a valid GameId but nothing registers it in this test file.
    expect(() => getGameDefinition('nine')).toThrow(/nine/)
  })

  it('returns a definition after it has been registered', () => {
    interface FakeState {
      round: number
    }

    registerGameDefinition<FakeState>({
      id: 'crocodile',
      meta: {
        id: 'crocodile',
        engine: 'word',
        titleKey: 'game.crocodile',
        minPlayers: 3,
        maxPlayers: 10,
        teamBased: false,
      },
      init: () => ({ round: 0 }),
      reduce: (state) => ({ state, events: [] }),
      onTimer: (state) => ({ state, events: [] }),
      view: () => ({
        kind: 'word',
        gameId: 'crocodile',
        phase: 'preparing',
        round: 0,
        totalRounds: 0,
        teams: [],
        activeTeamId: null,
        explainerId: null,
        secretWord: null,
        roundEndsAt: null,
        roundPaused: false,
        lastResults: [],
        winnerTeamIds: [],
      }),
      results: () => [],
    })

    expect(getGameDefinition('crocodile').id).toBe('crocodile')
  })
})
