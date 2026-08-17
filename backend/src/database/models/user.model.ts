import type { CreationOptional, InferAttributes, InferCreationAttributes } from 'sequelize'
import { Column, DataType, Model, Table } from 'sequelize-typescript'

@Table({ tableName: 'users', underscored: true })
export class User extends Model<InferAttributes<User>, InferCreationAttributes<User>> {
  @Column({ type: DataType.UUID, primaryKey: true, defaultValue: DataType.UUIDV4 })
  declare id: CreationOptional<string>

  @Column({ type: DataType.STRING, allowNull: true, unique: true })
  declare email: CreationOptional<string | null>

  @Column({ type: DataType.STRING, allowNull: true })
  declare passwordHash: CreationOptional<string | null>

  @Column({ type: DataType.STRING, allowNull: true })
  declare oauthProvider: CreationOptional<string | null>

  @Column({ type: DataType.STRING, allowNull: true })
  declare oauthId: CreationOptional<string | null>

  @Column({ type: DataType.STRING, allowNull: false })
  declare nickname: string

  @Column({ type: DataType.STRING, allowNull: true })
  declare avatarUrl: CreationOptional<string | null>

  @Column({ type: DataType.BOOLEAN, allowNull: false, defaultValue: false })
  declare isGuest: CreationOptional<boolean>

  declare readonly createdAt: CreationOptional<Date>
  declare readonly updatedAt: CreationOptional<Date>
}
