import type { FriendshipStatus } from '@gp/shared'
import { Column, DataType, ForeignKey, Model, Table } from 'sequelize-typescript'
import { User } from './user.model'

@Table({
  tableName: 'friendships',
  underscored: true,
  timestamps: false,
  indexes: [{ unique: true, fields: ['user_id', 'friend_id'] }],
})
export class Friendship extends Model<Friendship> {
  @Column({ type: DataType.UUID, primaryKey: true, defaultValue: DataType.UUIDV4 })
  declare id: string

  @ForeignKey(() => User)
  @Column({ type: DataType.UUID, allowNull: false })
  declare userId: string

  @ForeignKey(() => User)
  @Column({ type: DataType.UUID, allowNull: false })
  declare friendId: string

  @Column({ type: DataType.ENUM('pending', 'accepted', 'blocked'), allowNull: false })
  declare status: FriendshipStatus
}
