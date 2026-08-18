import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import type {
  Ack,
  ClientToServerEvents,
  GameId,
  PublicUser,
  RoomDto,
  RoomStatus,
  ServerToClientEvents,
} from '@gp/shared'
import { SOCKET_NAMESPACE } from '@gp/shared'
import type { INestApplication } from '@nestjs/common'
import { ValidationPipe } from '@nestjs/common'
import { getModelToken } from '@nestjs/sequelize'
import { Test } from '@nestjs/testing'
import cookieParser from 'cookie-parser'
import Redis from 'ioredis'
import { QueryTypes, Sequelize } from 'sequelize'
import { io, type Socket } from 'socket.io-client'
import request from 'supertest'
import { AppModule } from '../../src/app.module'
import { GameResult } from '../../src/database/models/game-result.model'
import { RedisIoAdapter } from '../../src/realtime/redis-io.adapter'
import { RedisService } from '../../src/redis/redis.service'

// ---------------------------------------------------------------------------
// Test-resource isolation
//
// This suite must NEVER touch the developer's `gameplatform` Postgres
// database or the default Redis keyspace — a test run must not be able to
// wipe or corrupt a developer's local data. `setupTestEnvironment` below:
//   1. Creates a dedicated `gameplatform_test` Postgres database (if it does
//      not already exist), migrates it, and seeds the word decks — using the
//      exact same `sequelize-cli` commands `pnpm db:migrate`/`db:seed` run in
//      dev, just pointed at a different DATABASE_URL, so the suite exercises
//      the real migration/seed path rather than a hand-rolled substitute.
//   2. Flushes Redis logical database index 1 (`redis://.../1`), never the
//      default index 0 dev/prod traffic uses.
//   3. Overwrites `process.env.DATABASE_URL`/`REDIS_URL` for the rest of
//      THIS process only (never writes `backend/.env`) — every provider that
//      reads `AppConfigService` (which parses `process.env` once, in its own
//      constructor) then resolves to the isolated copies, because
//      `startApp()` is only ever called after this has resolved.
// ---------------------------------------------------------------------------

const TEST_DB_NAME = 'gameplatform_test'
const TEST_REDIS_URL = 'redis://127.0.0.1:6379/1'
const BACKEND_ROOT = path.resolve(__dirname, '..', '..')

/** Loads `backend/.env` into `process.env`, existing keys win (same
 * semantics as `main.ts`'s own `process.loadEnvFile()`).
 *
 * This is deliberately NOT `process.loadEnvFile()` itself, even though
 * that's what `main.ts` uses: under `ts-jest`, that built-in silently
 * no-ops here — it neither throws nor populates `process.env`, even given
 * an explicit absolute path, even though the exact same call in a plain
 * `node -e` script from this same directory works. `process` is
 * observably `===` the real Node `process` inside Jest's `node` test
 * environment, so this is not `process.env` being a different object;
 * the most likely explanation is `loadEnvFile`'s native binding resolving
 * "the current realm" through the V8 context Jest's `NodeEnvironment` runs
 * test code in (a `vm.Context`), rather than the one `process` itself was
 * created in — a plausible category of bug for a builtin this new. A
 * minimal hand-rolled parser sidesteps it entirely; production code
 * (`main.ts`) is unaffected and keeps using the real builtin. */
function loadBaseEnv(): void {
  const envPath = path.join(BACKEND_ROOT, '.env')
  let content: string
  try {
    content = readFileSync(envPath, 'utf8')
  } catch {
    // No .env file present — rely on env vars already set in the process.
    return
  }

  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim()
    if (line.length === 0 || line.startsWith('#')) continue
    const eqIndex = line.indexOf('=')
    if (eqIndex === -1) continue

    const key = line.slice(0, eqIndex).trim()
    let value = line.slice(eqIndex + 1).trim()
    const isQuoted =
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    if (isQuoted) {
      value = value.slice(1, -1)
    }

    if (key.length > 0 && !(key in process.env)) {
      process.env[key] = value
    }
  }
}

function withDatabaseName(databaseUrl: string, dbName: string): string {
  const url = new URL(databaseUrl)
  url.pathname = `/${dbName}`
  return url.toString()
}

