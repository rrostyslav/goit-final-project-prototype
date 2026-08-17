import 'reflect-metadata'
import { ValidationPipe } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import cookieParser from 'cookie-parser'
import { AppModule } from './app.module'
import { AppConfigService } from './config/env.config'

// Load a local .env file (if present) into process.env before the config
// service parses it. In production/CI env vars are injected directly by the
// runtime (Docker/Helm), so a missing .env file here is not an error.
function loadEnvFile() {
  try {
    process.loadEnvFile()
  } catch {
    // No .env file present — rely on env vars already set in the process.
  }
}

async function bootstrap() {
  loadEnvFile()

  const app = await NestFactory.create(AppModule)
  const config = app.get(AppConfigService)

  app.setGlobalPrefix('api')
  app.enableCors({ origin: config.corsOrigin, credentials: true })
  app.use(cookieParser())
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }))

  await app.listen(config.port)
}

bootstrap()
