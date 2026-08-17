import type { PublicUser } from '@gp/shared'
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common'
import { CurrentUser } from '../auth/decorators/current-user.decorator'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'
import { SendFriendRequestDto } from './dto/send-friend-request.dto'
import { type FriendRequestView, FriendsService } from './friends.service'

@Controller('friends')
@UseGuards(JwtAuthGuard)
export class FriendsController {
  constructor(private readonly friendsService: FriendsService) {}

  @Get()
  listFriends(@CurrentUser() user: PublicUser): Promise<PublicUser[]> {
    return this.friendsService.listFriends(user.id)
  }

  @Get('incoming')
  listIncoming(@CurrentUser() user: PublicUser): Promise<FriendRequestView[]> {
    return this.friendsService.listIncoming(user.id)
  }

  @Get('outgoing')
  listOutgoing(@CurrentUser() user: PublicUser): Promise<FriendRequestView[]> {
    return this.friendsService.listOutgoing(user.id)
  }

  @Post('requests')
  async sendRequest(
    @CurrentUser() user: PublicUser,
    @Body() dto: SendFriendRequestDto,
  ): Promise<{ id: string }> {
    const request = await this.friendsService.sendRequest(user.id, dto.toId)
    return { id: request.id }
  }

  @Post('requests/:id/accept')
  async accept(@CurrentUser() user: PublicUser, @Param('id') id: string): Promise<{ id: string }> {
    const request = await this.friendsService.accept(user.id, id)
    return { id: request.id }
  }

  @Post('requests/:id/decline')
  @HttpCode(HttpStatus.NO_CONTENT)
  decline(@CurrentUser() user: PublicUser, @Param('id') id: string): Promise<void> {
    return this.friendsService.decline(user.id, id)
  }

  @Delete(':friendId')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@CurrentUser() user: PublicUser, @Param('friendId') friendId: string): Promise<void> {
    return this.friendsService.remove(user.id, friendId)
  }
}
