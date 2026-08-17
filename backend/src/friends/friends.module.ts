import { Module } from '@nestjs/common'
import { DatabaseModule } from '../database/database.module'
import { NotificationsModule } from '../notifications/notifications.module'
import { UsersModule } from '../users/users.module'
import { FriendsController } from './friends.controller'
import { FriendsService } from './friends.service'

@Module({
  imports: [DatabaseModule, UsersModule, NotificationsModule],
  controllers: [FriendsController],
  providers: [FriendsService],
  exports: [FriendsService],
})
export class FriendsModule {}