/** Connects to the `postgres` maintenance database — never the database
 * being tested itself, since Postgres cannot drop or query the existence of
 * the database a connection is currently using — to create `gameplatform_test`
 * if it is not already there. */
async function ensureTestDatabaseExists(devDatabaseUrl: string, dbName: string): Promise<void> {
  const adminUrl = withDatabaseName(devDatabaseUrl, 'postgres')
  const admin = new Sequelize(adminUrl, { logging: false })
  try {
    const rows = await admin.query('SELECT 1 FROM pg_database WHERE datname = :name', {
      replacements: { name: dbName },
      type: QueryTypes.SELECT,
    })
    if (rows.length === 0) {
      // Postgres identifiers cannot be bound as query parameters; `dbName`
      // is the fixed constant above, never user input, so interpolating it
      // here is safe.
      await admin.query(`CREATE DATABASE "${dbName}"`)
    }
  } finally {
    await admin.close()
  }
}

/** Runs the exact same commands `pnpm db:migrate` / `pnpm db:seed` run in
 * dev, against the test database, by overriding DATABASE_URL for the child
 * process only. Both are idempotent — sequelize-cli tracks applied
 * migrations/seeders inside the target database itself (SequelizeMeta /
 * SequelizeData) — so re-running this on every suite invocation only ever
 * does real work the first time; a second `pnpm test:e2e` run is a fast
 * no-op here, which is exactly what "run it twice in a row" requires.
 *
 * `NODE_ENV` is pinned to `development` for this child process regardless of
 * what the parent (Jest sets `NODE_ENV=test` by default) has it as:
 * `src/database/config.js` — read by `sequelize-cli` itself, not by this
 * suite — only exports `development`/`production` keys, both of which
 * already resolve `dialect`/`url` the same way; there is no `test` key, and
 * `sequelize-cli` cannot supply a dialect without one. */
function migrateAndSeedTestDatabase(testDatabaseUrl: string): void {
  const env = { ...process.env, DATABASE_URL: testDatabaseUrl, NODE_ENV: 'development' }
  const run = (args: string[]) => {
    execFileSync('pnpm', ['exec', 'sequelize-cli', ...args], {
      cwd: BACKEND_ROOT,
      env,
      stdio: 'inherit',
    })
  }
  run(['db:migrate'])
  run(['db:seed:all'])
}

async function flushTestRedis(): Promise<void> {
  const client = new Redis(TEST_REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 1 })
  await client.connect()
  try {
    await client.flushdb()
  } finally {
    await client.quit()
  }
}

let envReady = false

/** Idempotent — safe to call from every test file's `beforeAll` even though
 * this suite only has one. Must resolve before `startApp()` is called: it is
 * what points the in-process app at the isolated test database/Redis index
 * instead of the developer's own. */
export async function setupTestEnvironment(): Promise<void> {
  if (envReady) return

  loadBaseEnv()
  const devDatabaseUrl = process.env.DATABASE_URL
  if (!devDatabaseUrl) {
    throw new Error('DATABASE_URL is not set — expected it in backend/.env for the dev database')
  }

  const testDatabaseUrl = withDatabaseName(devDatabaseUrl, TEST_DB_NAME)
  await ensureTestDatabaseExists(devDatabaseUrl, TEST_DB_NAME)
  migrateAndSeedTestDatabase(testDatabaseUrl)
  await flushTestRedis()

  process.env.DATABASE_URL = testDatabaseUrl
  process.env.REDIS_URL = TEST_REDIS_URL
  envReady = true
}

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------

interface RunningApp {
  app: INestApplication
  baseUrl: string
}

let runningApp: RunningApp | null = null

/** Boots the real backend — the same `AppModule` `main.ts` bootstraps, wired
 * up the same way (global prefix, CORS, cookies, validation pipe, the Redis
 * Socket.IO adapter) — on an ephemeral port. Must run after
 * `setupTestEnvironment()` has resolved so `AppConfigService` (which parses
 * `process.env` in its constructor, during `.compile()`) picks up the test
 * database/Redis URLs. */
