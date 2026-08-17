import type {
  CreationOptional,
  InferAttributes,
  InferCreationAttributes,
  NonAttribute,
} from 'sequelize'
import { BelongsTo, Column, DataType, ForeignKey, Model, Table } from 'sequelize-typescript'
import { Room } from './room.model'

@Table({ tableName: 'game_sessions', underscored: true, timestamps: false })
export class GameSession extends Model<
  InferAttributes<GameSession>,
  InferCreationAttributes<GameSession>
> {
  @Column({ type: DataType.UUID, primaryKey: true, defaultValue: DataType.UUIDV4 })
  declare id: CreationOptional<string>

  @ForeignKey(() => Room)
  @Column({ type: DataType.UUID, allowNull: false })
  declare roomId: string

  @BelongsTo(() => Room, 'roomId')
  declare room?: NonAttribute<Room>

  @Column({ type: DataType.STRING, allowNull: false })
  declare gameId: string

  @Column({ type: DataType.JSONB, allowNull: false, defaultValue: {} })
  declare state: CreationOptional<Record<string, unknown>>

  @Column({ type: DataType.DATE, allowNull: false, defaultValue: DataType.NOW })
  declare startedAt: CreationOptional<Date>

  @Column({ type: DataType.DATE, allowNull: true })
  declare endedAt: CreationOptional<Date | null>
}
