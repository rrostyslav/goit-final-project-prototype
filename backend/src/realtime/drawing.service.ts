import type { DrawStroke, RoomId } from '@gp/shared'
import { DRAW_STROKE_LOG_LIMIT } from '@gp/shared'
import { BadRequestException, Injectable } from '@nestjs/common'
import { RedisService } from '../redis/redis.service'

/** Fixed per the brief's ambiguity resolution: "TTL 2 hours." Refreshed on
 * every `append` (see that method) rather than set once, so an active
 * drawing channel's log never expires mid-game — only a room that stops
 * receiving strokes for a full 2h window loses its log, which is the
 * "ephemeral" behaviour this channel deliberately wants (see this task's
 * report for why strokes are never persisted to Postgres or folded into
 * game state). */
const TTL_SECONDS = 2 * 60 * 60

/**
 * Hard bounds on an untrusted, client-supplied `DrawStroke`, enforced by
 * `append` before anything is written to Redis or (by the caller,
 * `RealtimeGateway`) broadcast to the room. A client is not trusted merely
 * because it is the current Crocodile explainer — that only proves WHO may
 * draw, not that any single stroke they send is a sane one:
 *
 * - `points`: 1..512. A single stroke is one continuous pointer-down ->
 *   pointer-up gesture; 512 sampled points is generously more than a fast
 *   sketch produces, while still bounding both the Redis payload size and
 *   the socket broadcast size per stroke.
 * - each point's x/y: finite, within +/-100,000. Wide enough to cover any
 *   plausible canvas coordinate system (pixel or otherwise) without knowing
 *   the frontend's actual canvas size in advance (Phase 6, not yet built),
 *   while still rejecting NaN/Infinity and obviously out-of-range attack
 *   payloads.
 * - `color`: a non-empty string, at most 32 characters (comfortably covers
 *   `#rrggbb`/`#rrggbbaa`/`rgba(...)`/named CSS colours; rejects a client
 *   trying to stuff an arbitrarily large string into every stroke).
 * - `width`: finite, within [1, 40] — a plausible brush pixel width range.
 */
export const DRAW_STROKE_MAX_POINTS = 512
export const DRAW_STROKE_MIN_COORD = -100_000
export const DRAW_STROKE_MAX_COORD = 100_000
export const DRAW_STROKE_MAX_COLOR_LENGTH = 32
export const DRAW_STROKE_MIN_WIDTH = 1
export const DRAW_STROKE_MAX_WIDTH = 40

/** Review finding (Task 18 fix-up): the bounds above only ever checked
 * `points`/`color`/`width` — nothing rejected an EXTRA top-level property, so
 * a stroke carrying a legitimate `points`/`color`/`width` plus, say, a
 * 500KB junk field sailed through `assertValidStroke` untouched. Every key
 * on an incoming stroke must be one of these three, or the whole stroke is
 * rejected (`BAD_REQUEST`, same code every other bound violation in this
 * file already uses) before any of the size/shape checks below even run. */
export const DRAW_STROKE_ALLOWED_KEYS: ReadonlySet<string> = new Set(['points', 'color', 'width'])

function drawKey(roomId: RoomId): string {
  return `draw:${roomId}`
}

/**
 * The ephemeral Crocodile drawing channel: a per-room Redis list of the
 * strokes drawn so far this round, deliberately kept OUTSIDE the game
 * reducer's own state (see `@gp/game-core`'s word engine — no game ever
 * reads or writes a stroke) so a stroke can never become part of a
 * `GameSession.state` row or a `GameResult`. `RealtimeGateway` is the only
 * caller: it decides WHO may call `append`/`clear` (the current explainer,
 * or the room host for `clear`) and WHEN a joining/late socket receives the
 * current log (`draw:sync`) — this service only owns the Redis storage and
 * the stroke's own shape validation.
 */
@Injectable()
export class DrawingService {
  constructor(private readonly redisService: RedisService) {}

  /** Validates `stroke` (throws `BadRequestException` — see the exported
   * bounds above — for anything outside them; nothing is written to Redis
   * on that path), appends it to the room's log, trims the log to the last
   * `DRAW_STROKE_LOG_LIMIT` entries, and refreshes the key's TTL.
   *
   * Returns the CANONICAL stroke that was actually stored, not the object
   * the caller passed in. Review finding (Task 18 fix-up): the raw,
   * caller-supplied object must never reach `JSON.stringify` or a broadcast
   * — `assertValidStroke` only checked that `points`/`color`/`width` were
   * present and in-bounds, it never bounded the wire payload as a whole (an
   * object satisfying every one of those checks could still carry an
   * arbitrary extra property of any size). Unknown top-level keys are now
   * rejected outright (see `assertValidStroke`), and this method additionally
   * rebuilds a fresh object containing only the three known fields before
   * anything is written or handed back to the caller — belt-and-suspenders,
   * so a caller (`RealtimeGateway.onDrawStroke`) that broadcasts this
   * method's return value instead of the request payload can never leak
   * more than `points`/`color`/`width` regardless of what future validation
   * gaps might otherwise let through. */
  async append(roomId: RoomId, stroke: DrawStroke): Promise<DrawStroke> {
    assertValidStroke(stroke)
    const canonical = toCanonicalStroke(stroke)
    const key = drawKey(roomId)
    await this.redisService.client.rpush(key, JSON.stringify(canonical))
    // Keeps the most recent DRAW_STROKE_LOG_LIMIT entries: LTRIM's negative
    // indices count from the tail, so `-LIMIT..-1` is exactly "the last
    // LIMIT elements," regardless of how many are actually in the list yet.
    await this.redisService.client.ltrim(key, -DRAW_STROKE_LOG_LIMIT, -1)
    await this.redisService.client.expire(key, TTL_SECONDS)
    return canonical
  }

