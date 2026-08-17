import { Global, Module } from '@nestjs/common'
import { AppConfigService } from './env.config'

@Global()
@Module({
  providers: [AppConfigService],
  exports: [AppConfigService],
})
export class AppConfigModule {}
