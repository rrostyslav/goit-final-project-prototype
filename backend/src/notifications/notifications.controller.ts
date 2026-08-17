import type { NotificationDto, PublicUser } from '@gp/shared'
import { Controller, Get, Param, Post, UseGuards } from '@nestjs/common'
import { CurrentUser } from '../auth/decorators/current-user.decorator'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'
import { NotificationsService } from './notifications.service'

@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  list(@CurrentUser() user: PublicUser): Promise<NotificationDto[]> {
    return this.notificationsService.list(user.id)
  }

  @Post(':id/read')
  markRead(@CurrentUser() user: PublicUser, @Param('id') id: string): Promise<NotificationDto> {
    return this.notificationsService.markRead(user.id, id)
  }
}
