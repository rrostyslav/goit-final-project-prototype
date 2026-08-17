import type { NotificationDto } from '@gp/shared'
import { Injectable, NotFoundException } from '@nestjs/common'
import { InjectModel } from '@nestjs/sequelize'
import { Notification } from '../database/models/notification.model'

@Injectable()
export class NotificationsService {
  constructor(@InjectModel(Notification) private readonly notificationModel: typeof Notification) {}

  /** Creates a notification row and returns its DTO. Task 15's WebSocket
   * gateway calls this directly (outside of any HTTP request context) and
   * emits the returned DTO over the socket, so this method must not depend
   * on anything request-scoped. */
  async push(
    userId: string,
    type: NotificationDto['type'],
    payload: Record<string, string>,
  ): Promise<NotificationDto> {
    const row = await this.notificationModel.create({ userId, type, payload })
    return {
      id: row.id,
      type,
      payload,
      createdAt: row.createdAt.toISOString(),
      readAt: null,
    }
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
