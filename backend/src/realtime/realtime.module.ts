import { Module, type OnModuleInit } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module'
import { RedisModule } from '../redis/redis.module'
import { RoomsModule } from '../rooms/rooms.module'
import { RoomsService } from '../rooms/rooms.service'
import { PresenceService } from './presence.service'
import { RealtimeGateway } from './realtime.gateway'

@Module({
  imports: [AuthModule, RedisModule, RoomsModule],
  providers: [RealtimeGateway, PresenceService],
  exports: [RealtimeGateway, PresenceService],
})
export class RealtimeModule implements OnModuleInit {
  constructor(
    private readonly presenceService: PresenceService,
    private readonly gateway: RealtimeGateway,
    private readonly roomsService: RoomsService,
  ) {}

  /** Wired here (not inside PresenceService itself) so the eviction path —
   * "grace period expired, actually remove the member and tell everyone" —
   * can depend on RoomsService and RealtimeGateway without either of those
   * depending back on PresenceService. */
  onModuleInit(): void {
    this.presenceService.setEvictionHandler(async (roomId, userId) => {
      await this.roomsService.leave(roomId, userId)
      await this.gateway.handleMemberRemoved(roomId, userId)
    })
  }
}
