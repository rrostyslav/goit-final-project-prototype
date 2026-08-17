import { Module } from '@nestjs/common'
import { DatabaseModule } from '../database/database.module'
import { RedisModule } from '../redis/redis.module'
import { UsersModule } from '../users/users.module'
import { RoomCodeService } from './room-code.service'
import { RoomsController } from './rooms.controller'
import { RoomsService } from './rooms.service'

@Module({
  imports: [DatabaseModule, UsersModule, RedisModule],
  controllers: [RoomsController],
  providers: [RoomsService, RoomCodeService],
  exports: [RoomsService],
})
export class RoomsModule {}
