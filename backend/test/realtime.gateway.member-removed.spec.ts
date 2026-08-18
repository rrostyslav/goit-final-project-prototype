import type { RoomDto } from '@gp/shared'
import { RealtimeGateway } from '../src/realtime/realtime.gateway'

// ---------------------------------------------------------------------------
// Final-review finding A: a player abandoning a game (evicted after the 45s
// presence grace, kicked, banned, or a plain self-leave) while the room's
// active session still counted them among its `playerIds` used to strand
// the room permanently -- `handleMemberRemoved` only ever reacted to a room
// reaching ZERO members (`handleRoomEmptied`), never a partial loss. See
// `GameRuntimeService.abandonIfPlayerLeft`'s own doc comment (and its unit
// coverage in game-runtime.service.spec.ts) for the two live repros this
// closes and the force-finish-vs-lobby decision. This file covers the
// GATEWAY-side wiring only: does `handleMemberRemoved` call
// `abandonIfPlayerLeft` exactly when it should, and re-broadcast only when
// something actually changed.
//
// Same fakes-over-a-real-DI-container style as `realtime.gateway.draw.spec.ts`
// / `realtime.gateway.room-join.spec.ts` (see either file's own header
// comment) -- `RealtimeGateway` takes 7 constructor dependencies none of
// which this test needs a real NestJS container or a real socket/Redis
// connection for.
// ---------------------------------------------------------------------------

const ROOM_ID = 'room-1'
const USER_ID = 'user-1'

function roomDtoFixture(memberIds: string[]): RoomDto {
  const hostId = memberIds[0] ?? 'host-1'
  return {
    id: ROOM_ID,
    code: 'ABC123',
    visibility: 'public',
    status: 'in_game',
    hostId,
    maxPlayers: 6,
    selectedGameId: 'durak',
    members: memberIds.map((id) => ({
      user: { id, nickname: id, avatarUrl: null, isGuest: true },
      isHost: id === hostId,
      isReady: true,
      connection: 'online' as const,
      joinedAt: new Date().toISOString(),
    })),
    createdAt: new Date().toISOString(),
  }
}

function createGateway(deps: { memberIds: string[]; abandonResult: boolean }) {
  const toDto = jest.fn().mockResolvedValue(roomDtoFixture(deps.memberIds))
  const abandonIfPlayerLeft = jest.fn().mockResolvedValue(deps.abandonResult)
  const handleRoomEmptied = jest.fn().mockResolvedValue(undefined)

  const gateway = Object.create(RealtimeGateway.prototype) as RealtimeGateway
  Object.assign(gateway, {
    logger: { warn: jest.fn(), error: jest.fn() },
    presenceService: {
      cancelEviction: jest.fn(),
      getConnection: jest.fn().mockReturnValue('online'),
    },
    redisService: {
      client: {
        hdel: jest.fn().mockResolvedValue(1),
        hgetall: jest.fn().mockResolvedValue({}),
        del: jest.fn().mockResolvedValue(1),
      },
    },
    roomsService: { toDto },
    gameRuntimeService: { abandonIfPlayerLeft, handleRoomEmptied },
    server: {
      to: () => ({
        emit: () => true,
      }),
    },
  })
  return { gateway, toDto, abandonIfPlayerLeft, handleRoomEmptied }
}

describe('RealtimeGateway.handleMemberRemoved (final-review fix: partial membership loss)', () => {
  it('a departing player while the room still has members triggers abandonIfPlayerLeft and re-broadcasts on success', async () => {
    const { gateway, toDto, abandonIfPlayerLeft } = createGateway({
      memberIds: ['host-1', 'user-2'],
      abandonResult: true,
    })

    await gateway.handleMemberRemoved(ROOM_ID, USER_ID)

    expect(abandonIfPlayerLeft).toHaveBeenCalledWith(ROOM_ID, USER_ID)
    // Once for the unconditional broadcast, once more because a session was
    // actually aborted and the room's status just changed underneath it --
    // everyone still in the room must see it leave in_game/results promptly.
    expect(toDto).toHaveBeenCalledTimes(2)
  })

  it('does not re-broadcast a second time when nothing was actually aborted', async () => {
    const { gateway, toDto, abandonIfPlayerLeft } = createGateway({
      memberIds: ['host-1', 'user-2'],
      abandonResult: false,
    })

    await gateway.handleMemberRemoved(ROOM_ID, USER_ID)

    expect(abandonIfPlayerLeft).toHaveBeenCalledWith(ROOM_ID, USER_ID)
    expect(toDto).toHaveBeenCalledTimes(1)
  })

  it('a room that just emptied calls handleRoomEmptied instead, and never calls abandonIfPlayerLeft', async () => {
    const { gateway, handleRoomEmptied, abandonIfPlayerLeft } = createGateway({
      memberIds: [],
      abandonResult: true,
    })

    await gateway.handleMemberRemoved(ROOM_ID, USER_ID)

    expect(handleRoomEmptied).toHaveBeenCalledWith(ROOM_ID)
    expect(abandonIfPlayerLeft).not.toHaveBeenCalled()
  })
})
