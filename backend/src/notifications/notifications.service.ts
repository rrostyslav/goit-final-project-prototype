import type { NotificationDto, UserId } from '@gp/shared'
import { Injectable, NotFoundException } from '@nestjs/common'
import { InjectModel } from '@nestjs/sequelize'
import { Notification } from '../database/models/notification.model'

type DeliveryHandler = (userId: UserId, dto: NotificationDto) => void

@Injectable()
export class NotificationsService {
  constructor(@InjectModel(Notification) private readonly notificationModel: typeof Notification) {}

  private deliveryHandler: DeliveryHandler | null = null

  /** Wired by `RealtimeModule` (not by this service) so live delivery over
   * the socket can depend on `RealtimeGateway` without this module — or
   * any of its other callers, such as `FriendsService` — depending back on
   * the realtime layer. Mirrors the `PresenceService.setEvictionHandler`
   * pattern used for the same reason. A missing handler is not an error:
   * `push` always persists, and notifications remain readable over REST
   * (`GET /notifications`) even when nothing is listening live. */
  setDeliveryHandler(fn: DeliveryHandler): void {
    this.deliveryHandler = fn
  }

  /** Creates a notification row and returns its DTO. Persists first, then
   * — if a delivery handler is registered — hands the same DTO to it for
   * live delivery over the socket. This method must not depend on anything
   * request-scoped, since it is also called from outside any HTTP request
   * context (e.g. `FriendsService.sendRequest`). */
  async push(
    userId: UserId,
    type: NotificationDto['type'],
    payload: Record<string, string>,
  ): Promise<NotificationDto> {
    const row = await this.notificationModel.create({ userId, type, payload })
    const dto: NotificationDto = {
      id: row.id,
      type,
      payload,
      createdAt: row.createdAt.toISOString(),
      readAt: null,
    }
    this.deliveryHandler?.(userId, dto)
    return dto
  }

  async list(userId: string): Promise<NotificationDto[]> {
    const rows = await this.notificationModel.findAll({
      where: { userId },
      order: [['createdAt', 'DESC']],
    })
    return rows.map(toNotificationDto)
  }

  async markRead(userId: string, id: string): Promise<NotificationDto> {
    const row = await this.notificationModel.findByPk(id)
    if (!row || row.userId !== userId) {
      throw new NotFoundException('Notification not found')
    }

    if (!row.readAt) {
      row.readAt = new Date()
      await row.save()
    }

    return toNotificationDto(row)
  }
}

function toNotificationDto(row: Notification): NotificationDto {
  return {
    id: row.id,
    type: row.type as NotificationDto['type'],
    payload: row.payload as Record<string, string>,
    createdAt: row.createdAt.toISOString(),
    readAt: row.readAt ? row.readAt.toISOString() : null,
  }
}
