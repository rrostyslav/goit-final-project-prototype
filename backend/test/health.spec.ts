import { Test } from '@nestjs/testing'
import { AppConfigService } from '../src/config/env.config'
import { HealthController } from '../src/health/health.controller'

describe('HealthController', () => {
  it('reports voice and oauth availability', async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        { provide: AppConfigService, useValue: { voiceEnabled: true, oauthEnabled: false } },
      ],
    }).compile()

    expect(moduleRef.get(HealthController).check()).toEqual({
      status: 'ok',
      voice: true,
      oauth: false,
    })
  })
})
