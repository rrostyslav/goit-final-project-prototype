import { Module } from '@nestjs/common'
import { SequelizeModule } from '@nestjs/sequelize'
import { AppConfigModule } from '../config/config.module'
import { AppConfigService } from '../config/env.config'
import {
  Friendship,
  GameResult,
  GameSession,
  Notification,
  Room,
  RoomBan,
  RoomMember,
  RoomReport,
  User,
  WordDeck,
  WordDeckEntry,
} from './models'

const models = [
  User,
  Room,
  RoomMember,
  RoomBan,
  RoomReport,
  GameSession,
  GameResult,
  WordDeck,
  WordDeckEntry,
  Friendship,
  Notification,
]

@Module({
  imports: [
    SequelizeModule.forRootAsync({
      imports: [AppConfigModule],
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => ({
        uri: config.databaseUrl,
        models,
        autoLoadModels: false,
        synchronize: false,
        define: { underscored: true },
      }),
    }),
    SequelizeModule.forFeature(models),
  ],
  exports: [SequelizeModule],
})
export class DatabaseModule {}
