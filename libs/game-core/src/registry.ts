import type { GameId } from '@gp/shared'
import type { GameDefinition } from './contract'
import { aliasDefinition, hatDefinition } from './games/alias'
import { crocodileDefinition } from './games/crocodile'
import { durakDefinition } from './games/durak'
import { nineDefinition } from './games/nine'

/**
 * The game registry. Deliberately typed `Partial<Record<GameId, GameDefinition>>`
 * rather than `Record<GameId, GameDefinition>`: the registry starts empty and
 * Tasks 12-14 populate it one game at a time as their engines load. Claiming all
 * five GameId keys are present up front would be a lie the type checker can't
 * catch, and would defeat the point of getGameDefinition's runtime check below.
 *
 * Each concrete definition keeps its own state type S at registration time (see
 * registerGameDefinition); once stored here it is erased to `unknown`. That
 * erasure is sound rather than an `any` escape hatch because GameDefinition's
 * methods use TypeScript method-shorthand syntax (`reduce(state: S, ...)`, not
 * `reduce: (state: S, ...) => ...`), which the compiler checks bivariantly even
 * under `strict`. A concrete GameDefinition<AliasState> is therefore assignable
 * to GameDefinition<unknown> without a cast, and every consumer of this registry
 * only ever sees the erased, type-safe view: state flows back into
 * reduce()/onTimer() opaquely, and a game's real state shape never leaks outside
 * its own module.
 */
export const GAME_DEFINITIONS: Partial<Record<GameId, GameDefinition>> = {}

/** Registers a game definition. Called once per game, from that game's own module. */
export function registerGameDefinition<S>(definition: GameDefinition<S>): void {
  GAME_DEFINITIONS[definition.id] = definition
}

/** Looks up a registered game definition. Throws if `id` was never registered. */
export function getGameDefinition(id: GameId): GameDefinition {
  const definition = GAME_DEFINITIONS[id]
  if (!definition) {
    throw new Error(`No game definition registered for id "${id}"`)
  }
  return definition
}

// Alias, Hat (Task 12), Durak (Task 13), and Crocodile, Nine (Task 14)
// register themselves here so any caller that only imports the registry -
// not the individual game modules - still finds them.
registerGameDefinition(aliasDefinition)
registerGameDefinition(hatDefinition)
registerGameDefinition(durakDefinition)
registerGameDefinition(crocodileDefinition)
registerGameDefinition(nineDefinition)
