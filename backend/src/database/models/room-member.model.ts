import { BelongsTo, Column, DataType, ForeignKey, Model, Table } from 'sequelize-typescript'
import { Room } from './room.model'
import { User } from './user.model'

// Plain unique index on (roomId, userId): a partial unique index scoped to
// `leftAt IS NULL` is not portably expressible in Sequelize's migration DSL.
// Task 9 reuses the existing row (resets leftAt to null) when a member rejoins
// instead of inserting a second row for the same (room, user) pair.
@Table({
  tableName: 'room_members',
  underscored: true,
  timestamps: false,
  indexes: [{ unique: true, fields: ['room_id', 'user_id'] }],
})
export class RoomMember extends Model<RoomMember> {
  @Column({ type: DataType.UUID, primaryKey: true, defaultValue: DataType.UUIDV4 })
  declare id: string

  @ForeignKey(() => Room)
  @Column({ type: DataType.UUID, allowNull: false })
  declare roomId: string

  @BelongsTo(() => Room, 'roomId')
  declare room?: Room

  @ForeignKey(() => User)
  @Column({ type: DataType.UUID, allowNull: false })
  declare userId: string

  @BelongsTo(() => User, 'userId')
  declare user?: User

  @Column({ type: DataType.BOOLEAN, allowNull: false, defaultValue: false })
  declare isReady: boolean

  @Column({ type: DataType.DATE, allowNull: false, defaultValue: DataType.NOW })
  declare joinedAt: Date

  @Column({ type: DataType.DATE, allowNull: true })
  declare leftAt: Date | null
}
