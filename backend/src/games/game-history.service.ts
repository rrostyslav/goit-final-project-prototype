import type { GameId, MatchHistoryEntry, UserId } from '@gp/shared'
import { Injectable } from '@nestjs/common'
import { InjectModel } from '@nestjs/sequelize'
import { GameResult } from '../database/models/game-result.model'
import { GameSession } from '../database/models/game-session.model'
import { Room } from '../database/models/room.model'

/** Read model for `GET /api/users/:id/history` (Task 8 left this route out
 * because this service — and `GameResult`/`GameSession` — did not exist
 * yet). Deliberately three flat queries plus in-memory joining rather than
 * a single Sequelize `include` chain: a `GameResult` row only carries
 * `sessionId`/`userId`/`score`/`placement` (see Task 5's model), so turning
 * that into a `MatchHistoryEntry` needs the owning session's `gameId`/
 * `endedAt` and that session's room's `code`, plus a count of every
 * `GameResult` row sharing the session (`playerCount`) — small, bounded
 * batch queries at this prototype's scale, easier to reason about than a
 * multi-level `include` + associated-column `order`. */
@Injectable()
export class GameHistoryService {
  constructor(
    @InjectModel(GameResult) private readonly gameResultModel: typeof GameResult,
    @InjectModel(GameSession) private readonly gameSessionModel: typeof GameSession,
    @InjectModel(Room) private readonly roomModel: typeof Room,
  ) {}

  async listForUser(userId: UserId, limit: number): Promise<MatchHistoryEntry[]> {
    const ownResults = await this.gameResultModel.findAll({ where: { userId } })
    if (ownResults.length === 0) {
      return []
    }

    const sessionIds = [...new Set(ownResults.map((r) => r.sessionId))]
    const sessions = await this.gameSessionModel.findAll({ where: { id: sessionIds } })
    const sessionById = new Map(sessions.map((session) => [session.id, session]))

    const roomIds = [...new Set(sessions.map((session) => session.roomId))]
    const rooms = roomIds.length > 0 ? await this.roomModel.findAll({ where: { id: roomIds } }) : []
    const roomById = new Map(rooms.map((room) => [room.id, room]))

    // Every GameResult row for these sessions (not just this user's own),
    // purely to count participants per session — playerCount is a fact
    // about the match, not about the requesting user.
    const allResultsForSessions = await this.gameResultModel.findAll({
      where: { sessionId: sessionIds },
    })
    const playerCountBySession = new Map<string, number>()
    for (const row of allResultsForSessions) {
      playerCountBySession.set(row.sessionId, (playerCountBySession.get(row.sessionId) ?? 0) + 1)
    }

    const entries: MatchHistoryEntry[] = []
    for (const result of ownResults) {
      const session = sessionById.get(result.sessionId)
      // A GameResult row is only ever written by `GameRuntimeService.finish`
      // in the same transaction-free sequence that also sets `endedAt` — a
      // missing session or a still-null `endedAt` should not happen, but
      // skipping rather than throwing keeps one inconsistent row from
      // breaking a user's whole history view.
      if (!session?.endedAt) {
        continue
      }
      const room = roomById.get(session.roomId)
      entries.push({
        sessionId: result.sessionId,
        gameId: session.gameId as GameId,
        roomCode: room?.code ?? '',
        score: result.score,
        placement: result.placement,
        playerCount: playerCountBySession.get(result.sessionId) ?? 1,
        endedAt: session.endedAt.toISOString(),
      })
    }

    return entries
      .sort((a, b) => new Date(b.endedAt).getTime() - new Date(a.endedAt).getTime())
      .slice(0, limit)
  }
}