export async function startApp(): Promise<void> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile()
  const app = moduleRef.createNestApplication()

  app.setGlobalPrefix('api')
  app.enableCors({ origin: true, credentials: true })
  app.use(cookieParser())
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }))
  app.useWebSocketAdapter(new RedisIoAdapter(app, app.get(RedisService)))

  await app.listen(0)
  const address = app.getHttpServer().address()
  const port = typeof address === 'object' && address !== null ? address.port : 0
  if (port === 0) {
    throw new Error('startApp: could not determine the ephemeral port the app is listening on')
  }

  runningApp = { app, baseUrl: `http://127.0.0.1:${port}` }
}

/** Closes the Nest app (which — see the task report — cascades through
 * every `OnModuleDestroy`/`OnApplicationShutdown` hook: RedisService quits
 * both its connections, GameTimerService/GameRuntimeService clear their
 * in-process timers, Sequelize closes its pool, and the Socket.IO/HTTP
 * servers themselves are closed by Nest's own `dispose()`) so the Jest
 * worker can exit without `--forceExit`. */
export async function stopApp(): Promise<void> {
  if (!runningApp) return
  const { app } = runningApp
  runningApp = null
  await app.close()
}

function requireApp(): RunningApp {
  if (!runningApp) {
    throw new Error('startApp() has not been called (or has not resolved) yet')
  }
  return runningApp
}

/** Exposed so specs can reach into the live DI container for assertions
 * that must go straight to Postgres through the app's own connection (e.g.
 * confirming persisted `GameResult` rows) — see `findGameResults` below. */
export function getApp(): INestApplication {
  return requireApp().app
}

export async function findGameResults(sessionId: string): Promise<GameResult[]> {
  const model = getApp().get<typeof GameResult>(getModelToken(GameResult))
  return model.findAll({ where: { sessionId } })
}

// ---------------------------------------------------------------------------
// REST helpers
// ---------------------------------------------------------------------------

export interface GuestSession {
  accessToken: string
  user: PublicUser
}

export async function guest(nickname: string): Promise<GuestSession> {
  const { baseUrl } = requireApp()
  const res = await request(baseUrl).post('/api/auth/guest').send({ nickname })
  if (res.status !== 200) {
    throw new Error(`guest("${nickname}") failed: ${res.status} ${JSON.stringify(res.body)}`)
  }
  const body = res.body as { accessToken: string; user: PublicUser }
  return { accessToken: body.accessToken, user: body.user }
}

export async function createRoom(
  host: GuestSession,
  overrides: { gameId?: GameId; maxPlayers?: number } = {},
): Promise<RoomDto> {
  const { baseUrl } = requireApp()
  const res = await request(baseUrl)
    .post('/api/rooms')
    .set('Authorization', `Bearer ${host.accessToken}`)
    .send({
      visibility: 'public',
      maxPlayers: overrides.maxPlayers ?? 10,
      gameId: overrides.gameId,
    })
  if (res.status !== 201) {
    throw new Error(`createRoom failed: ${res.status} ${JSON.stringify(res.body)}`)
  }
  return res.body as RoomDto
}

export async function joinRoom(player: GuestSession, roomId: string): Promise<RoomDto> {
  const { baseUrl } = requireApp()
  const res = await request(baseUrl)
    .post(`/api/rooms/${roomId}/join`)
    .set('Authorization', `Bearer ${player.accessToken}`)
  if (res.status !== 201) {
    throw new Error(`joinRoom failed: ${res.status} ${JSON.stringify(res.body)}`)
  }
  return res.body as RoomDto
}

// ---------------------------------------------------------------------------
// Socket helpers
// ---------------------------------------------------------------------------

export type AppTestSocket = Socket<ServerToClientEvents, ClientToServerEvents>

const openSockets = new Set<AppTestSocket>()

/** Opens a real `socket.io-client` connection to the `/rt` namespace,
 * authenticated the same way a real client is (`handshake.auth.token`).
 * Auto-reconnection is deliberately disabled — the "reconnect" scenario
 * models a dropped connection by opening a brand new `connect()`, which is
 * both more deterministic in a test and closer to what actually happens on
 * a real client after a network blip (a fresh Socket.IO handshake). */
