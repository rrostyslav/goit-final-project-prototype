import { Column, DataType, ForeignKey, Model, Table } from 'sequelize-typescript'
import { Room } from './room.model'
import { User } from './user.model'

@Table({
  tableName: 'room_bans',
  underscored: true,
  updatedAt: false,
  indexes: [{ unique: true, fields: ['room_id', 'user_id'] }],
})
export class RoomBan extends Model<RoomBan> {
  @Column({ type: DataType.UUID, primaryKey: true, defaultValue: DataType.UUIDV4 })
  declare id: string

  @ForeignKey(() => Room)
  @Column({ type: DataType.UUID, allowNull: false })
  declare roomId: string

  @ForeignKey(() => User)
  @Column({ type: DataType.UUID, allowNull: false })
  declare userId: string

  @ForeignKey(() => User)
  @Column({ type: DataType.UUID, allowNull: false })
  declare bannedBy: string

  @Column({ type: DataType.STRING, allowNull: true })
  declare reason: string | null

  declare readonly createdAt: Date
}
