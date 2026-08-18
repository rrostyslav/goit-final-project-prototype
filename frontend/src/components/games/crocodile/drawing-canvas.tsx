'use client'

import type { DrawStroke } from '@gp/shared'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { useEffect, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/cn'
import { useI18n } from '@/lib/i18n'
import { useRoomStore } from '@/lib/stores/room-store'

export interface DrawingCanvasProps {
  /** `'draw'` is only ever passed for the current Crocodile explainer (see
   * `crocodile-screen.tsx`) -- every pointer handler below still no-ops in
   * `'watch'` mode as a second, structural guard: even a mis-wired caller
   * cannot make a `'watch'` canvas emit a stroke. */
  mode: 'draw' | 'watch'
}

// ---------------------------------------------------------------------------
// Coordinate space
//
// Ambiguity resolution (per this task's brief): every point in a `DrawStroke`
// is expressed in a fixed, resolution-independent VIRTUAL space --
// [0, VIRTUAL_WIDTH] x [0, VIRTUAL_HEIGHT] -- never in raw on-screen pixels
// and never adjusted for devicePixelRatio. The `<canvas>` element's CSS box
// is locked to the exact same aspect ratio (5:3) via the wrapper's
// `aspect-[5/3]` class, so converting a pointer event's CSS-pixel position
// into this virtual space (`toVirtual`) and converting a virtual point back
// into THIS client's own CSS-pixel size (`toPixel`) are simple linear scales
// -- no letterboxing, no distortion. A point at virtual (500, 300) is always
// the visual centre of the box, whether this client's box is 400px or 1200px
// wide, on a 1x or 3x devicePixelRatio screen. devicePixelRatio only ever
// affects the canvas's own BACKING STORE size (`resize` below) so lines stay
// crisp on a high-DPI screen -- it never enters the point math itself, which
// is why strokes drawn on one client land in the same place on every other.
// ---------------------------------------------------------------------------
const VIRTUAL_WIDTH = 1000
const VIRTUAL_HEIGHT = 600

const PEN_COLOR = '#1a1a2e'
const PEN_WIDTH = 6
/** Per the brief: "throttled to one emit per 50 ms". A continuous
 * pointer-down -> pointer-up gesture is segmented into short bursts of
 * points captured within each 50ms window rather than sent as one giant
 * growing stroke -- see `flush` below -- which happens to match
 * `RealtimeGateway`'s own `DRAW_STROKE_RATE_LIMIT_MAX`/`_WINDOW_MS` doc
 * comment ("The frontend throttles strokes to ~1 per 50ms (~20/s)") almost
 * exactly, with headroom to spare. */
const FLUSH_INTERVAL_MS = 50

type Point = [number, number]
interface BoxSize {
  width: number
  height: number
}

function toVirtual(clientX: number, clientY: number, rect: DOMRect): Point {
  const x = ((clientX - rect.left) / rect.width) * VIRTUAL_WIDTH
  const y = ((clientY - rect.top) / rect.height) * VIRTUAL_HEIGHT
  return [x, y]
}

function toPixel(point: Point, box: BoxSize): Point {
  return [(point[0] / VIRTUAL_WIDTH) * box.width, (point[1] / VIRTUAL_HEIGHT) * box.height]
}

function strokeLineWidth(width: number, box: BoxSize): number {
  return Math.max(1, (width / VIRTUAL_WIDTH) * box.width)
}

function paintStroke(ctx: CanvasRenderingContext2D, stroke: DrawStroke, box: BoxSize): void {
  const first = stroke.points[0]
  if (!first) return
  ctx.strokeStyle = stroke.color
  ctx.lineWidth = strokeLineWidth(stroke.width, box)
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.beginPath()
  const [x0, y0] = toPixel(first, box)
  ctx.moveTo(x0, y0)
  if (stroke.points.length === 1) {
    // A single-point "stroke" is a tap/dot -- draw a vanishingly short line
    // so the round line cap still renders a visible dot.
    ctx.lineTo(x0 + 0.01, y0 + 0.01)
  } else {
    for (const point of stroke.points.slice(1)) {
      const [x, y] = toPixel(point, box)
      ctx.lineTo(x, y)
    }
  }
  ctx.stroke()
}

function repaintAll(ctx: CanvasRenderingContext2D, strokes: DrawStroke[], box: BoxSize): void {
  ctx.clearRect(0, 0, box.width, box.height)
  for (const stroke of strokes) {
    paintStroke(ctx, stroke, box)
  }
}

/**
 * `<canvas>` shared by the Crocodile explainer (`mode="draw"`) and every
 * other viewer (`mode="watch"`), backed by `useRoomStore`'s `strokes` --
 * see that store's own doc comment for the `draw:sync`/`draw:stroke`
 * listeners that keep it current, including the full replay a late joiner
 * gets via `draw:sync` before this component ever mounts.
 */
export function DrawingCanvas({ mode }: DrawingCanvasProps) {
  const { t } = useI18n()
  const strokes = useRoomStore((s) => s.strokes)
  const sendStroke = useRoomStore((s) => s.sendStroke)
  const clearDrawing = useRoomStore((s) => s.clearDrawing)

  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null)
  const boxRef = useRef<BoxSize>({ width: 0, height: 0 })
  const strokesRef = useRef<DrawStroke[]>(strokes)

  const isDrawingRef = useRef(false)
  const currentPointsRef = useRef<Point[]>([])
  const lastFlushPointRef = useRef<Point | null>(null)
  const lastEmitAtRef = useRef(0)

  // Sizes the canvas's backing store to its CSS box * devicePixelRatio (so
  // strokes stay crisp on a high-DPI screen) and repaints the full history
  // whenever that box changes -- on mount, and on every resize the
  // ResizeObserver reports. The virtual coordinates themselves never change
  // here (see the module doc comment above); only the pixel scale they are
  // converted through does.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctxRef.current = ctx

    function resize() {
      if (!canvas || !ctx) return
      const rect = canvas.getBoundingClientRect()
      const dpr = window.devicePixelRatio || 1
      canvas.width = Math.max(1, Math.round(rect.width * dpr))
      canvas.height = Math.max(1, Math.round(rect.height * dpr))
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      boxRef.current = { width: rect.width, height: rect.height }
      repaintAll(ctx, strokesRef.current, boxRef.current)
    }

    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(canvas)
    return () => observer.disconnect()
  }, [])

  // Every committed-log change -- an incoming `draw:stroke`, a `draw:sync`
  // full replace/clear, or this client's own optimistic append from
  // `sendStroke` -- repaints from scratch. Simpler and, at this log's
  // bounded size (`DRAW_STROKE_LOG_LIMIT`, 2000 short polylines), cheap
  // enough to redo on every change rather than tracking an incremental diff.
  useEffect(() => {
    strokesRef.current = strokes
    const ctx = ctxRef.current
    if (!ctx) return
    repaintAll(ctx, strokes, boxRef.current)
  }, [strokes])

  function flush(): void {
    const points = currentPointsRef.current
    if (points.length === 0) return
    // Carries the previous flush's last point over as this segment's first
    // point, so consecutive segments of the same gesture connect edge to
    // edge when replayed on another client instead of leaving a visible gap.
    const toSend = lastFlushPointRef.current ? [lastFlushPointRef.current, ...points] : points
    sendStroke({ points: toSend, color: PEN_COLOR, width: PEN_WIDTH })
    lastFlushPointRef.current = points[points.length - 1] ?? null
    currentPointsRef.current = []
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLCanvasElement>): void {
    if (mode !== 'draw') return
    event.currentTarget.setPointerCapture(event.pointerId)
    const rect = event.currentTarget.getBoundingClientRect()
    isDrawingRef.current = true
    currentPointsRef.current = [toVirtual(event.clientX, event.clientY, rect)]
    lastFlushPointRef.current = null
    lastEmitAtRef.current = performance.now()
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLCanvasElement>): void {
    if (mode !== 'draw' || !isDrawingRef.current) return
    const rect = event.currentTarget.getBoundingClientRect()
    const point = toVirtual(event.clientX, event.clientY, rect)
    const prev = currentPointsRef.current[currentPointsRef.current.length - 1]
    currentPointsRef.current.push(point)

    // Immediate local feedback -- draws just the new segment directly,
    // without waiting for the `strokes` round trip through the store.
    const ctx = ctxRef.current
    if (ctx && prev) {
      ctx.strokeStyle = PEN_COLOR
      ctx.lineWidth = strokeLineWidth(PEN_WIDTH, boxRef.current)
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.beginPath()
      const [x0, y0] = toPixel(prev, boxRef.current)
      const [x1, y1] = toPixel(point, boxRef.current)
      ctx.moveTo(x0, y0)
      ctx.lineTo(x1, y1)
      ctx.stroke()
    }

    const nowMs = performance.now()
    if (nowMs - lastEmitAtRef.current >= FLUSH_INTERVAL_MS) {
      flush()
      lastEmitAtRef.current = nowMs
    }
  }

  function handlePointerUp(event: ReactPointerEvent<HTMLCanvasElement>): void {
    if (mode !== 'draw' || !isDrawingRef.current) return
    isDrawingRef.current = false
    flush()
    event.currentTarget.releasePointerCapture(event.pointerId)
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm font-semibold text-fg-muted">{t('game.drawingTitle')}</p>
      <div className="aspect-[5/3] w-full overflow-hidden rounded-xl border border-border bg-white">
        <canvas
          ref={canvasRef}
          role="img"
          aria-label={t('game.canvasLabel')}
          className={cn('block h-full w-full touch-none', mode === 'draw' && 'cursor-crosshair')}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
        />
      </div>
      {mode === 'draw' ? (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="self-start"
          onClick={() => clearDrawing()}
        >
          {t('game.clearCanvas')}
        </Button>
      ) : null}
    </div>
  )
}