export function connect(accessToken: string): Promise<AppTestSocket> {
  const { baseUrl } = requireApp()
  return new Promise((resolve, reject) => {
    const socket: AppTestSocket = io(`${baseUrl}${SOCKET_NAMESPACE}`, {
      auth: { token: accessToken },
      transports: ['websocket'],
      forceNew: true,
      reconnection: false,
    })
    const onConnect = () => {
      socket.off('connect_error', onError)
      openSockets.add(socket)
      resolve(socket)
    }
    const onError = (err: Error) => {
      socket.off('connect', onConnect)
      reject(err)
    }
    socket.once('connect', onConnect)
    socket.once('connect_error', onError)
  })
}

/** Milliseconds given to the SERVER to finish processing a client-initiated
 * disconnect (RealtimeGateway's 'disconnecting' handler: an awaited chain of
 * `fetchSockets()`, presence bookkeeping, and a Redis-backed
 * `broadcastRoomState`) before the caller is allowed to proceed.
 * `socket.disconnect()` only closes the client's own side of the transport —
 * the server-side handler is an independent async chain the server starts
 * once it notices the connection dropped, and is not guaranteed to have
 * finished by the time the client's own call resolves.
 *
 * This suite surfaced a real, 100%-reproducible shutdown-ordering bug this
 * value alone would NOT have been enough to paper over: `RedisService` used
 * to quit its Redis connections in `OnModuleDestroy`, which NestJS's
 * `close()` runs BEFORE it closes the Socket.IO server — i.e. before
 * `@socket.io/redis-adapter`'s own per-namespace cleanup (`punsubscribe`/
 * `unsubscribe`) needs them. Fixed at the source in
 * `backend/src/redis/redis.service.ts` by moving that to
 * `OnApplicationShutdown` instead (see that file's comment, and this task's
 * report) — that fix is required regardless of this constant's value. What
 * THIS wait still guards, now that Redis stays open for the connections'
 * true full lifetime, is the ordinary case of a disconnect's own multi-hop
 * async chain (above) still being in flight when `stopApp()` is called
 * moments later — a real but bounded race, not a structural one. */
const DISCONNECT_SETTLE_MS = 1_500

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Disconnects every socket opened via `connect()` so nothing keeps the
 * Jest process alive across — or after — a test, then gives the server a
 * moment to finish processing those disconnects (see `DISCONNECT_SETTLE_MS`)
 * before resolving. Safe to call repeatedly, including when there is
 * nothing to close. */
export async function closeAllSockets(): Promise<void> {
  if (openSockets.size === 0) return
  for (const socket of openSockets) {
    socket.removeAllListeners()
    socket.disconnect()
  }
  openSockets.clear()
  await sleep(DISCONNECT_SETTLE_MS)
}

type PayloadOf<E extends keyof ClientToServerEvents> = Parameters<ClientToServerEvents[E]>[0]
type AckDataOf<E extends keyof ClientToServerEvents> = Parameters<
  ClientToServerEvents[E]
>[1] extends (r: Ack<infer T>) => void
  ? T
  : never

/** Socket.IO client's own typed `emit` overloads cannot be resolved through
 * a generic `E` parameter — the same problem `RealtimeGateway.emitToUser`
 * solves for the server side by casting the target to a small single-purpose
 * interface rather than to `any`. Mirrored here. */
interface AckEmittable<E extends keyof ClientToServerEvents> {
  emit(event: E, payload: PayloadOf<E>, ack: (response: Ack<AckDataOf<E>>) => void): boolean
}

/** Same problem, same fix, for the listener side: `Socket#on`/`once`/`off`
 * resolve their listener's type through a conditional type keyed on
 * `SocketReservedEvents` first, which does not simplify through a generic
 * `E`. Every `waitFor`-family helper below narrows through this instead of
 * calling `socket.on`/`once`/`off` directly. */
interface ListenableFor<E extends keyof ServerToClientEvents> {
  on(event: E, listener: (payload: Parameters<ServerToClientEvents[E]>[0]) => void): void
  once(event: E, listener: (payload: Parameters<ServerToClientEvents[E]>[0]) => void): void
  off(event: E, listener: (payload: Parameters<ServerToClientEvents[E]>[0]) => void): void
}

