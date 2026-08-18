'use client'

import { useEffect, useState } from 'react'
import { cn } from '@/lib/cn'
import { useI18n } from '@/lib/i18n'

export interface RoundTimerProps {
  /** A server timestamp (`WordGameView.roundEndsAt`, ms since epoch) -- the
   * server's own `onTimer` is what actually ends the round; this component
   * only ever re-renders a countdown FROM that deadline, never invents or
   * extends one itself. `null` while no turn is running yet (`preparing`/
   * `between_rounds`) -- nothing is rendered then. */
  deadline: number | null
  /** `WordGameView.roundPaused` -- true while the current explainer is
   * disconnected. The server clears `roundEndsAt` for the whole time a round
   * is paused (see `pauseRound` in `@gp/game-core`'s word engine), so a
   * naive countdown reading `deadline` alone would either show a stale time
   * or `null`/nothing with no explanation; this flag is checked FIRST so a
   * paused round always shows the translated paused message instead. */
  paused: boolean
}

const TICK_MS = 1_000
/** Below this many remaining ms, the countdown switches to the danger
 * colour -- a plain visual cue that time is about to run out, matching the
 * urgency `<Button variant="danger">` already conveys elsewhere in this UI. */
const URGENT_THRESHOLD_MS = 10_000

export function RoundTimer({ deadline, paused }: RoundTimerProps) {
  const { t } = useI18n()
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (deadline === null) return
    const id = setInterval(() => setNow(Date.now()), TICK_MS)
    return () => clearInterval(id)
  }, [deadline])

  if (paused) {
    return <p className="text-sm font-medium text-danger">{t('game.timerPaused')}</p>
  }
  if (deadline === null) {
    return null
  }

  const remainingMs = Math.max(0, deadline - now)
  const totalSeconds = Math.ceil(remainingMs / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60

  return (
    <p
      className={cn(
        'text-2xl font-bold tabular-nums',
        remainingMs <= URGENT_THRESHOLD_MS ? 'text-danger' : 'text-fg',
      )}
    >
      {minutes}:{String(seconds).padStart(2, '0')}
    </p>
  )
}
