import type { CreationOptional, InferAttributes, InferCreationAttributes } from 'sequelize'
import { Column, DataType, ForeignKey, Model, Table } from 'sequelize-typescript'
import { Room } from './room.model'
import { User } from './user.model'

@Table({
  tableName: 'room_bans',
  underscored: true,
  updatedAt: false,
  indexes: [{ unique: true, fields: ['room_id', 'user_id'] }],
})
export class RoomBan extends Model<InferAttributes<RoomBan>, InferCreationAttributes<RoomBan>> {
  @Column({ type: DataType.UUID, primaryKey: true, defaultValue: DataType.UUIDV4 })
  declare id: CreationOptional<string>

  @ForeignKey(() => Room)
  @Column({ type: DataType.UUID, allowNull: false })
  declare roomId: string

  @ForeignKey(() => User)
  @Column({ type: DataType.UUID, allowNull: false })
  declare userId: string

  // Nullable: the ban must outlive the moderator's account (onDelete: SET NULL
  // in the migration), so a deleted moderator does not silently un-ban anyone.
  @ForeignKey(() => User)
  @Column({ type: DataType.UUID, allowNull: true })
  declare bannedBy: CreationOptional<string | null>

  @Column({ type: DataType.STRING, allowNull: true })
  declare reason: CreationOptional<string | null>

  declare readonly createdAt: CreationOptional<Date>
}
