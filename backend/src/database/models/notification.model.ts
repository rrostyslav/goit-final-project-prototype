import type { CreationOptional, InferAttributes, InferCreationAttributes } from 'sequelize'
import { Column, DataType, ForeignKey, Model, Table } from 'sequelize-typescript'
import { User } from './user.model'

@Table({ tableName: 'notifications', underscored: true, updatedAt: false })
export class Notification extends Model<
  InferAttributes<Notification>,
  InferCreationAttributes<Notification>
> {
  @Column({ type: DataType.UUID, primaryKey: true, defaultValue: DataType.UUIDV4 })
  declare id: CreationOptional<string>

  @ForeignKey(() => User)
  @Column({ type: DataType.UUID, allowNull: false })
  declare userId: string

  @Column({ type: DataType.STRING, allowNull: false })
  declare type: string

  @Column({ type: DataType.JSONB, allowNull: false, defaultValue: {} })
  declare payload: CreationOptional<Record<string, unknown>>

  @Column({ type: DataType.DATE, allowNull: true })
  declare readAt: CreationOptional<Date | null>

  declare readonly createdAt: CreationOptional<Date>
}
