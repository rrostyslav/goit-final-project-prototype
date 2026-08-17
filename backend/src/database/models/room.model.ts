import type { RoomStatus, RoomVisibility } from '@gp/shared'
import { ROOM_MAX_PLAYERS } from '@gp/shared'
import {
  BelongsTo,
  Column,
  DataType,
  ForeignKey,
  HasMany,
  Model,
  Table,
} from 'sequelize-typescript'
import { RoomMember } from './room-member.model'
import { User } from './user.model'

@Table({
  tableName: 'rooms',
  underscored: true,
  indexes: [{ fields: ['visibility', 'status'] }],
})
export class Room extends Model<Room> {
  @Column({ type: DataType.UUID, primaryKey: true, defaultValue: DataType.UUIDV4 })
  declare id: string

  @Column({ type: DataType.CHAR(6), allowNull: false, unique: true })
  declare code: string

  @Column({ type: DataType.ENUM('private', 'public'), allowNull: false })
  declare visibility: RoomVisibility

  @Column({
    type: DataType.ENUM('lobby', 'in_game', 'results'),
    allowNull: false,
    defaultValue: 'lobby',
  })
  declare status: RoomStatus

  @ForeignKey(() => User)
  @Column({ type: DataType.UUID, allowNull: false })
  declare hostId: string

  @BelongsTo(() => User, 'hostId')
  declare host?: User

  @Column({ type: DataType.INTEGER, allowNull: false, defaultValue: ROOM_MAX_PLAYERS })
  declare maxPlayers: number

  @Column({ type: DataType.STRING, allowNull: true })
  declare selectedGameId: string | null

  @Column({ type: DataType.UUID, allowNull: false, defaultValue: DataType.UUIDV4 })
  declare inviteToken: string

  @Column({ type: DataType.DATE, allowNull: true })
  declare closedAt: Date | null

  @HasMany(() => RoomMember, 'roomId')
  declare members?: RoomMember[]

  declare readonly createdAt: Date
  declare readonly updatedAt: Date
}
