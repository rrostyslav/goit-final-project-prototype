import { Module } from '@nestjs/common'
import { AppConfigModule } from '../config/config.module'
import { VoiceService } from './voice.service'

@Module({
  imports: [AppConfigModule],
  providers: [VoiceService],
  exports: [VoiceService],
})
export class VoiceModule {}
