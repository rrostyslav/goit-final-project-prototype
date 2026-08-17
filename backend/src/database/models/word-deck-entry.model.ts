import { BelongsTo, Column, DataType, ForeignKey, Model, Table } from 'sequelize-typescript'
import { WordDeck } from './word-deck.model'

@Table({ tableName: 'word_deck_entries', underscored: true, timestamps: false })
export class WordDeckEntry extends Model<WordDeckEntry> {
  @Column({ type: DataType.UUID, primaryKey: true, defaultValue: DataType.UUIDV4 })
  declare id: string

  @ForeignKey(() => WordDeck)
  @Column({ type: DataType.UUID, allowNull: false })
  declare deckId: string

  @BelongsTo(() => WordDeck, 'deckId')
  declare deck?: WordDeck

  @Column({ type: DataType.STRING, allowNull: false })
  declare word: string
}
