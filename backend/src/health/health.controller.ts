import { Controller, Get } from '@nestjs/common'
import { AppConfigService } from '../config/env.config'

interface HealthResponse {
  status: 'ok'
  voice: boolean
  oauth: boolean
}

@Controller('health')
export class HealthController {
  constructor(private readonly config: AppConfigService) {}

  @Get()
  check(): HealthResponse {
    return {
      status: 'ok',
      voice: this.config.voiceEnabled,
      oauth: this.config.oauthEnabled,
    }
  }
}