  /** Empties a room's drawing log — called both for an explicit
   * `draw:clear` (explainer or host) and automatically by
   * `GameRuntimeService` when a new Crocodile round starts (see
   * `RealtimeGateway.clearDrawing`, which wraps this with the `draw:sync`
   * broadcast). A no-op, not an error, when the room has no log yet. */
  async clear(roomId: RoomId): Promise<void> {
    await this.redisService.client.del(drawKey(roomId))
  }

  /** The full current log, oldest first (matches Redis list insertion
   * order — `append` only ever `RPUSH`es) — what a joining socket receives
   * as `draw:sync` to catch up on the round in progress. */
  async getAll(roomId: RoomId): Promise<DrawStroke[]> {
    const raw = await this.redisService.client.lrange(drawKey(roomId), 0, -1)
    return raw.map((entry) => JSON.parse(entry) as DrawStroke)
  }
}

/** Treats `value` as genuinely untrusted wire data — not merely as an
 * already-typed `DrawStroke` — since the compile-time `DrawStroke` type on
 * `ClientToServerEvents['draw:stroke']` describes the wire CONTRACT, not
 * what a client actually sends. Every field is re-checked at runtime
 * regardless of what TypeScript believes its type already is. */
function assertValidStroke(value: unknown): asserts value is DrawStroke {
  if (typeof value !== 'object' || value === null) {
    throw new BadRequestException('stroke must be an object')
  }
  const obj = value as Record<string, unknown>

  const unexpectedKey = Object.keys(obj).find((key) => !DRAW_STROKE_ALLOWED_KEYS.has(key))
  if (unexpectedKey !== undefined) {
    throw new BadRequestException(`stroke has an unexpected property: "${unexpectedKey}"`)
  }

  const points = obj.points
  if (!Array.isArray(points) || points.length === 0) {
    throw new BadRequestException('stroke must have at least one point')
  }
  if (points.length > DRAW_STROKE_MAX_POINTS) {
    throw new BadRequestException(`stroke exceeds ${DRAW_STROKE_MAX_POINTS} points`)
  }
  for (const point of points) {
    if (!isValidPoint(point)) {
      throw new BadRequestException('stroke contains an invalid point')
    }
  }

  const color = obj.color
  if (
    typeof color !== 'string' ||
    color.length === 0 ||
    color.length > DRAW_STROKE_MAX_COLOR_LENGTH
  ) {
    throw new BadRequestException(
      `stroke color must be a non-empty string of at most ${DRAW_STROKE_MAX_COLOR_LENGTH} characters`,
    )
  }

  const width = obj.width
  if (
    typeof width !== 'number' ||
    !Number.isFinite(width) ||
    width < DRAW_STROKE_MIN_WIDTH ||
    width > DRAW_STROKE_MAX_WIDTH
  ) {
    throw new BadRequestException(
      `stroke width must be a number between ${DRAW_STROKE_MIN_WIDTH} and ${DRAW_STROKE_MAX_WIDTH}`,
    )
  }
}

/** Rebuilds `stroke` as a brand-new object containing only `points`, `color`
 * and `width` — called only after `assertValidStroke` has already narrowed
 * `stroke` to exactly those three keys, so this never silently drops a field
 * a caller actually needed. Points are copied into fresh `[number, number]`
 * pairs (not just `.slice()`d) so nothing beyond the two numeric coordinates
 * — extra array entries, non-index properties, etc. — can ride along inside
 * a "point." See `append`'s doc comment for why this exists as a second,
 * independent layer under the unknown-key rejection above. */
function toCanonicalStroke(stroke: DrawStroke): DrawStroke {
  return {
    points: stroke.points.map((point): [number, number] => [point[0], point[1]]),
    color: stroke.color,
    width: stroke.width,
  }
}

function isValidPoint(point: unknown): boolean {
  return (
    Array.isArray(point) && point.length === 2 && isFiniteCoord(point[0]) && isFiniteCoord(point[1])
  )
}

function isFiniteCoord(value: unknown): boolean {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= DRAW_STROKE_MIN_COORD &&
    value <= DRAW_STROKE_MAX_COORD
  )
}
