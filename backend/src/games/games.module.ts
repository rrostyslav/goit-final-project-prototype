import { Module } from '@nestjs/common'
import { DatabaseModule } from '../database/database.module'
import { RedisModule } from '../redis/redis.module'
import { RoomsModule } from '../rooms/rooms.module'
import { GameRuntimeService } from './game-runtime.service'
import { GameTimerService } from './game-timer.service'
import { WordDeckService } from './word-deck.service'

// GameHistoryService deliberately lives OUTSIDE this module's providers even
// though its file sits in this same directory (see game-history.service.ts):
// its only consumer is UsersController, and UsersModule already sits
// "upstream" of RoomsModule (RoomsModule imports UsersModule, for
// RoomsService's use of UsersService.toPublicUser). If UsersModule imported
// this module for GameHistoryService, that would close a cycle: UsersModule
// -> GamesModule -> RoomsModule -> UsersModule. GameHistoryService has no
// dependency on RoomsService/RealtimeGateway/anything else in this module —
// only on GameResult/GameSession/Room models via DatabaseModule, which
// UsersModule already imports directly — so it is registered as a provider
// on UsersModule instead. See this task's report for the full rationale.
@Module({
  imports: [DatabaseModule, RedisModule, RoomsModule],
  providers: [GameRuntimeService, GameTimerService, WordDeckService],
  exports: [GameRuntimeService, GameTimerService, WordDeckService],
})
export class GamesModule {}
