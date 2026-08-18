'use client'

import type { WordGameView } from '@gp/shared'
import { WordGameScreen } from '@/components/games/word/word-game-screen'
import { DrawingCanvas } from './drawing-canvas'

export interface CrocodileScreenProps {
  view: WordGameView
}

/**
 * Crocodile reuses `<WordGameScreen/>` exactly as Alias/Hat do -- its
 * `TeamScoreboard`/`RoundTimer`/turn machinery are all identical, per-player
 * `TeamView`s and all (see `team-scoreboard.tsx`'s doc comment). The one
 * thing genuinely specific to Crocodile is the drawing canvas, slotted into
 * whichever of `<ExplainerControls/>`/`<GuesserView/>` renders via
 * `renderExtra` -- `mode="draw"` for the explainer (who is `view.explainerId`
 * and therefore the only one authorized to draw -- see
 * `RealtimeGateway.onDrawStroke`), `mode="watch"` for everyone else.
 */
export function CrocodileScreen({ view }: CrocodileScreenProps) {
  return (
    <WordGameScreen
      view={view}
      renderExtra={(isExplainer) => <DrawingCanvas mode={isExplainer ? 'draw' : 'watch'} />}
    />
  )
}
