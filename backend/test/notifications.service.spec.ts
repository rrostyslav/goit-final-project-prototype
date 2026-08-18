import type { NotificationDto } from '@gp/shared'
import type { Notification } from '../src/database/models/notification.model'
import { NotificationsService } from '../src/notifications/notifications.service'

interface FakeNotificationRow {
  id: string
  userId: string
  type: string
  payload: Record<string, unknown>
  readAt: Date | null
  createdAt: Date
}

type FakeNotificationCreateAttrs = Pick<FakeNotificationRow, 'userId' | 'type' | 'payload'>

// A minimal in-memory stand-in for the Sequelize `Notification` model,
// mirroring the style used in friends.service.spec.ts / rooms.service.spec.ts
// — only `create` is exercised by `NotificationsService.push`.
function createFakeNotificationModel() {
  const rows: FakeNotificationRow[] = []
  let counter = 0

  return {
    rows,
    async create(attrs: FakeNotificationCreateAttrs): Promise<FakeNotificationRow> {
      counter += 1
      const row: FakeNotificationRow = {
        id: `notif-${counter}`,
        userId: attrs.userId,
        type: attrs.type,
        payload: attrs.payload,
        readAt: null,
        createdAt: new Date(),
      }
      rows.push(row)
      return row
    },
  }
}

function createService() {
  const notificationModel = createFakeNotificationModel()
  const service = new NotificationsService(notificationModel as unknown as typeof Notification)
  return { service, notificationModel }
}

describe('NotificationsService', () => {
  it('push persists a row and returns its DTO when no handler is registered', async () => {
    const { service, notificationModel } = createService()

    const dto = await service.push('user-1', 'friend_request', { fromId: 'user-2' })

    expect(notificationModel.rows).toHaveLength(1)
    expect(notificationModel.rows[0]).toMatchObject({
      userId: 'user-1',
      type: 'friend_request',
      payload: { fromId: 'user-2' },
    })
    expect(dto).toMatchObject({
      type: 'friend_request',
      payload: { fromId: 'user-2' },
      readAt: null,
    })
  })

  it('push persists and invokes a registered delivery handler with the same DTO', async () => {
    const { service, notificationModel } = createService()
    const delivered: Array<{ userId: string; dto: NotificationDto }> = []
    service.setDeliveryHandler((userId, dto) => {
      delivered.push({ userId, dto })
    })

    const dto = await service.push('user-1', 'room_invite', { roomId: 'room-1' })

    expect(notificationModel.rows).toHaveLength(1)
    expect(delivered).toEqual([{ userId: 'user-1', dto }])
  })
})
