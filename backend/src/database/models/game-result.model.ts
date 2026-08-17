import type {
  CreationOptional,
  InferAttributes,
  InferCreationAttributes,
  NonAttribute,
} from 'sequelize'
import { BelongsTo, Column, DataType, ForeignKey, Model, Table } from 'sequelize-typescript'
import { GameSession } from './game-session.model'
import { User } from './user.model'

@Table({ tableName: 'game_results', underscored: true, timestamps: false })
export class GameResult extends Model<
  InferAttributes<GameResult>,
  InferCreationAttributes<GameResult>
> {
  @Column({ type: DataType.UUID, primaryKey: true, defaultValue: DataType.UUIDV4 })
  declare id: CreationOptional<string>

  @ForeignKey(() => GameSession)
  @Column({ type: DataType.UUID, allowNull: false })
  declare sessionId: string

  @BelongsTo(() => GameSession, 'sessionId')
  declare session?: NonAttribute<GameSession>

  @ForeignKey(() => User)
  @Column({ type: DataType.UUID, allowNull: false })
  declare userId: string

  @BelongsTo(() => User, 'userId')
  declare user?: NonAttribute<User>

  @Column({ type: DataType.INTEGER, allowNull: false })
  declare score: number

  @Column({ type: DataType.INTEGER, allowNull: false })
  declare placement: number
}
