import type { RoomStatus, RoomVisibility } from '@gp/shared'
import { ROOM_MAX_PLAYERS } from '@gp/shared'
import type {
  CreationOptional,
  InferAttributes,
  InferCreationAttributes,
  NonAttribute,
} from 'sequelize'
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
export class Room extends Model<InferAttributes<Room>, InferCreationAttributes<Room>> {
  @Column({ type: DataType.UUID, primaryKey: true, defaultValue: DataType.UUIDV4 })
  declare id: CreationOptional<string>

  @Column({ type: DataType.CHAR(6), allowNull: false, unique: true })
  declare code: string

  @Column({ type: DataType.ENUM('private', 'public'), allowNull: false })
  declare visibility: RoomVisibility

  @Column({
    type: DataType.ENUM('lobby', 'in_game', 'results'),
    allowNull: false,
    defaultValue: 'lobby',
  })
  declare status: CreationOptional<RoomStatus>

  @ForeignKey(() => User)
  @Column({ type: DataType.UUID, allowNull: false })
  declare hostId: string

  @BelongsTo(() => User, 'hostId')
  declare host?: NonAttribute<User>

  @Column({ type: DataType.INTEGER, allowNull: false, defaultValue: ROOM_MAX_PLAYERS })
  declare maxPlayers: CreationOptional<number>

  @Column({ type: DataType.STRING, allowNull: true })
  declare selectedGameId: CreationOptional<string | null>

  @Column({ type: DataType.UUID, allowNull: false, unique: true, defaultValue: DataType.UUIDV4 })
  declare inviteToken: CreationOptional<string>

  @Column({ type: DataType.DATE, allowNull: true })
  declare closedAt: CreationOptional<Date | null>

  @HasMany(() => RoomMember, 'roomId')
  declare members?: NonAttribute<RoomMember[]>

  declare readonly createdAt: CreationOptional<Date>
  declare readonly updatedAt: CreationOptional<Date>
}
