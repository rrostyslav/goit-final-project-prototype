import type { CreationOptional, InferAttributes, InferCreationAttributes } from 'sequelize'
import { Column, DataType, ForeignKey, Model, Table } from 'sequelize-typescript'
import { Room } from './room.model'
import { User } from './user.model'

// Moderation record. The room FK cascades (a report about a room only makes
// sense while the room exists — Task 5 cascades RoomMember/RoomBan the same
// way), but both user FKs are nullable + SET NULL: like RoomBan.bannedBy
// (Task 5), a report must outlive either the reporter's or the reported
// user's account being deleted, rather than silently vanishing (CASCADE) or
// blocking the account deletion (RESTRICT).
@Table({
  tableName: 'room_reports',
  underscored: true,
  updatedAt: false,
})
export class RoomReport extends Model<
  InferAttributes<RoomReport>,
  InferCreationAttributes<RoomReport>
> {
  @Column({ type: DataType.UUID, primaryKey: true, defaultValue: DataType.UUIDV4 })
  declare id: CreationOptional<string>

  @ForeignKey(() => Room)
  @Column({ type: DataType.UUID, allowNull: false })
  declare roomId: string

  @ForeignKey(() => User)
  @Column({ type: DataType.UUID, allowNull: true })
  declare reporterId: CreationOptional<string | null>

  @ForeignKey(() => User)
  @Column({ type: DataType.UUID, allowNull: true })
  declare reportedUserId: CreationOptional<string | null>

  @Column({ type: DataType.STRING, allowNull: true })
  declare reason: CreationOptional<string | null>

  declare readonly createdAt: CreationOptional<Date>
}