function listenerFor<E extends keyof ServerToClientEvents>(
  socket: AppTestSocket,
  _event: E,
): ListenableFor<E> {
  return socket as unknown as ListenableFor<E>
}

const DEFAULT_TIMEOUT_MS = 8_000

/** Emits a client -> server event and resolves with its ack `data`.
 * Rejects if the ack itself reports `ok: false`.
 *
 * IMPORTANT: this does NOT cover `game:action`'s in-game rejections. Per
 * `RealtimeGateway.onGameAction`'s own doc comment, a rejected game action
 * (e.g. acting out of turn) still acks `{ ok: true }` — the rejection is
 * pushed to the acting socket as a separate `error` event instead. Use
 * `waitFor(socket, 'error')` for that (see the "wrong turn" scenario). */
export function emit<E extends keyof ClientToServerEvents>(
  socket: AppTestSocket,
  event: E,
  payload: PayloadOf<E>,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<AckDataOf<E>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`ack for "${String(event)}" did not arrive within ${timeoutMs}ms`))
    }, timeoutMs)
    const target = socket as unknown as AckEmittable<E>
    target.emit(event, payload, (response) => {
      clearTimeout(timer)
      if (!response.ok) {
        const code = response.error?.code ?? 'unknown'
        const message = response.error?.message ?? ''
        reject(new Error(`"${String(event)}" was rejected: ${code} — ${message}`))
        return
      }
      resolve(response.data as AckDataOf<E>)
    })
  })
}

/** Resolves with the payload of the next `event` this socket receives.
 * Bounded by `timeoutMs` so a wiring bug surfaces as a clear timeout rather
 * than a hung test. Register this BEFORE triggering whatever is expected to
 * cause the event, the same way the whole suite does. */
export function waitFor<E extends keyof ServerToClientEvents>(
  socket: AppTestSocket,
  event: E,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<Parameters<ServerToClientEvents[E]>[0]> {
  return new Promise((resolve, reject) => {
    const listenable = listenerFor(socket, event)
    const timer = setTimeout(() => {
      listenable.off(event, handler)
      reject(new Error(`"${String(event)}" did not arrive within ${timeoutMs}ms`))
    }, timeoutMs)
    const handler = (payload: Parameters<ServerToClientEvents[E]>[0]) => {
      clearTimeout(timer)
      resolve(payload)
    }
    listenable.once(event, handler)
  })
}

/** The inverse of `waitFor`: resolves once `windowMs` has elapsed with no
 * occurrence of `event`, rejects the instant one arrives. Used to assert a
 * broadcast that must NOT happen (e.g. bystanders of a rejected
 * `game:action` must receive no `game:state`). */
export function expectNoEvent<E extends keyof ServerToClientEvents>(
  socket: AppTestSocket,
  event: E,
  windowMs = 1_000,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const listenable = listenerFor(socket, event)
    const handler = (payload: Parameters<ServerToClientEvents[E]>[0]) => {
      clearTimeout(timer)
      reject(new Error(`expected no "${String(event)}", but received ${JSON.stringify(payload)}`))
    }
    const timer = setTimeout(() => {
      listenable.off(event, handler)
      resolve()
    }, windowMs)
    listenable.once(event, handler)
  })
}

/** Waits through as many `room:state` broadcasts as it takes for `status` to
 * appear — unlike `waitFor`, which only ever looks at the next one. Needed
 * because a finished game's room passes through `results` before
 * `GameRuntimeService`'s own `RESULTS_TO_LOBBY_MS` timer returns it to
 * `lobby`, so more than one `room:state` arrives before the one we want. */
export function waitForRoomStatus(
  socket: AppTestSocket,
  status: RoomStatus,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<RoomDto> {
  return new Promise((resolve, reject) => {
    const listenable = listenerFor(socket, 'room:state')
    const timer = setTimeout(() => {
      listenable.off('room:state', handler)
      reject(new Error(`room never reached status "${status}" within ${timeoutMs}ms`))
    }, timeoutMs)
    const handler = (dto: RoomDto) => {
      if (dto.status === status) {
        clearTimeout(timer)
        listenable.off('room:state', handler)
        resolve(dto)
      }
    }
    listenable.on('room:state', handler)
  })
}
