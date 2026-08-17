import type { PublicUser } from '@gp/shared'
import { Body, Controller, Get, Patch, Query, UseGuards } from '@nestjs/common'
import { CurrentUser } from '../auth/decorators/current-user.decorator'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'
import { UpdateProfileDto } from './dto/update-profile.dto'
import { UsersService } from './users.service'

const DEFAULT_SEARCH_LIMIT = 20
const MAX_SEARCH_LIMIT = 50

@Controller('users')
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

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
}

function parseLimit(raw: string | undefined): number {
  const parsed = raw ? Number.parseInt(raw, 10) : DEFAULT_SEARCH_LIMIT
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_SEARCH_LIMIT
  }
  return Math.min(parsed, MAX_SEARCH_LIMIT)
}
