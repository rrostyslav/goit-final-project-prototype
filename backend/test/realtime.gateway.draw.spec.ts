import type { DrawStroke } from '@gp/shared'
import { RealtimeGateway } from '../src/realtime/realtime.gateway'
import type { AppSocket } from '../src/realtime/socket-user'

// ---------------------------------------------------------------------------
// Review findings (Task 18 fix-up), gateway half:
//   1. `draw:stroke`'s broadcast must be `DrawingService.append`'s CANONICAL
//      return value, not the raw request payload.
//   2. Neither `draw:stroke` nor `draw:clear` had a rate limit — an
//      authorized explainer (the check every other test file already trusts)
//      could flood Redis and every room member's socket at transport speed.
//
// `RealtimeGateway` takes 7 constructor dependencies plus a Socket.IO
// `server`, none of which this file needs a real NestJS DI container or a
// real socket for — only `onDrawStroke`/`onDrawClear` and the private
// helpers they call. Bypasses the constructor and installs fakes directly,
// the same `Object.create(Prototype) as T` + `Object.assign` style
// `redis.service.spec.ts` already uses to sidestep `RedisService`'s own
// constructor (which opens a real TCP connection).
// ---------------------------------------------------------------------------

interface FakeDrawContext {
  active: boolean
  explainerId: string | null
}

interface Emitted {
  room: string
  event: string
  payload: unknown
}

function stroke(overrides: Partial<DrawStroke> = {}): DrawStroke {
  return {
    points: [
      [0, 0],
      [1, 1],
    ],
    color: '#ff0000',
    width: 4,
    ...overrides,
  }
}

function createFakeSocket(userId: string): { socket: AppSocket; toEmitted: Emitted[] } {
  const toEmitted: Emitted[] = []
  const socket = {
    data: { user: { id: userId } },
    to: (room: string) => ({
      emit: (event: string, payload: unknown) => {
        toEmitted.push({ room, event, payload })
      },
    }),
  }
  return { socket: socket as unknown as AppSocket, toEmitted }
}

function createGateway(deps: {
  drawContext: FakeDrawContext | null
  rateLimit: jest.Mock
  append: jest.Mock
  isHost?: boolean
  serverEmitted: Emitted[]
}): RealtimeGateway {
  const gateway = Object.create(RealtimeGateway.prototype) as RealtimeGateway
  Object.assign(gateway, {
    logger: { warn: jest.fn(), error: jest.fn() },
    gameRuntimeService: {
      getCrocodileDrawContext: jest.fn().mockResolvedValue(deps.drawContext),
    },
    redisService: { rateLimit: deps.rateLimit },
    drawingService: { append: deps.append, clear: jest.fn(), getAll: jest.fn() },
    roomsService: {
      toDto: jest.fn().mockResolvedValue({ hostId: deps.isHost ? EXPLAINER_ID : 'someone-else' }),
    },
    server: {
      to: (room: string) => ({
        emit: (event: string, payload: unknown) => {
          deps.serverEmitted.push({ room, event, payload })
        },
      }),
    },
  })
  return gateway
}

const ROOM_ID = 'room-1'
const EXPLAINER_ID = 'explainer-1'

