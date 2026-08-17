import { Column, DataType, HasMany, Model, Table } from 'sequelize-typescript'
import { WordDeckEntry } from './word-deck-entry.model'

@Table({ tableName: 'word_decks', underscored: true, timestamps: false })
export class WordDeck extends Model<WordDeck> {
  @Column({ type: DataType.UUID, primaryKey: true, defaultValue: DataType.UUIDV4 })
  declare id: string

  @Column({ type: DataType.STRING, allowNull: false })
  declare category: string

  @Column({ type: DataType.STRING, allowNull: false })
  declare language: string

  @Column({ type: DataType.STRING, allowNull: false })
  declare name: string

  @HasMany(() => WordDeckEntry, 'deckId')
  declare entries?: WordDeckEntry[]
}
