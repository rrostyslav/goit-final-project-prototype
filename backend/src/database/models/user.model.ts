import { Column, DataType, Model, Table } from 'sequelize-typescript'

@Table({ tableName: 'users', underscored: true })
export class User extends Model<User> {
  @Column({ type: DataType.UUID, primaryKey: true, defaultValue: DataType.UUIDV4 })
  declare id: string

  @Column({ type: DataType.STRING, allowNull: true, unique: true })
  declare email: string | null

  @Column({ type: DataType.STRING, allowNull: true })
  declare passwordHash: string | null

  @Column({ type: DataType.STRING, allowNull: true })
  declare oauthProvider: string | null

  @Column({ type: DataType.STRING, allowNull: true })
  declare oauthId: string | null

  @Column({ type: DataType.STRING, allowNull: false })
  declare nickname: string

  @Column({ type: DataType.STRING, allowNull: true })
  declare avatarUrl: string | null

  @Column({ type: DataType.BOOLEAN, allowNull: false, defaultValue: false })
  declare isGuest: boolean

  declare readonly createdAt: Date
  declare readonly updatedAt: Date
}
