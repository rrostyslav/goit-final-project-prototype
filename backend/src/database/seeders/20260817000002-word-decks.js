const { randomUUID } = require('node:crypto')
const wordsUk = require('../data/words.uk.json')
const wordsEn = require('../data/words.en.json')

// Deck names are display labels only — WordDeckService.loadDeck (Task 16)
// looks decks up by (category, language), never by name.
const DECKS = [
  { category: 'general', language: 'uk', name: 'Загальні слова', words: wordsUk.general },
  { category: 'crocodile', language: 'uk', name: 'Крокодил', words: wordsUk.crocodile },
  { category: 'general', language: 'en', name: 'General words', words: wordsEn.general },
  { category: 'crocodile', language: 'en', name: 'Crocodile', words: wordsEn.crocodile },
]

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    for (const deck of DECKS) {
      const [existingDecks] = await queryInterface.sequelize.query(
        'select id from word_decks where category = :category and language = :language',
        { replacements: { category: deck.category, language: deck.language } },
      )

      let deckId = existingDecks[0]?.id

      if (!deckId) {
        deckId = randomUUID()
        await queryInterface.bulkInsert('word_decks', [
          { id: deckId, category: deck.category, language: deck.language, name: deck.name },
        ])
      }

      const [existingEntries] = await queryInterface.sequelize.query(
        'select word from word_deck_entries where deck_id = :deckId',
        { replacements: { deckId } },
      )
      const existingWords = new Set(existingEntries.map((row) => row.word))
      const newWords = deck.words.filter((word) => !existingWords.has(word))

      if (newWords.length > 0) {
        await queryInterface.bulkInsert(
          'word_deck_entries',
          newWords.map((word) => ({ id: randomUUID(), deck_id: deckId, word })),
        )
      }
    }
  },

  async down(queryInterface) {
    for (const deck of DECKS) {
      await queryInterface.sequelize.query(
        `delete from word_deck_entries where deck_id in (
           select id from word_decks where category = :category and language = :language
         )`,
        { replacements: { category: deck.category, language: deck.language } },
      )
      await queryInterface.sequelize.query(
        'delete from word_decks where category = :category and language = :language',
        { replacements: { category: deck.category, language: deck.language } },
      )
    }
  },
}
