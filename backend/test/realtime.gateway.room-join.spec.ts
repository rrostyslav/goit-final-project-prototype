import type { RoomDto } from '@gp/shared'
import { RealtimeGateway } from '../src/realtime/realtime.gateway'
import type { AppSocket } from '../src/realtime/socket-user'

// ---------------------------------------------------------------------------
// Review finding (Task 21 fix-up): a member who joins (or reconnects) after
// votes were already cast saw no tally at all until the next `room:vote_game`
// broadcast -- `onRoomJoin` never sent `room:votes` to the newly-joined
// socket, unlike `draw:sync`, which already catches a joiner up on the
// drawing channel. Fixed by emitting the current tally to the joining socket
// directly, in the same shape `onVoteGame`/`handleMemberRemoved` broadcast.
//
// Same fakes-over-a-real-DI-container style as
// `realtime.gateway.draw.spec.ts` (see that file's own header comment) --
// `RealtimeGateway` takes 7 constructor dependencies none of which this test
// needs a real NestJS container or a real socket/Redis connection for.
// ---------------------------------------------------------------------------

interface Emitted {
  event: string
  payload: unknown
}

const ROOM_ID = 'room-1'
const USER_ID = 'user-1'

function roomDtoFixture(status: RoomDto['status'] = 'lobby'): RoomDto {
  return {
    id: ROOM_ID,
    code: 'ABC123',
    visibility: 'public',
    status,
    hostId: 'host-1',
    maxPlayers: 6,
    selectedGameId: null,
    members: [],
    createdAt: new Date().toISOString(),
  }
}

function createFakeSocket(userId: string): { socket: AppSocket; emitted: Emitted[] } {
  const emitted: Emitted[] = []
  const socket = {
    id: 'socket-1',
    data: { user: { id: userId } },
    join: jest.fn().mockResolvedValue(undefined),
    emit: (event: string, payload: unknown) => {
      emitted.push({ event, payload })
      return true
    },
  }
  return { socket: socket as unknown as AppSocket, emitted }
}

function createGateway(deps: {
  votesHash: Record<string, string>
  drawContext?: { active: boolean; explainerId: string | null } | null
  roomStatus?: RoomDto['status']
  lastStandings?: { sessionId: string; standings: unknown[] } | null
}): RealtimeGateway {
  const gateway = Object.create(RealtimeGateway.prototype) as RealtimeGateway
  Object.assign(gateway, {
    logger: { warn: jest.fn(), error: jest.fn() },
    redisService: {
      withLock: jest.fn(async (_key: string, fn: () => Promise<unknown>) => fn()),
      client: { hgetall: jest.fn().mockResolvedValue(deps.votesHash) },
    },
    roomsService: {
      join: jest.fn().mockResolvedValue(undefined),
      toDto: jest.fn().mockResolvedValue(roomDtoFixture(deps.roomStatus)),
    },
    presenceService: {
      markOnline: jest.fn(),
      getConnection: jest.fn().mockReturnValue('online'),
    },
    gameRuntimeService: {
      resumeAfterReconnect: jest.fn().mockResolvedValue(undefined),
      getCrocodileDrawContext: jest.fn().mockResolvedValue(deps.drawContext ?? null),
      getLastStandings: jest.fn().mockResolvedValue(deps.lastStandings ?? null),
    },
    drawingService: {
      getAll: jest.fn().mockResolvedValue([]),
    },
    server: {
      to: () => ({ emit: jest.fn() }),
    },
  })
  return gateway
}

describe('RealtimeGateway.onRoomJoin (review fix-up)', () => {
  it('sends the current vote tally to the joining socket, not just the room broadcast', async () => {
    const gateway = createGateway({
      votesHash: { 'voter-a': 'alias', 'voter-b': 'alias', 'voter-c': 'hat' },
    })
    const { socket, emitted } = createFakeSocket(USER_ID)

    await gateway.onRoomJoin(socket, { roomId: ROOM_ID })

    const votesEmit = emitted.find((e) => e.event === 'room:votes')
    expect(votesEmit).toBeDefined()
    expect(votesEmit?.payload).toEqual({ alias: ['voter-a', 'voter-b'], hat: ['voter-c'] })
  })

  it('sends an empty tally (not nothing) when nobody has voted yet', async () => {
    const gateway = createGateway({ votesHash: {} })
    const { socket, emitted } = createFakeSocket(USER_ID)

    await gateway.onRoomJoin(socket, { roomId: ROOM_ID })

    const votesEmit = emitted.find((e) => e.event === 'room:votes')
    expect(votesEmit).toBeDefined()
    expect(votesEmit?.payload).toEqual({})
  })

  it('still catches the joiner up on the drawing channel alongside the vote tally', async () => {
    const gateway = createGateway({
      votesHash: { 'voter-a': 'crocodile' },
      drawContext: { active: true, explainerId: 'voter-a' },
    })
    const { socket, emitted } = createFakeSocket(USER_ID)

    await gateway.onRoomJoin(socket, { roomId: ROOM_ID })

    expect(emitted.map((e) => e.event)).toEqual(expect.arrayContaining(['draw:sync', 'room:votes']))
  })

  // -------------------------------------------------------------------
  // Final-review finding F: standings vanish on reload during the 8s
  // results window, since `game:ended` is push-only and the frontend
  // store's `standings` only ever resets (never backfills). `onRoomJoin`
  // now replays a still-fresh standings snapshot to the joining socket
  // whenever the room is `results` -- see
  // `GameRuntimeService.getLastStandings`'s own doc comment.
  // -------------------------------------------------------------------
  it('backfills game:ended to a socket that joins while the room is still results', async () => {
    const standings = [{ playerId: 'voter-a', score: 3, placement: 1 }]
    const gateway = createGateway({
      votesHash: {},
      roomStatus: 'results',
      lastStandings: { sessionId: 'session-1', standings },
    })
    const { socket, emitted } = createFakeSocket(USER_ID)

    await gateway.onRoomJoin(socket, { roomId: ROOM_ID })

    const ended = emitted.find((e) => e.event === 'game:ended')
    expect(ended?.payload).toEqual({ sessionId: 'session-1', standings })
  })

  it('does not emit game:ended when the room is results but nothing is stored (TTL expired)', async () => {
    const gateway = createGateway({ votesHash: {}, roomStatus: 'results', lastStandings: null })
    const { socket, emitted } = createFakeSocket(USER_ID)

    await gateway.onRoomJoin(socket, { roomId: ROOM_ID })

    expect(emitted.some((e) => e.event === 'game:ended')).toBe(false)
  })

  it('never emits game:ended for a room that is not in results', async () => {
    const gateway = createGateway({
      votesHash: {},
      roomStatus: 'lobby',
      lastStandings: { sessionId: 'session-1', standings: [] },
    })
    const { socket, emitted } = createFakeSocket(USER_ID)

    await gateway.onRoomJoin(socket, { roomId: ROOM_ID })

    expect(emitted.some((e) => e.event === 'game:ended')).toBe(false)
  })
})
