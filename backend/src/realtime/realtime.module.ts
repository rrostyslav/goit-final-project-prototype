import { Logger, Module, type OnModuleInit } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module'
import { NotificationsModule } from '../notifications/notifications.module'
import { NotificationsService } from '../notifications/notifications.service'
import { RedisModule } from '../redis/redis.module'
import { RedisService } from '../redis/redis.service'
import { RoomsModule } from '../rooms/rooms.module'
import { RoomsService } from '../rooms/rooms.service'
import { PresenceService } from './presence.service'
import { lockKey, RealtimeGateway } from './realtime.gateway'

// `NotificationsModule` has no dependency on this module (or on anything
// that depends on it), so importing it here to reach `NotificationsService`
// does not create a cycle.
@Module({
  imports: [AuthModule, RedisModule, RoomsModule, NotificationsModule],
  providers: [RealtimeGateway, PresenceService],
  exports: [RealtimeGateway, PresenceService],
})
export class RealtimeModule implements OnModuleInit {
  private readonly logger = new Logger(RealtimeModule.name)

  constructor(
    private readonly presenceService: PresenceService,
    private readonly gateway: RealtimeGateway,
    private readonly roomsService: RoomsService,
    private readonly redisService: RedisService,
    private readonly notificationsService: NotificationsService,
  ) {}

  /** Wired here (not inside PresenceService/NotificationsService
   * themselves) so these WS-only concerns — "grace period expired,
   * actually remove the member and tell everyone" and "a notification was
   * pushed, deliver it live" — can depend on RoomsService/RealtimeGateway
   * without either of those depending back on PresenceService or
   * NotificationsService. */
  onModuleInit(): void {
    this.presenceService.setEvictionHandler(async (roomId, userId) => {
      // Same per-room lock the WS handlers in RealtimeGateway take for
      // every other WS-originated room mutation (join/leave/kick/ban/etc.)
      // — without it, this eviction path was the one WS-side room mutation
      // that could race a concurrent join/leave on the same room. Note
      // this still does not close the separate REST-vs-WS race: the REST
      // `RoomsController` does not take this lock, so a REST mutation of
      // the same room can still interleave with any of these — closing
      // that would mean moving locking into `RoomsService` itself, which is
      // a larger change than this task carries.
      await this.redisService.withLock(lockKey(roomId), () =>
        this.roomsService.leave(roomId, userId),
      )
      await this.gateway.handleMemberRemoved(roomId, userId)
    })

    this.notificationsService.setDeliveryHandler((userId, dto) => {
      this.gateway.emitToUser(userId, 'notification', dto).catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err)
        this.logger.error(`notification delivery failed for user ${userId}: ${message}`)
      })
    })
  }
}
