import type { MatchHistoryEntry, PublicUser } from '@gp/shared'
import { Body, Controller, Get, Param, Patch, Query, UseGuards } from '@nestjs/common'
import { CurrentUser } from '../auth/decorators/current-user.decorator'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'
import { GameHistoryService } from '../games/game-history.service'
import { UpdateProfileDto } from './dto/update-profile.dto'
import { UsersService } from './users.service'

const DEFAULT_SEARCH_LIMIT = 20
const MAX_SEARCH_LIMIT = 50
const DEFAULT_HISTORY_LIMIT = 20
const MAX_HISTORY_LIMIT = 50

@Controller('users')
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly gameHistoryService: GameHistoryService,
  ) {}

  @Get('me')
  me(@CurrentUser() user: PublicUser): PublicUser {
    return user
  }

  @Patch('me')
  updateMe(@CurrentUser() user: PublicUser, @Body() dto: UpdateProfileDto): Promise<PublicUser> {
    return this.usersService.updateProfile(user.id, dto)
  }

  @Get('search')
  search(
    @CurrentUser() user: PublicUser,
    @Query('q') q?: string,
    @Query('limit') limit?: string,
  ): Promise<PublicUser[]> {
    return this.usersService.searchByNickname(q ?? '', parseLimit(limit), user.id)
  }

  /** Task 8 left this route out because `GameHistoryService` did not exist
   * yet (it needs `GameSession`/`GameResult`, added in Task 5/6 and only
   * ever written by Task 16's `GameRuntimeService.finish`). Not restricted
   * to the caller's own id — a `MatchHistoryEntry` carries nothing private
   * (score/placement/gameId/roomCode/playerCount/endedAt), so any
   * authenticated user may view any user's match history, same as
   * `GET /users/search` imposes no ownership check either. */
  @Get(':id/history')
  history(@Param('id') id: string, @Query('limit') limit?: string): Promise<MatchHistoryEntry[]> {
    return this.gameHistoryService.listForUser(id, parseHistoryLimit(limit))
  }
}

function parseLimit(raw: string | undefined): number {
  const parsed = raw ? Number.parseInt(raw, 10) : DEFAULT_SEARCH_LIMIT
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_SEARCH_LIMIT
  }
  return Math.min(parsed, MAX_SEARCH_LIMIT)
}

function parseHistoryLimit(raw: string | undefined): number {
  const parsed = raw ? Number.parseInt(raw, 10) : DEFAULT_HISTORY_LIMIT
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_HISTORY_LIMIT
  }
  return Math.min(parsed, MAX_HISTORY_LIMIT)
}