describe('RealtimeGateway draw:* handlers (review fix-up)', () => {
  describe('onDrawStroke', () => {
    it('broadcasts the CANONICAL stroke DrawingService.append returns, not the raw payload', async () => {
      const canonical = stroke({ color: '#00ff00' })
      const receivedPayloadStroke = { ...stroke(), evil: 'x'.repeat(1000) } as unknown as DrawStroke
      const serverEmitted: Emitted[] = []
      const gateway = createGateway({
        drawContext: { active: true, explainerId: EXPLAINER_ID },
        rateLimit: jest.fn().mockResolvedValue(true),
        append: jest.fn().mockResolvedValue(canonical),
        serverEmitted,
      })
      const { socket, toEmitted } = createFakeSocket(EXPLAINER_ID)

      await gateway.onDrawStroke(socket, { roomId: ROOM_ID, stroke: receivedPayloadStroke })

      expect(toEmitted).toHaveLength(1)
      expect(toEmitted[0]?.payload).toBe(canonical)
      expect(toEmitted[0]?.payload).not.toBe(receivedPayloadStroke)
      expect(serverEmitted).toHaveLength(0) // no `error` sent to the sender
    })

    it('drops a stroke once the rate limit trips, without emitting an error or storing it', async () => {
      const rateLimit = jest.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false)
      const append = jest.fn().mockResolvedValue(stroke())
      const serverEmitted: Emitted[] = []
      const gateway = createGateway({
        drawContext: { active: true, explainerId: EXPLAINER_ID },
        rateLimit,
        append,
        serverEmitted,
      })
      const { socket, toEmitted } = createFakeSocket(EXPLAINER_ID)

      await gateway.onDrawStroke(socket, { roomId: ROOM_ID, stroke: stroke() })
      await gateway.onDrawStroke(socket, { roomId: ROOM_ID, stroke: stroke() })

      // Only the first (within-limit) stroke was stored and broadcast.
      expect(append).toHaveBeenCalledTimes(1)
      expect(toEmitted).toHaveLength(1)
      // The dropped stroke did not trigger an `error` back to the sender —
      // a rate-limited flood must not become an equally sized `error` flood.
      expect(serverEmitted).toHaveLength(0)
    })

    it('does not drop strokes while the rate limit is not exceeded (normal cadence)', async () => {
      const rateLimit = jest.fn().mockResolvedValue(true)
      const append = jest.fn().mockResolvedValue(stroke())
      const serverEmitted: Emitted[] = []
      const gateway = createGateway({
        drawContext: { active: true, explainerId: EXPLAINER_ID },
        rateLimit,
        append,
        serverEmitted,
      })
      const { socket, toEmitted } = createFakeSocket(EXPLAINER_ID)

      // A burst of 20 strokes — the client's own throttle (~1 per 50ms)
      // over roughly one second — every one of which must go through.
      for (let i = 0; i < 20; i++) {
        await gateway.onDrawStroke(socket, { roomId: ROOM_ID, stroke: stroke() })
      }

      expect(append).toHaveBeenCalledTimes(20)
      expect(toEmitted).toHaveLength(20)
      expect(serverEmitted).toHaveLength(0)
    })

    it('never calls append or the rate limiter for a non-explainer (already rejected earlier)', async () => {
      const rateLimit = jest.fn().mockResolvedValue(true)
      const append = jest.fn()
      const serverEmitted: Emitted[] = []
      const gateway = createGateway({
        drawContext: { active: true, explainerId: 'someone-else' },
        rateLimit,
        append,
        serverEmitted,
      })
      const { socket, toEmitted } = createFakeSocket(EXPLAINER_ID)

      await gateway.onDrawStroke(socket, { roomId: ROOM_ID, stroke: stroke() })

      expect(rateLimit).not.toHaveBeenCalled()
      expect(append).not.toHaveBeenCalled()
      expect(toEmitted).toHaveLength(0)
      expect(serverEmitted).toHaveLength(1) // the `not_explainer` error
    })
  })

  describe('onDrawClear', () => {
    it('drops a clear request once the rate limit trips, without clearing or erroring', async () => {
      const rateLimit = jest.fn().mockResolvedValue(false)
      const serverEmitted: Emitted[] = []
      const gateway = createGateway({
        drawContext: { active: true, explainerId: EXPLAINER_ID },
        rateLimit,
        append: jest.fn(),
        serverEmitted,
      })
      const { socket } = createFakeSocket(EXPLAINER_ID)

      await gateway.onDrawClear(socket, { roomId: ROOM_ID })

      // `draw:sync([])` is what a successful clear broadcasts — its absence
      // here is exactly "the clear was dropped."
      expect(serverEmitted).toHaveLength(0)
    })

    it('clears normally when authorized and within the rate limit', async () => {
      const rateLimit = jest.fn().mockResolvedValue(true)
      const serverEmitted: Emitted[] = []
      const gateway = createGateway({
        drawContext: { active: true, explainerId: EXPLAINER_ID },
        rateLimit,
        append: jest.fn(),
        serverEmitted,
      })
      const { socket } = createFakeSocket(EXPLAINER_ID)

      await gateway.onDrawClear(socket, { roomId: ROOM_ID })

      expect(serverEmitted).toContainEqual({ room: ROOM_ID, event: 'draw:sync', payload: [] })
    })
  })
})
