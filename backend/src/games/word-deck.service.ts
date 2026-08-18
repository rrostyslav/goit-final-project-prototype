import type { Locale } from '@gp/shared'
import { Injectable } from '@nestjs/common'
import { InjectModel } from '@nestjs/sequelize'
import { WordDeck } from '../database/models/word-deck.model'
import { WordDeckEntry } from '../database/models/word-deck-entry.model'
import { RedisService } from '../redis/redis.service'

const CACHE_TTL_SECONDS = 300

/** Loads a word deck's word list for `GameRuntimeService.start`, caching it
 * in Redis for `CACHE_TTL_SECONDS` (5 minutes) so a burst of game starts
 * (several rooms starting Alias in the same minute) does not each hit
 * Postgres for the same ~150-word deck. The deck's *order* here is whatever
 * `WordDeckEntry` rows come back in (insertion order, effectively) — it is
 * the caller's job to shuffle it with a seeded RNG before handing it to a
 * reducer's `InitContext.deck` (see `word-engine.ts`: "the deck is supplied
 * already shuffled by the caller"), not this service's. */
@Injectable()
export class WordDeckService {
  constructor(
    @InjectModel(WordDeck) private readonly wordDeckModel: typeof WordDeck,
    @InjectModel(WordDeckEntry) private readonly wordDeckEntryModel: typeof WordDeckEntry,
    private readonly redisService: RedisService,
  ) {}

  async loadDeck(category: string, language: Locale): Promise<string[]> {
    const key = deckCacheKey(category, language)
    const cached = await this.redisService.client.get(key)
    if (cached !== null) {
      return JSON.parse(cached) as string[]
    }

    const deck = await this.wordDeckModel.findOne({ where: { category, language } })
    // No matching deck row (e.g. a language/category combination that was
    // never seeded) degrades to an empty word list rather than throwing —
    // the word-engine already handles an empty/exhausted deck gracefully
    // (`drawWord` returns `currentWord: null` instead of crashing), so a
    // missing deck becomes "no words this turn", not a broken game start.
    if (!deck) {
      return []
    }

    const entries = await this.wordDeckEntryModel.findAll({ where: { deckId: deck.id } })
    const words = entries.map((entry) => entry.word)

    await this.redisService.client.set(key, JSON.stringify(words), 'EX', CACHE_TTL_SECONDS)
    return words
  }
}

function deckCacheKey(category: string, language: Locale): string {
  return `deck:${category}:${language}`
}
