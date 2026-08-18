import { Module } from '@nestjs/common'
import { DatabaseModule } from '../database/database.module'
import { GameHistoryService } from '../games/game-history.service'
import { UsersController } from './users.controller'
import { UsersService } from './users.service'

// GameHistoryService is registered here (not imported via GamesModule) to
// avoid a module cycle: GamesModule imports RoomsModule, and RoomsModule
// imports this module (for UsersService) — so UsersModule -> GamesModule
// would close UsersModule -> GamesModule -> RoomsModule -> UsersModule.
// GameHistoryService itself has no dependency on RoomsService or anything
// else in GamesModule, only on GameResult/GameSession/Room models via
// DatabaseModule (already imported below), so registering it directly here
// is correct, not just cycle-avoiding. See games.module.ts's own comment
// and this task's report for the full rationale.
@Module({
  imports: [DatabaseModule],
  controllers: [UsersController],
  providers: [UsersService, GameHistoryService],
  exports: [UsersService],
})
export class UsersModule {}
