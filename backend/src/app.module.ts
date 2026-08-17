import { Module } from '@nestjs/common'
import { AuthModule } from './auth/auth.module'
import { AppConfigModule } from './config/config.module'
import { DatabaseModule } from './database/database.module'
import { FriendsModule } from './friends/friends.module'
import { HealthModule } from './health/health.module'
import { NotificationsModule } from './notifications/notifications.module'
import { RoomsModule } from './rooms/rooms.module'
import { UsersModule } from './users/users.module'

@Module({
  imports: [
    AppConfigModule,
    DatabaseModule,
    HealthModule,
    AuthModule,
    UsersModule,
    FriendsModule,
    NotificationsModule,
    RoomsModule,
  ],
})
export class AppModule {}
