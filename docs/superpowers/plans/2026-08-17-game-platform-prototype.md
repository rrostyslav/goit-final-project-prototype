# Game Platform Prototype — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a working prototype of a persistent voice-chat room platform where up to 10 friends play mini-games together, per `docs/superpowers/specs/2026-08-17-game-platform-design.md`.

**Architecture:** Nx package-based monorepo. NestJS backend owns all game state through pure reducers living in a framework-free `game-core` library; Socket.IO delivers per-player state projections; LiveKit SFU handles voice independently of the game lifecycle; Next.js frontend renders lobby/game/results as one non-remounting page so the voice connection survives game transitions.

**Tech Stack:** pnpm workspaces + Nx, TypeScript 5 (strict everywhere), NestJS 11, Sequelize (`sequelize-typescript`) + PostgreSQL, ioredis + Redis, Socket.IO 4 with Redis adapter, LiveKit (`livekit-server-sdk` / `livekit-client`), Next.js 15 + React 19 + Tailwind 4 + Zustand 5, Vitest (libs) + Jest (backend), Biome 2 for lint/format, Terraform + Helm + GitHub Actions for infra configs.

## Global Constraints

- **Package manager is pnpm.** Never run `npm install` or `yarn`. Workspace deps use `workspace:*`.
- **Lint/format is Biome, not ESLint/Prettier.** Do not add ESLint or Prettier to any project. Verify with `pnpm biome check .`.
- **TypeScript strict mode on in every project.** `strict: true`, `noUncheckedIndexedAccess: true`.
- **Dependency direction is enforced and must not be violated:** `frontend → shared`; `backend → shared, game-core`; `game-core → shared`; `shared → nothing`. `game-core` must never import NestJS, Sequelize, Redis, Socket.IO, or anything from `backend/`.
- **Game reducers are pure.** No `Date.now()`, no `Math.random()`, no I/O inside `libs/game-core`. Time and seed arrive via context objects.
- **Max players per room is 10** (`ROOM_MAX_PLAYERS = 10`), reconnect grace period is **45 seconds** (`RECONNECT_GRACE_MS = 45_000`). Both live in `libs/shared/src/constants.ts`.
- **Room codes are 6 characters**, uppercase, from alphabet `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` (no `I`, `O`, `0`, `1`).
- **i18n:** every user-facing string on the frontend goes through the dictionary; languages `uk` and `en`. Word decks are seeded per language.
- **Never run `terraform apply`, `terraform plan` against real AWS, `helm install`, or `kubectl apply`.** Infra tasks produce configs only. Validation is `terraform init -backend=false`, `terraform validate`, `terraform fmt -check`, `helm lint`.
- **Commit after every task** with a Conventional Commits message. Commits go straight to `main` (user authorized this).

---

## File Structure

```
package.json                      pnpm workspace root, Nx targets
pnpm-workspace.yaml
nx.json                           package-based Nx config, target defaults + cache
biome.json                        lint/format for the whole repo
tsconfig.base.json                shared compiler options
docker-compose.yml                postgres, redis, livekit
.env.example                      every env var the stack reads
livekit.dev.yaml                  LiveKit dev config (keys, turn.enabled)

libs/shared/                      @gp/shared — no runtime deps
  src/constants.ts                ROOM_MAX_PLAYERS, RECONNECT_GRACE_MS, room-code alphabet
  src/domain.ts                   UserId, RoomDto, RoomMemberDto, ChatMessageDto, ...
  src/games.ts                    GameId, GameMeta, GAME_CATALOG
  src/game-view.ts                PlayerView union, GameAction union, Card
  src/events.ts                   ClientToServerEvents, ServerToClientEvents, ack types
  src/index.ts                    barrel

libs/game-core/                   @gp/game-core — pure TS, zero framework deps
  src/contract.ts                 GameDefinition, Effect, InitContext, ActionContext
  src/rng.ts                      seeded PRNG + shuffle
  src/registry.ts                 GAME_DEFINITIONS lookup
  src/engines/word-engine.ts      turn rotation, round timer, deck draw, scoring
  src/engines/card-engine.ts      36-card deck, deal, trump, turn order, beat rules
  src/games/alias.ts              Alias + Hat (one definition, two modes)
  src/games/crocodile.ts          word-engine + drawing
  src/games/durak.ts              card-engine
  src/games/nine.ts               card-engine
  test/                           Vitest specs

backend/                          NestJS
  src/main.ts, src/app.module.ts
  src/config/                     typed env config
  src/database/                   Sequelize models, migrations, seeders
  src/auth/                       guest, email, refresh, upgrade, Google (flagged)
  src/users/                      profile
  src/friends/                    friendships + requests
  src/rooms/                      CRUD, codes, browser, membership, moderation
  src/realtime/                   gateway, presence, chat, drawing channel
  src/games/                      GameRuntimeService, timers, persistence
  src/voice/                      LiveKit token issuing
  src/notifications/              in-app notifications
  test/                           Jest unit + e2e socket spec

frontend/                         Next.js App Router
  src/app/                        routes
  src/components/                 UI + game screens
  src/lib/                        api client, socket client, i18n, stores

infra/                            Terraform root + modules/
charts/                           backend-api, frontend, livekit
.github/workflows/                ci.yml, backend-deploy.yml, frontend-deploy.yml
```

---

# Phase 0 — Foundation

### Task 1: Monorepo skeleton

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `nx.json`, `biome.json`, `tsconfig.base.json`, `.gitignore`, `.npmrc`
- Create: `libs/shared/package.json`, `libs/shared/tsconfig.json`, `libs/shared/src/index.ts`

**Interfaces:**
- Produces: workspace packages `@gp/shared` (path `libs/shared`) and root scripts `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`. Later tasks add projects by creating a `package.json` under `libs/*`, `backend/`, or `frontend/`.
- Produces: `libs/shared` builds with `tsc` to `libs/shared/dist`, `main` = `dist/index.js`, `types` = `dist/index.d.ts`.

- [ ] **Step 1: Create the workspace root**

`pnpm-workspace.yaml`:
```yaml
packages:
  - 'libs/*'
  - 'backend'
  - 'frontend'
```

`.npmrc`:
```
auto-install-peers=true
strict-peer-dependencies=false
```

Root `package.json`:
```json
{
  "name": "goit-game-platform",
  "private": true,
  "packageManager": "pnpm@11.2.2",
  "scripts": {
    "build": "nx run-many -t build",
    "test": "nx run-many -t test",
    "typecheck": "nx run-many -t typecheck",
    "lint": "biome check .",
    "format": "biome check --write .",
    "dev": "nx run-many -t dev --parallel=3",
    "infra:up": "docker compose up -d",
    "infra:down": "docker compose down"
  },
  "devDependencies": {
    "@biomejs/biome": "^2.0.0",
    "nx": "^21.0.0",
    "typescript": "^5.7.0"
  }
}
```

- [ ] **Step 2: Configure Nx in package-based mode**

`nx.json` — no plugins, targets come from each project's `package.json` scripts:
```json
{
  "$schema": "./node_modules/nx/schemas/nx-schema.json",
  "defaultBase": "main",
  "targetDefaults": {
    "build": {
      "dependsOn": ["^build"],
      "cache": true,
      "outputs": ["{projectRoot}/dist", "{projectRoot}/.next"]
    },
    "typecheck": { "dependsOn": ["^build"], "cache": true },
    "test": { "dependsOn": ["^build"], "cache": true },
    "dev": { "dependsOn": ["^build"], "cache": false }
  }
}
```

- [ ] **Step 3: Configure Biome and TypeScript**

`biome.json`:
```json
{
  "$schema": "./node_modules/@biomejs/biome/configuration_schema.json",
  "vcs": { "enabled": true, "clientKind": "git", "useIgnoreFile": true },
  "files": { "includes": ["**", "!**/dist", "!**/.next", "!**/node_modules", "!**/coverage"] },
  "formatter": { "enabled": true, "indentStyle": "space", "indentWidth": 2, "lineWidth": 100 },
  "linter": {
    "enabled": true,
    "rules": {
      "recommended": true,
      "style": { "useImportType": "error" },
      "suspicious": { "noExplicitAny": "error" }
    }
  },
  "javascript": { "formatter": { "quoteStyle": "single", "semicolons": "asNeeded" } }
}
```

`tsconfig.base.json`:
```json
{
  "compilerOptions": {
    "target": "ES2023",
    "lib": ["ES2023"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": true,
    "sourceMap": true
  }
}
```

`.gitignore`:
```
node_modules/
dist/
.next/
coverage/
.nx/
.env
.env.local
*.log
.terraform/
*.tfstate
*.tfstate.*
```

- [ ] **Step 4: Create the `@gp/shared` package stub**

`libs/shared/package.json`:
```json
{
  "name": "@gp/shared",
  "version": "0.0.1",
  "private": true,
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  }
}
```

`libs/shared/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "module": "CommonJS",
    "moduleResolution": "node",
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src/**/*"]
}
```

`libs/shared/src/index.ts`:
```ts
export const SHARED_PACKAGE_VERSION = '0.0.1'
```

- [ ] **Step 5: Install and verify**

Run: `pnpm install && pnpm build && pnpm lint`
Expected: install succeeds, `libs/shared/dist/index.js` exists, Biome reports no errors.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore: scaffold nx + pnpm monorepo with biome and shared lib"
```

---

### Task 2: Local infrastructure (docker-compose)

**Files:**
- Create: `docker-compose.yml`, `livekit.dev.yaml`, `.env.example`

**Interfaces:**
- Produces: Postgres on `localhost:5432` (`gameplatform`/`gameplatform`/`gameplatform`), Redis on `localhost:6379`, LiveKit on `localhost:7880` (ws) with dev API key `devkey` / secret `devsecretdevsecretdevsecretdevsecret32`.
- Produces: `.env.example` documenting every variable the backend and frontend read. Later tasks that add an env var must append it here.

- [ ] **Step 1: Write `docker-compose.yml`**

```yaml
services:
  postgres:
    image: postgres:17-alpine
    environment:
      POSTGRES_USER: gameplatform
      POSTGRES_PASSWORD: gameplatform
      POSTGRES_DB: gameplatform
    ports: ['5432:5432']
    volumes: ['pgdata:/var/lib/postgresql/data']
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U gameplatform']
      interval: 5s
      timeout: 3s
      retries: 10

  redis:
    image: redis:7-alpine
    ports: ['6379:6379']
    healthcheck:
      test: ['CMD', 'redis-cli', 'ping']
      interval: 5s
      timeout: 3s
      retries: 10

  livekit:
    image: livekit/livekit-server:latest
    command: --config /etc/livekit.yaml
    ports:
      - '7880:7880'
      - '7881:7881'
      - '50000-50100:50000-50100/udp'
    volumes:
      - ./livekit.dev.yaml:/etc/livekit.yaml:ro

volumes:
  pgdata:
```

- [ ] **Step 2: Write `livekit.dev.yaml`**

```yaml
port: 7880
rtc:
  tcp_port: 7881
  port_range_start: 50000
  port_range_end: 50100
  use_external_ip: false
turn:
  enabled: true
  domain: localhost
  tls_port: 5349
  udp_port: 3478
keys:
  devkey: devsecretdevsecretdevsecretdevsecret32
logging:
  level: info
```

- [ ] **Step 3: Write `.env.example`**

```
NODE_ENV=development
PORT=4000
CORS_ORIGIN=http://localhost:3000

DATABASE_URL=postgres://gameplatform:gameplatform@localhost:5432/gameplatform
REDIS_URL=redis://localhost:6379

JWT_ACCESS_SECRET=dev-access-secret-change-me
JWT_REFRESH_SECRET=dev-refresh-secret-change-me
JWT_ACCESS_TTL=15m
JWT_REFRESH_TTL=30d

# Voice is disabled when LIVEKIT_URL is empty
LIVEKIT_URL=ws://localhost:7880
LIVEKIT_API_KEY=devkey
LIVEKIT_API_SECRET=devsecretdevsecretdevsecretdevsecret32

# Google OAuth is disabled when these are empty
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_CALLBACK_URL=http://localhost:4000/api/auth/google/callback

NEXT_PUBLIC_API_URL=http://localhost:4000
NEXT_PUBLIC_WS_URL=http://localhost:4000
```

- [ ] **Step 4: Verify the stack starts**

Run: `docker compose up -d && sleep 10 && docker compose ps`
Expected: `postgres` and `redis` healthy, `livekit` running.
Then run: `docker compose logs livekit --tail 20` — expected: a line containing `starting LiveKit server`.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: add docker-compose stack with postgres, redis and livekit"
```

---

### Task 3: Shared contract (`@gp/shared`)

**Files:**
- Create: `libs/shared/src/constants.ts`, `domain.ts`, `games.ts`, `game-view.ts`, `events.ts`
- Modify: `libs/shared/src/index.ts`

**Interfaces:**
- Produces: every type below. Backend, frontend and game-core all import from `@gp/shared`. **These names are the contract — later tasks must not rename them.**

- [ ] **Step 1: Write `constants.ts`**

```ts
export const ROOM_MAX_PLAYERS = 10
export const ROOM_MIN_PLAYERS = 2
export const RECONNECT_GRACE_MS = 45_000
export const ROOM_CODE_LENGTH = 6
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
export const ROOM_CREATE_RATE_LIMIT = { max: 5, windowMs: 60_000 }
export const CHAT_MAX_LENGTH = 500
export const DRAW_STROKE_LOG_LIMIT = 2000
export const SUPPORTED_LOCALES = ['uk', 'en'] as const
export type Locale = (typeof SUPPORTED_LOCALES)[number]
```

- [ ] **Step 2: Write `domain.ts`**

```ts
import type { GameId } from './games'

export type UserId = string
export type RoomId = string
export type SessionId = string
export type PlayerId = UserId

export type RoomStatus = 'lobby' | 'in_game' | 'results'
export type RoomVisibility = 'private' | 'public'
export type ConnectionState = 'online' | 'disconnected'
export type FriendshipStatus = 'pending' | 'accepted' | 'blocked'

export interface PublicUser {
  id: UserId
  nickname: string
  avatarUrl: string | null
  isGuest: boolean
}

export interface RoomMemberDto {
  user: PublicUser
  isHost: boolean
  isReady: boolean
  connection: ConnectionState
  joinedAt: string
}

export interface RoomDto {
  id: RoomId
  code: string
  visibility: RoomVisibility
  status: RoomStatus
  hostId: UserId
  maxPlayers: number
  selectedGameId: GameId | null
  members: RoomMemberDto[]
  createdAt: string
}

/** Row in the public room browser. Never includes member identities. */
export interface RoomBrowserEntry {
  id: RoomId
  code: string
  status: RoomStatus
  selectedGameId: GameId | null
  playerCount: number
  maxPlayers: number
  hostNickname: string
  createdAt: string
}

export interface ChatMessageDto {
  id: string
  roomId: RoomId
  author: PublicUser
  text: string
  sentAt: string
}

export interface AuthTokens {
  accessToken: string
  user: PublicUser
}

export interface NotificationDto {
  id: string
  type: 'friend_request' | 'room_invite'
  payload: Record<string, string>
  createdAt: string
  readAt: string | null
}

export interface GameResultDto {
  sessionId: SessionId
  gameId: GameId
  userId: UserId
  nickname: string
  score: number
  placement: number
}

export interface MatchHistoryEntry {
  sessionId: SessionId
  gameId: GameId
  roomCode: string
  score: number
  placement: number
  playerCount: number
  endedAt: string
}
```

- [ ] **Step 3: Write `games.ts`**

```ts
export type GameId = 'alias' | 'hat' | 'crocodile' | 'durak' | 'nine'
export type EngineId = 'word' | 'card'

export interface GameMeta {
  id: GameId
  engine: EngineId
  titleKey: string
  minPlayers: number
  maxPlayers: number
  teamBased: boolean
}

export const GAME_CATALOG: readonly GameMeta[] = [
  { id: 'alias', engine: 'word', titleKey: 'game.alias', minPlayers: 4, maxPlayers: 10, teamBased: true },
  { id: 'hat', engine: 'word', titleKey: 'game.hat', minPlayers: 4, maxPlayers: 10, teamBased: true },
  { id: 'crocodile', engine: 'word', titleKey: 'game.crocodile', minPlayers: 3, maxPlayers: 10, teamBased: false },
  { id: 'durak', engine: 'card', titleKey: 'game.durak', minPlayers: 2, maxPlayers: 6, teamBased: false },
  { id: 'nine', engine: 'card', titleKey: 'game.nine', minPlayers: 2, maxPlayers: 6, teamBased: false },
]

export function getGameMeta(id: GameId): GameMeta {
  const meta = GAME_CATALOG.find((g) => g.id === id)
  if (!meta) throw new Error(`Unknown game: ${id}`)
  return meta
}
```

- [ ] **Step 4: Write `game-view.ts`**

```ts
import type { GameId, PlayerId } from './index'

export type Suit = 'spades' | 'hearts' | 'diamonds' | 'clubs'
export type Rank = 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14
export interface Card { suit: Suit; rank: Rank }

export type GamePhase = 'preparing' | 'active' | 'between_rounds' | 'finished'

export interface TeamView {
  id: string
  name: string
  memberIds: PlayerId[]
  score: number
}

export interface WordGameView {
  kind: 'word'
  gameId: Extract<GameId, 'alias' | 'hat' | 'crocodile'>
  phase: GamePhase
  round: number
  totalRounds: number
  teams: TeamView[]
  activeTeamId: string | null
  explainerId: PlayerId | null
  /** Present only for the explainer. Everyone else receives null. */
  secretWord: string | null
  roundEndsAt: number | null
  roundPaused: boolean
  lastResults: { word: string; guessed: boolean }[]
  winnerTeamIds: string[]
}

export interface CardOpponentView {
  playerId: PlayerId
  cardCount: number
  finished: boolean
}

export interface CardGameView {
  kind: 'card'
  gameId: Extract<GameId, 'durak' | 'nine'>
  phase: GamePhase
  /** Only the viewer's own cards. */
  hand: Card[]
  opponents: CardOpponentView[]
  table: { attack: Card; defend: Card | null }[]
  layout: Card[]
  trump: Card | null
  deckCount: number
  turnPlayerId: PlayerId | null
  defenderId: PlayerId | null
  placements: PlayerId[]
}

export type PlayerView = WordGameView | CardGameView

export type GameAction =
  | { type: 'word/start_round' }
  | { type: 'word/correct' }
  | { type: 'word/skip' }
  | { type: 'word/end_round' }
  | { type: 'card/attack'; card: Card }
  | { type: 'card/defend'; card: Card; against: Card }
  | { type: 'card/take' }
  | { type: 'card/pass' }
  | { type: 'nine/play'; card: Card }
  | { type: 'nine/pass' }

export type GameEvent =
  | { type: 'round_started'; round: number; explainerId: PlayerId }
  | { type: 'word_scored'; playerId: PlayerId; guessed: boolean }
  | { type: 'round_ended'; round: number }
  | { type: 'card_played'; playerId: PlayerId; card: Card }
  | { type: 'cards_taken'; playerId: PlayerId; count: number }
  | { type: 'player_finished'; playerId: PlayerId; placement: number }
  | { type: 'game_finished' }

export interface DrawStroke {
  points: [number, number][]
  color: string
  width: number
}
```

- [ ] **Step 5: Write `events.ts`**

```ts
import type {
  ChatMessageDto, NotificationDto, PlayerId, RoomDto, RoomId,
} from './domain'
import type { DrawStroke, GameAction, GameEvent, PlayerView } from './game-view'
import type { GameId } from './games'

export interface Ack<T> {
  ok: boolean
  data?: T
  error?: { code: string; message: string }
}

export interface VoiceCredentials {
  enabled: boolean
  url: string | null
  token: string | null
  roomName: string | null
}

export interface ClientToServerEvents {
  'room:join': (p: { roomId: RoomId }, ack: (r: Ack<RoomDto>) => void) => void
  'room:leave': (p: { roomId: RoomId }, ack: (r: Ack<null>) => void) => void
  'room:ready': (p: { roomId: RoomId; isReady: boolean }, ack: (r: Ack<null>) => void) => void
  'room:chat': (p: { roomId: RoomId; text: string }, ack: (r: Ack<null>) => void) => void
  'room:select_game': (p: { roomId: RoomId; gameId: GameId }, ack: (r: Ack<null>) => void) => void
  'room:vote_game': (p: { roomId: RoomId; gameId: GameId }, ack: (r: Ack<null>) => void) => void
  'room:kick': (p: { roomId: RoomId; userId: PlayerId }, ack: (r: Ack<null>) => void) => void
  'room:ban': (p: { roomId: RoomId; userId: PlayerId }, ack: (r: Ack<null>) => void) => void
  'room:transfer_host': (p: { roomId: RoomId; userId: PlayerId }, ack: (r: Ack<null>) => void) => void
  'game:start': (p: { roomId: RoomId }, ack: (r: Ack<null>) => void) => void
  'game:action': (p: { roomId: RoomId; action: GameAction }, ack: (r: Ack<null>) => void) => void
  'draw:stroke': (p: { roomId: RoomId; stroke: DrawStroke }) => void
  'draw:clear': (p: { roomId: RoomId }) => void
  'voice:token': (p: { roomId: RoomId }, ack: (r: Ack<VoiceCredentials>) => void) => void
}

export interface ServerToClientEvents {
  'room:state': (p: RoomDto) => void
  'room:votes': (p: Record<string, PlayerId[]>) => void
  'chat:message': (p: ChatMessageDto) => void
  'game:started': (p: { gameId: GameId; sessionId: string }) => void
  'game:state': (p: PlayerView) => void
  'game:event': (p: GameEvent) => void
  'game:ended': (p: { sessionId: string; standings: { playerId: PlayerId; score: number; placement: number }[] }) => void
  'draw:stroke': (p: DrawStroke) => void
  'draw:sync': (p: DrawStroke[]) => void
  'room:kicked': (p: { reason: 'kick' | 'ban' }) => void
  notification: (p: NotificationDto) => void
  error: (p: { code: string; message: string }) => void
}

export const SOCKET_NAMESPACE = '/rt'
```

- [ ] **Step 6: Update the barrel and verify**

`libs/shared/src/index.ts`:
```ts
export * from './constants'
export * from './domain'
export * from './events'
export * from './game-view'
export * from './games'
```

Run: `pnpm build && pnpm lint`
Expected: `libs/shared/dist/index.d.ts` exists and exports `RoomDto`; Biome clean.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(shared): define domain, game view and socket event contracts"
```

---

# Phase 1 — Backend foundation and data

### Task 4: NestJS app skeleton

**Files:**
- Create: `backend/package.json`, `backend/tsconfig.json`, `backend/nest-cli.json`, `backend/jest.config.js`
- Create: `backend/src/main.ts`, `backend/src/app.module.ts`, `backend/src/config/env.config.ts`, `backend/src/config/config.module.ts`
- Create: `backend/src/health/health.controller.ts`, `backend/src/health/health.module.ts`
- Modify: `.env.example` (no new vars — verify all consumed vars are listed)

**Interfaces:**
- Produces: `AppConfig` type with typed getters — `config.get('DATABASE_URL')` style is banned; use the injected `AppConfigService` with properties `databaseUrl`, `redisUrl`, `jwtAccessSecret`, `jwtRefreshSecret`, `jwtAccessTtl`, `jwtRefreshTtl`, `livekitUrl`, `livekitApiKey`, `livekitApiSecret`, `googleClientId`, `googleClientSecret`, `googleCallbackUrl`, `corsOrigin`, `port`. `livekitUrl` and `googleClientId` are `string | null` (empty env → `null`).
- Produces: `GET /api/health` returning `{ status: 'ok', voice: boolean, oauth: boolean }`.
- Produces: global route prefix `api`, global `ValidationPipe` with `whitelist: true, transform: true`, CORS from `corsOrigin` with `credentials: true`, `cookie-parser` enabled.

- [ ] **Step 1: Create the package**

`backend/package.json` — dependencies: `@nestjs/common`, `@nestjs/core`, `@nestjs/platform-express`, `@nestjs/config`, `@nestjs/jwt`, `@nestjs/passport`, `@nestjs/websockets`, `@nestjs/platform-socket.io`, `passport`, `passport-jwt`, `passport-google-oauth20`, `sequelize`, `sequelize-typescript`, `pg`, `pg-hstore`, `ioredis`, `@socket.io/redis-adapter`, `socket.io`, `bcryptjs`, `class-validator`, `class-transformer`, `cookie-parser`, `livekit-server-sdk`, `reflect-metadata`, `rxjs`, `zod`, `@gp/shared: workspace:*`, `@gp/game-core: workspace:*`.
devDependencies: `@nestjs/cli`, `@nestjs/testing`, `@types/*`, `jest`, `ts-jest`, `ts-node`, `sequelize-cli`, `socket.io-client`, `supertest`.

Scripts:
```json
{
  "dev": "nest start --watch",
  "build": "nest build",
  "start": "node dist/main.js",
  "typecheck": "tsc -p tsconfig.json --noEmit",
  "test": "jest --passWithNoTests",
  "test:e2e": "jest --config jest.e2e.config.js --runInBand",
  "db:migrate": "sequelize-cli db:migrate",
  "db:seed": "sequelize-cli db:seed:all"
}
```

`backend/tsconfig.json` extends `../tsconfig.base.json` with `module: CommonJS`, `experimentalDecorators: true`, `emitDecoratorMetadata: true`, `outDir: dist`, `rootDir: src`, `lib: ["ES2023"]`, `types: ["node", "jest"]`.

- [ ] **Step 2: Write the typed config service**

`backend/src/config/env.config.ts` validates `process.env` with a zod schema and exposes `AppConfigService` as an injectable class whose constructor parses once and throws on invalid config. Empty-string `LIVEKIT_URL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` map to `null`.

```ts
const schema = z.object({
  NODE_ENV: z.string().default('development'),
  PORT: z.coerce.number().default(4000),
  CORS_ORIGIN: z.string().default('http://localhost:3000'),
  DATABASE_URL: z.string(),
  REDIS_URL: z.string(),
  JWT_ACCESS_SECRET: z.string().min(8),
  JWT_REFRESH_SECRET: z.string().min(8),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL: z.string().default('30d'),
  LIVEKIT_URL: z.string().optional().transform((v) => v || null),
  LIVEKIT_API_KEY: z.string().optional().transform((v) => v || null),
  LIVEKIT_API_SECRET: z.string().optional().transform((v) => v || null),
  GOOGLE_CLIENT_ID: z.string().optional().transform((v) => v || null),
  GOOGLE_CLIENT_SECRET: z.string().optional().transform((v) => v || null),
  GOOGLE_CALLBACK_URL: z.string().default('http://localhost:4000/api/auth/google/callback'),
})
```

`AppConfigService` also exposes `get voiceEnabled(): boolean` (`livekitUrl !== null && livekitApiKey !== null && livekitApiSecret !== null`) and `get oauthEnabled(): boolean`.

- [ ] **Step 3: Write `main.ts` and `app.module.ts`**

`main.ts` bootstraps Nest, sets `app.setGlobalPrefix('api')`, enables CORS with `origin: config.corsOrigin, credentials: true`, adds `cookieParser()`, adds the global `ValidationPipe`, listens on `config.port`.

`app.module.ts` imports `AppConfigModule` (global) and `HealthModule`.

- [ ] **Step 4: Write the health endpoint test**

`backend/test/health.spec.ts`:
```ts
import { Test } from '@nestjs/testing'
import { HealthController } from '../src/health/health.controller'
import { AppConfigService } from '../src/config/env.config'

describe('HealthController', () => {
  it('reports voice and oauth availability', async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [{ provide: AppConfigService, useValue: { voiceEnabled: true, oauthEnabled: false } }],
    }).compile()

    expect(moduleRef.get(HealthController).check()).toEqual({
      status: 'ok', voice: true, oauth: false,
    })
  })
})
```

- [ ] **Step 5: Run the test to verify it fails**

Run: `cd backend && pnpm test`
Expected: FAIL — `HealthController` not found.

- [ ] **Step 6: Implement until the test passes**

Run: `cd backend && pnpm test && pnpm build`
Expected: PASS, `backend/dist/main.js` exists.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(backend): scaffold nestjs app with typed config and health endpoint"
```

---

### Task 5: Database models and migrations

**Files:**
- Create: `backend/.sequelizerc`, `backend/src/database/config.js`, `backend/src/database/database.module.ts`
- Create: `backend/src/database/models/{user,friendship,room,room-member,room-ban,game-session,game-result,word-deck,word-deck-entry,notification}.model.ts`
- Create: `backend/src/database/migrations/20260817000001-init.js`

**Interfaces:**
- Produces: Sequelize models, all registered via `SequelizeModule.forFeature`. Column naming is `snake_case` in the DB, `camelCase` in TS (`underscored: true`).
- Produces: `User` fields `id (uuid pk)`, `email (string|null, unique)`, `passwordHash (string|null)`, `oauthProvider (string|null)`, `oauthId (string|null)`, `nickname (string)`, `avatarUrl (string|null)`, `isGuest (boolean)`, `createdAt`, `updatedAt`.
- Produces: `Room` fields `id`, `code (char(6) unique)`, `visibility ('private'|'public')`, `status ('lobby'|'in_game'|'results')`, `hostId (uuid fk users)`, `maxPlayers (int, default 10)`, `selectedGameId (string|null)`, `inviteToken (uuid)`, `closedAt (date|null)`, timestamps.
- Produces: `RoomMember` fields `id`, `roomId`, `userId`, `isReady`, `joinedAt`, `leftAt (date|null)`; unique index on `(roomId, userId)` where `leftAt IS NULL` is not expressible portably — use a plain unique index on `(roomId, userId)` and reuse the row on rejoin.
- Produces: `RoomBan` `(id, roomId, userId, bannedBy, reason|null, createdAt)`, unique `(roomId, userId)`.
- Produces: `GameSession` `(id, roomId, gameId, state jsonb, startedAt, endedAt|null)`.
- Produces: `GameResult` `(id, sessionId, userId, score int, placement int)`.
- Produces: `WordDeck` `(id, category, language, name)`; `WordDeckEntry` `(id, deckId, word)`.
- Produces: `Friendship` `(id, userId, friendId, status)`, unique `(userId, friendId)`.
- Produces: `Notification` `(id, userId, type, payload jsonb, readAt|null, createdAt)`.

- [ ] **Step 1: Wire Sequelize**

`.sequelizerc` points `config` at `src/database/config.js`, `migrations-path` at `src/database/migrations`, `seeders-path` at `src/database/seeders`. `config.js` reads `DATABASE_URL` from the environment (loading `.env` via `dotenv`) and exports `{ development: { url, dialect: 'postgres' }, production: {...} }`.

`database.module.ts` calls `SequelizeModule.forRootAsync` with `uri: config.databaseUrl`, `models: [...]`, `autoLoadModels: false`, `synchronize: false`, `define: { underscored: true }`.

- [ ] **Step 2: Write the models**

Each model is a `sequelize-typescript` class with `@Table({ tableName: '...', underscored: true })` and typed `@Column` declarations matching the fields listed in Interfaces above. Associations: `Room.belongsTo(User, 'hostId')`, `Room.hasMany(RoomMember)`, `RoomMember.belongsTo(User)`, `GameSession.belongsTo(Room)`, `GameResult.belongsTo(GameSession)`, `GameResult.belongsTo(User)`, `WordDeckEntry.belongsTo(WordDeck)`.

- [ ] **Step 3: Write the init migration**

One migration creating all ten tables with FKs (`onDelete: 'CASCADE'` for room-scoped tables), the unique indexes listed above, and an index on `rooms(visibility, status)` for the room browser.

- [ ] **Step 4: Run the migration against the local database**

Run: `docker compose up -d postgres && cd backend && cp ../.env.example .env && pnpm db:migrate`
Expected: `== 20260817000001-init: migrated`.
Then verify: `docker compose exec -T postgres psql -U gameplatform -d gameplatform -c '\dt'`
Expected: ten tables plus `SequelizeMeta`.

- [ ] **Step 5: Verify the down migration**

Run: `cd backend && pnpm exec sequelize-cli db:migrate:undo && pnpm db:migrate`
Expected: undo succeeds, re-migrate succeeds. (This catches missing `dropTable` ordering.)

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(backend): add sequelize models and initial migration"
```

---

### Task 6: Word deck seeders

**Files:**
- Create: `backend/src/database/seeders/20260817000002-word-decks.js`
- Create: `backend/src/database/data/words.uk.json`, `backend/src/database/data/words.en.json`

**Interfaces:**
- Consumes: `WordDeck`, `WordDeckEntry` from Task 5.
- Produces: four decks — `(category: 'general', language: 'uk')`, `('general', 'en')`, `('crocodile', 'uk')`, `('crocodile', 'en')` — each with **at least 120 words**. Crocodile decks hold concrete depictable nouns; general decks hold mixed nouns/verbs/concepts.
- Note: the deck **reader** (`WordDeckService.loadDeck`) is added in Task 15, not here. This task only writes the data.

- [ ] **Step 1: Write the word data files**

`words.uk.json` shape:
```json
{ "general": ["сонце", "потяг", "..."], "crocodile": ["слон", "парасолька", "..."] }
```
Ukrainian words must be genuinely Ukrainian (not transliterated Russian). English file mirrors the structure.

- [ ] **Step 2: Write the seeder**

The seeder is idempotent: it looks up each `(category, language)` deck, inserts it if absent, then bulk-inserts only words not already present for that deck.

- [ ] **Step 3: Run and verify**

Run: `cd backend && pnpm db:seed`
Then: `docker compose exec -T postgres psql -U gameplatform -d gameplatform -c "select d.category, d.language, count(*) from word_decks d join word_deck_entries e on e.deck_id = d.id group by 1,2 order by 1,2;"`
Expected: four rows, each count ≥ 120.

- [ ] **Step 4: Verify idempotency**

Run: `cd backend && pnpm db:seed`
Then re-run the count query.
Expected: identical counts — no duplicates.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(backend): seed ukrainian and english word decks"
```

---

# Phase 2 — Auth and social

### Task 7: Auth module

**Files:**
- Create: `backend/src/auth/auth.module.ts`, `auth.service.ts`, `auth.controller.ts`, `dto/*.dto.ts`
- Create: `backend/src/auth/strategies/jwt.strategy.ts`, `strategies/google.strategy.ts`
- Create: `backend/src/auth/guards/jwt-auth.guard.ts`, `guards/optional-jwt.guard.ts`
- Create: `backend/src/auth/decorators/current-user.decorator.ts`
- Create: `backend/test/auth.service.spec.ts`

**Interfaces:**
- Consumes: `User` model (Task 5), `AppConfigService` (Task 4), `AuthTokens`, `PublicUser` (Task 3).
- Produces: `AuthService` with
  `createGuest(nickname: string): Promise<AuthTokens & { refreshToken: string }>`,
  `register(email: string, password: string, nickname: string): Promise<...>`,
  `login(email: string, password: string): Promise<...>`,
  `refresh(refreshToken: string): Promise<...>`,
  `upgradeGuest(userId: UserId, email: string, password: string): Promise<...>`,
  `findOrCreateOAuthUser(profile: { provider, providerId, email, nickname, avatarUrl }): Promise<...>`,
  `verifyAccessToken(token: string): Promise<PublicUser>` — used by the WS gateway in Task 14.
- Produces: `@CurrentUser()` param decorator returning `PublicUser`, `JwtAuthGuard` (401 when absent), `OptionalJwtGuard` (attaches user if present).
- Produces: routes `POST /api/auth/guest`, `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/refresh`, `POST /api/auth/logout`, `POST /api/auth/upgrade`, `GET /api/auth/me`, and — only when `config.oauthEnabled` — `GET /api/auth/google`, `GET /api/auth/google/callback`.
- Produces: refresh token set as httpOnly cookie `refresh_token`, `sameSite: 'lax'`, path `/api/auth`.

- [ ] **Step 1: Write the failing tests**

`backend/test/auth.service.spec.ts` covers, with a mocked `User` model:
```ts
it('creates a guest user with isGuest true and no email')
it('rejects registration when the email already exists')
it('rejects login with a wrong password')
it('upgrades a guest in place, keeping the same user id')
it('refuses to upgrade a user that is not a guest')
it('verifyAccessToken rejects a token signed with the refresh secret')
```

The upgrade test is the important one:
```ts
it('upgrades a guest in place, keeping the same user id', async () => {
  const guest = await service.createGuest('Оксана')
  const upgraded = await service.upgradeGuest(guest.user.id, 'o@example.com', 'hunter22')
  expect(upgraded.user.id).toBe(guest.user.id)
  expect(upgraded.user.isGuest).toBe(false)
})
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && pnpm test -- auth.service`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the service, strategies, guards and controller**

Passwords hashed with `bcryptjs` at cost 10. Access tokens carry `{ sub, nickname, isGuest }`. `GoogleStrategy` is registered conditionally — `AuthModule` includes it in `providers` only when `config.oauthEnabled`, and the controller's Google routes return 404 otherwise.

- [ ] **Step 4: Run tests**

Run: `cd backend && pnpm test -- auth.service`
Expected: PASS, six tests.

- [ ] **Step 5: Smoke-test the live endpoints**

Run backend with `pnpm dev`, then:
```bash
curl -s -X POST localhost:4000/api/auth/guest -H 'content-type: application/json' -d '{"nickname":"Тест"}'
```
Expected: JSON with `accessToken` and `user.isGuest === true`.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(backend): add guest, email and oauth authentication"
```

---

### Task 8: Users, friends and notifications

**Files:**
- Create: `backend/src/users/users.module.ts`, `users.service.ts`, `users.controller.ts`
- Create: `backend/src/friends/friends.module.ts`, `friends.service.ts`, `friends.controller.ts`
- Create: `backend/src/notifications/notifications.module.ts`, `notifications.service.ts`, `notifications.controller.ts`
- Create: `backend/test/friends.service.spec.ts`

**Interfaces:**
- Consumes: `Friendship`, `Notification`, `User` models; `JwtAuthGuard`, `@CurrentUser()`.
- Produces: `UsersService.toPublicUser(user: User): PublicUser`, `UsersService.updateProfile(userId, { nickname?, avatarUrl? })`, `UsersService.searchByNickname(query: string, limit: number): Promise<PublicUser[]>`.
- Produces: `FriendsService.sendRequest(fromId, toId)`, `.accept(userId, requestId)`, `.decline(userId, requestId)`, `.remove(userId, friendId)`, `.listFriends(userId): Promise<PublicUser[]>`, `.listIncoming(userId)`, `.listOutgoing(userId)`.
- Produces: `NotificationsService.push(userId, type, payload): Promise<NotificationDto>` — **Task 14 injects this into the gateway to emit `notification` over the socket**; `.list(userId)`, `.markRead(userId, id)`.
- Produces: routes `GET/PATCH /api/users/me`, `GET /api/users/search?q=`, `GET/POST/DELETE /api/friends*`, `GET /api/notifications`, `POST /api/notifications/:id/read`. (`GET /api/users/:id/history` needs `GameHistoryService` and is added in Task 15.)

- [ ] **Step 1: Write the failing tests**

```ts
it('creates a pending friendship on sendRequest')
it('refuses a duplicate request in either direction')
it('refuses a self-request')
it('accept flips status to accepted and listFriends returns the pair symmetrically')
it('remove deletes the friendship for both sides')
```

The symmetry test matters because `Friendship` stores one row per direction:
```ts
it('accept flips status to accepted and listFriends returns the pair symmetrically', async () => {
  const req = await service.sendRequest(alice.id, bohdan.id)
  await service.accept(bohdan.id, req.id)
  expect((await service.listFriends(alice.id)).map((u) => u.id)).toEqual([bohdan.id])
  expect((await service.listFriends(bohdan.id)).map((u) => u.id)).toEqual([alice.id])
})
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && pnpm test -- friends.service`
Expected: FAIL.

- [ ] **Step 3: Implement**

`sendRequest` also calls `NotificationsService.push(toId, 'friend_request', { fromId, fromNickname })`.

- [ ] **Step 4: Run tests**

Run: `cd backend && pnpm test`
Expected: PASS, all suites.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(backend): add profiles, friendships and in-app notifications"
```

---

# Phase 3 — Rooms

### Task 9: Rooms module

**Files:**
- Create: `backend/src/rooms/rooms.module.ts`, `rooms.service.ts`, `rooms.controller.ts`, `room-code.service.ts`, `dto/*.dto.ts`
- Create: `backend/src/rooms/room-mapper.ts`
- Create: `backend/test/room-code.service.spec.ts`, `backend/test/rooms.service.spec.ts`

**Interfaces:**
- Consumes: `Room`, `RoomMember`, `RoomBan`, `User` models; `ROOM_MAX_PLAYERS`, `ROOM_CODE_ALPHABET`, `ROOM_CODE_LENGTH`, `ROOM_CREATE_RATE_LIMIT`; `RoomDto`, `RoomBrowserEntry`.
- Produces: `RoomCodeService.generate(): string` and `.isValid(code: string): boolean`.
- Produces: `RoomsService` with
  `create(hostId, { visibility, maxPlayers, gameId? }): Promise<RoomDto>`,
  `findByCode(code): Promise<Room | null>`,
  `join(roomId, userId): Promise<RoomDto>` — throws `RoomFullError`, `RoomBannedError`, `RoomClosedError`,
  `leave(roomId, userId): Promise<void>` — reassigns host to the earliest-joined remaining member; closes the room when empty,
  `setReady(roomId, userId, isReady)`, `selectGame(roomId, hostId, gameId)`, `transferHost(roomId, hostId, targetId)`,
  `kick(roomId, hostId, targetId)`, `ban(roomId, hostId, targetId)`,
  `browse({ gameId?, hasFreeSlots?, limit, offset }): Promise<RoomBrowserEntry[]>`,
  `toDto(roomId): Promise<RoomDto>`.
- Produces: `RoomsService.assertHost(roomId, userId)` throwing `ForbiddenException` — reused by the gateway.
- Produces: routes `POST /api/rooms`, `GET /api/rooms` (browser, public only), `GET /api/rooms/by-code/:code`, `POST /api/rooms/:id/join`, `POST /api/rooms/by-invite/:token/join`, `POST /api/rooms/:id/leave`, `POST /api/rooms/:id/report`.
- Produces: Redis-backed rate limit on `POST /api/rooms` — key `ratelimit:room-create:{userId}`, `ROOM_CREATE_RATE_LIMIT`, returns 429.

- [ ] **Step 1: Write the failing tests**

`room-code.service.spec.ts`:
```ts
it('generates a 6-character code from the safe alphabet', () => {
  for (let i = 0; i < 200; i++) {
    const code = service.generate()
    expect(code).toHaveLength(6)
    expect(code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/)
  }
})
it('rejects codes containing ambiguous characters', () => {
  expect(service.isValid('ABC1DE')).toBe(false)
  expect(service.isValid('ABCODE')).toBe(false)
  expect(service.isValid('ABCDEF')).toBe(true)
})
```

`rooms.service.spec.ts`:
```ts
it('refuses to join a room that already has maxPlayers members')
it('refuses to join when the user is banned from the room')
it('reassigns the host to the earliest remaining member when the host leaves')
it('closes the room when the last member leaves')
it('rejoining a room the user previously left reuses the same member row')
it('browse returns only public rooms and hides member identities')
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && pnpm test -- rooms`
Expected: FAIL.

- [ ] **Step 3: Implement**

Code generation retries on unique-constraint collision up to 10 times before throwing.

- [ ] **Step 4: Run tests**

Run: `cd backend && pnpm test`
Expected: PASS.

- [ ] **Step 5: Smoke-test the REST flow**

```bash
TOKEN=$(curl -s -X POST localhost:4000/api/auth/guest -H 'content-type: application/json' -d '{"nickname":"Host"}' | jq -r .accessToken)
curl -s -X POST localhost:4000/api/rooms -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' -d '{"visibility":"public","maxPlayers":10}'
curl -s localhost:4000/api/rooms
```
Expected: room created with a 6-char code; the browser lists it.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(backend): add room lifecycle, codes, browser and moderation"
```

---

# Phase 4 — Game core

### Task 10: Game contract, RNG and registry

**Files:**
- Create: `libs/game-core/package.json`, `tsconfig.json`, `vitest.config.ts`
- Create: `libs/game-core/src/contract.ts`, `src/rng.ts`, `src/registry.ts`, `src/index.ts`
- Create: `libs/game-core/test/rng.spec.ts`

**Interfaces:**
- Consumes: `@gp/shared` types only.
- Produces: exactly the contract from the spec:
```ts
export interface InitContext {
  players: PlayerId[]
  seed: number
  options: Record<string, unknown>
  deck?: string[]
  now: number
}
export interface ActionContext { actorId: PlayerId; now: number; seed: number }
export interface TimerOp { op: 'set' | 'clear'; id: string; delayMs?: number }
export interface Effect<S> { state: S; events: GameEvent[]; timers?: TimerOp[]; finished?: boolean }
export interface GameResultRow { playerId: PlayerId; score: number; placement: number }

export interface GameDefinition<S = unknown, A = GameAction> {
  id: GameId
  meta: GameMeta
  init(ctx: InitContext): S
  reduce(state: S, action: A, ctx: ActionContext): Effect<S>
  onTimer(state: S, timerId: string, ctx: ActionContext): Effect<S>
  view(state: S, viewerId: PlayerId): PlayerView
  results(state: S): GameResultRow[]
}

export class InvalidActionError extends Error {
  constructor(public readonly code: string, message: string)
}
```
- Produces: `createRng(seed: number): { next(): number; int(maxExclusive: number): number; shuffle<T>(items: T[]): T[] }` — mulberry32, pure, returns a new array from `shuffle`.
- Produces: `getGameDefinition(id: GameId): GameDefinition` and `GAME_DEFINITIONS: Record<GameId, GameDefinition>`. Registry starts empty apart from types; Tasks 12–13 register into it.
- Produces: `libs/game-core/package.json` with `main: dist/index.js`, scripts `build` (tsc), `test` (vitest run), `typecheck`.

- [ ] **Step 1: Write the failing RNG test**

```ts
import { createRng } from '../src/rng'

describe('createRng', () => {
  it('produces identical sequences for the same seed', () => {
    const a = createRng(12345)
    const b = createRng(12345)
    expect([a.next(), a.next(), a.next()]).toEqual([b.next(), b.next(), b.next()])
  })

  it('produces different sequences for different seeds', () => {
    expect(createRng(1).next()).not.toBe(createRng(2).next())
  })

  it('shuffle is deterministic and does not mutate the input', () => {
    const input = [1, 2, 3, 4, 5, 6, 7, 8]
    const shuffled = createRng(99).shuffle(input)
    expect(input).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
    expect(shuffled).toEqual(createRng(99).shuffle(input))
    expect([...shuffled].sort((x, y) => x - y)).toEqual(input)
  })

  it('int stays within range', () => {
    const rng = createRng(7)
    for (let i = 0; i < 500; i++) {
      const v = rng.int(10)
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(10)
    }
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `cd libs/game-core && pnpm test`
Expected: FAIL — cannot resolve `../src/rng`.

- [ ] **Step 3: Implement contract, rng and registry**

- [ ] **Step 4: Run tests**

Run: `cd libs/game-core && pnpm test`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(game-core): add game definition contract, seeded rng and registry"
```

---

### Task 11: Word engine and card engine

**Files:**
- Create: `libs/game-core/src/engines/word-engine.ts`, `src/engines/card-engine.ts`
- Create: `libs/game-core/test/word-engine.spec.ts`, `test/card-engine.spec.ts`

**Interfaces:**
- Produces (`word-engine`):
```ts
export interface WordRoundState {
  teams: TeamView[]
  activeTeamIndex: number
  explainerIndexByTeam: Record<string, number>
  round: number
  totalRounds: number
  deck: string[]
  deckCursor: number
  currentWord: string | null
  roundEndsAt: number | null
  pausedRemainingMs: number | null
  roundResults: { word: string; guessed: boolean }[]
}
export function buildTeams(players: PlayerId[], teamCount: number): TeamView[]
export function createWordRound(players: PlayerId[], deck: string[], opts: { totalRounds: number; teamCount: number; roundMs: number }): WordRoundState
export function currentExplainer(state: WordRoundState): PlayerId | null
export function drawWord(state: WordRoundState): WordRoundState        // advances deckCursor, reshuffles nothing
export function scoreWord(state: WordRoundState, guessed: boolean, points: { correct: number; skip: number }): WordRoundState
export function pauseRound(state: WordRoundState, now: number): WordRoundState
export function resumeRound(state: WordRoundState, now: number): WordRoundState
export function advanceTurn(state: WordRoundState): WordRoundState      // next team, next explainer within that team
export function isWordGameOver(state: WordRoundState): boolean
```
  All functions are pure and return new state objects.
- Produces (`card-engine`):
```ts
export function buildDeck36(): Card[]                                   // ranks 6..14 x 4 suits, stable order
export function dealHands(deck: Card[], players: PlayerId[], perPlayer: number): { hands: Record<PlayerId, Card[]>; rest: Card[] }
export function pickTrump(rest: Card[]): { trump: Card | null; rest: Card[] }   // trump is the bottom card, stays in the deck
export function beats(attack: Card, defend: Card, trumpSuit: Suit): boolean
export function nextPlayer(order: PlayerId[], current: PlayerId, skip?: PlayerId[]): PlayerId
export function refillHands(hands, deck, order, target: number): { hands; deck }
export function cardKey(card: Card): string                             // e.g. 'hearts:14'
```

- [ ] **Step 1: Write the failing word-engine tests**

```ts
it('splits players into balanced teams', () => {
  const teams = buildTeams(['a', 'b', 'c', 'd', 'e'], 2)
  expect(teams).toHaveLength(2)
  expect(teams[0]!.memberIds.length + teams[1]!.memberIds.length).toBe(5)
  expect(Math.abs(teams[0]!.memberIds.length - teams[1]!.memberIds.length)).toBeLessThanOrEqual(1)
})

it('rotates the explainer within a team across that team\'s turns', () => {
  let s = createWordRound(['a', 'b', 'c', 'd'], ['w1', 'w2'], { totalRounds: 2, teamCount: 2, roundMs: 60_000 })
  const first = currentExplainer(s)
  s = advanceTurn(s)          // other team
  s = advanceTurn(s)          // back to the first team
  expect(currentExplainer(s)).not.toBe(first)
})

it('scoreWord adds a point for a guess and subtracts for a skip', () => {
  let s = createWordRound(['a', 'b', 'c', 'd'], ['w1', 'w2', 'w3'], { totalRounds: 1, teamCount: 2, roundMs: 60_000 })
  s = drawWord(s)
  s = scoreWord(s, true, { correct: 1, skip: -1 })
  expect(s.teams[s.activeTeamIndex]!.score).toBe(1)
  s = drawWord(s)
  s = scoreWord(s, false, { correct: 1, skip: -1 })
  expect(s.teams[s.activeTeamIndex]!.score).toBe(0)
})

it('pause and resume preserve the remaining round time', () => {
  let s = createWordRound(['a', 'b', 'c', 'd'], ['w'], { totalRounds: 1, teamCount: 2, roundMs: 60_000 })
  s = { ...s, roundEndsAt: 1_000_000 }
  s = pauseRound(s, 970_000)
  expect(s.pausedRemainingMs).toBe(30_000)
  s = resumeRound(s, 2_000_000)
  expect(s.roundEndsAt).toBe(2_030_000)
  expect(s.pausedRemainingMs).toBeNull()
})

it('never serves the same word twice within a game', () => {
  let s = createWordRound(['a', 'b'], ['w1', 'w2', 'w3'], { totalRounds: 1, teamCount: 2, roundMs: 60_000 })
  const seen: string[] = []
  for (let i = 0; i < 3; i++) { s = drawWord(s); seen.push(s.currentWord!) }
  expect(new Set(seen).size).toBe(3)
})
```

- [ ] **Step 2: Write the failing card-engine tests**

```ts
it('builds a 36-card deck with no duplicates', () => {
  const deck = buildDeck36()
  expect(deck).toHaveLength(36)
  expect(new Set(deck.map(cardKey)).size).toBe(36)
})

it('beats: higher rank of the same suit wins', () => {
  expect(beats({ suit: 'hearts', rank: 7 }, { suit: 'hearts', rank: 10 }, 'spades')).toBe(true)
  expect(beats({ suit: 'hearts', rank: 10 }, { suit: 'hearts', rank: 7 }, 'spades')).toBe(false)
})

it('beats: any trump beats any non-trump', () => {
  expect(beats({ suit: 'hearts', rank: 14 }, { suit: 'spades', rank: 6 }, 'spades')).toBe(true)
})

it('beats: a lower trump does not beat a higher trump', () => {
  expect(beats({ suit: 'spades', rank: 12 }, { suit: 'spades', rank: 9 }, 'spades')).toBe(false)
})

it('beats: a different non-trump suit never beats', () => {
  expect(beats({ suit: 'hearts', rank: 6 }, { suit: 'clubs', rank: 14 }, 'spades')).toBe(false)
})

it('dealHands gives every player the requested count and shrinks the deck', () => {
  const { hands, rest } = dealHands(buildDeck36(), ['a', 'b', 'c'], 6)
  expect(hands.a).toHaveLength(6)
  expect(rest).toHaveLength(18)
})

it('pickTrump returns the bottom card and leaves it in the deck', () => {
  const rest = buildDeck36().slice(0, 5)
  const { trump, rest: after } = pickTrump(rest)
  expect(trump).toEqual(rest[rest.length - 1])
  expect(after).toHaveLength(5)
})

it('refillHands tops players up to the target in turn order and stops when the deck is empty', () => {
  const { hands, deck } = refillHands({ a: [], b: [] }, buildDeck36().slice(0, 3), ['a', 'b'], 6)
  expect(hands.a).toHaveLength(3)
  expect(hands.b).toHaveLength(0)
  expect(deck).toHaveLength(0)
})
```

- [ ] **Step 3: Run to verify failure**

Run: `cd libs/game-core && pnpm test`
Expected: FAIL on both new suites.

- [ ] **Step 4: Implement both engines**

- [ ] **Step 5: Run tests**

Run: `cd libs/game-core && pnpm test`
Expected: PASS, all suites.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(game-core): add word and card engine primitives"
```

---

### Task 12: Alias and Hat

**Files:**
- Create: `libs/game-core/src/games/alias.ts`
- Create: `libs/game-core/test/alias.spec.ts`
- Modify: `libs/game-core/src/registry.ts` (register `alias`, `hat`)

**Interfaces:**
- Consumes: `word-engine` (Task 11), `GameDefinition` (Task 10).
- Produces: `createAliasDefinition(mode: 'alias' | 'hat'): GameDefinition<AliasState, GameAction>`, plus `aliasDefinition` and `hatDefinition` exports registered in the registry.
- Produces: `AliasState = { round: WordRoundState; mode: 'alias' | 'hat'; started: boolean; finished: boolean }`.
- Behaviour: `options` accepts `{ totalRounds?: number (default 4); roundMs?: number (default 60_000); teamCount?: number (default 2) }`. Actions: `word/start_round` (explainer only, draws first word, sets timer `round`), `word/correct` and `word/skip` (explainer only, scores and draws the next word), `word/end_round` (explainer only, early end). `onTimer('round')` ends the round. Hat mode differs only in `pointsForSkip` (`0` instead of `-1`) and `titleKey` — everything else is shared.
- `view` returns `secretWord` only when `viewerId === explainerId`.

- [ ] **Step 1: Write the failing tests**

```ts
const CTX = (actorId: string, now = 1_000) => ({ actorId, now, seed: 42 })
const def = getGameDefinition('alias')

function start() {
  return def.init({ players: ['a', 'b', 'c', 'd'], seed: 42, options: {}, deck: ['w1','w2','w3','w4','w5'], now: 1000 })
}

it('only the explainer may start the round', () => {
  const s = start()
  const explainer = def.view(s, 'a').explainerId!
  const other = ['a','b','c','d'].find((p) => p !== explainer)!
  expect(() => def.reduce(s, { type: 'word/start_round' }, CTX(other))).toThrow(InvalidActionError)
})

it('hides the secret word from everyone except the explainer', () => {
  let s = start()
  const explainer = def.view(s, 'a').explainerId!
  s = def.reduce(s, { type: 'word/start_round' }, CTX(explainer)).state
  const other = ['a','b','c','d'].find((p) => p !== explainer)!
  expect((def.view(s, explainer) as WordGameView).secretWord).toBeTruthy()
  expect((def.view(s, other) as WordGameView).secretWord).toBeNull()
})

it('a correct guess scores a point and serves a new word', () => {
  let s = start()
  const explainer = def.view(s, 'a').explainerId!
  s = def.reduce(s, { type: 'word/start_round' }, CTX(explainer)).state
  const first = (def.view(s, explainer) as WordGameView).secretWord
  const eff = def.reduce(s, { type: 'word/correct' }, CTX(explainer))
  const view = def.view(eff.state, explainer) as WordGameView
  expect(view.teams.find((t) => t.id === view.activeTeamId)!.score).toBe(1)
  expect(view.secretWord).not.toBe(first)
  expect(eff.events).toContainEqual({ type: 'word_scored', playerId: explainer, guessed: true })
})

it('a skip costs a point in alias mode but not in hat mode', () => {
  const run = (gameId: 'alias' | 'hat') => {
    const d = getGameDefinition(gameId)
    let s = d.init({ players: ['a','b','c','d'], seed: 1, options: {}, deck: ['w1','w2','w3'], now: 0 })
    const ex = (d.view(s, 'a') as WordGameView).explainerId!
    s = d.reduce(s, { type: 'word/start_round' }, CTX(ex)).state
    s = d.reduce(s, { type: 'word/skip' }, CTX(ex)).state
    const v = d.view(s, ex) as WordGameView
    return v.teams.find((t) => t.id === v.activeTeamId)!.score
  }
  expect(run('alias')).toBe(-1)
  expect(run('hat')).toBe(0)
})

it('the round timer ends the round and passes the turn to the other team', () => {
  let s = start()
  const explainer = (def.view(s, 'a') as WordGameView).explainerId!
  s = def.reduce(s, { type: 'word/start_round' }, CTX(explainer)).state
  const before = (def.view(s, 'a') as WordGameView).activeTeamId
  const eff = def.onTimer(s, 'round', CTX(explainer, 61_000))
  expect((def.view(eff.state, 'a') as WordGameView).activeTeamId).not.toBe(before)
  expect(eff.events).toContainEqual(expect.objectContaining({ type: 'round_ended' }))
})

it('finishes after totalRounds and reports placements by score', () => {
  // play through with totalRounds: 1, assert finished === true and results() sorted by score desc with placement 1..n
})
```

- [ ] **Step 2: Run to verify failure**

Run: `cd libs/game-core && pnpm test -- alias`
Expected: FAIL.

- [ ] **Step 3: Implement**

- [ ] **Step 4: Run tests**

Run: `cd libs/game-core && pnpm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(game-core): implement alias and hat on the word engine"
```

---

### Task 13: Durak

**Files:**
- Create: `libs/game-core/src/games/durak.ts`
- Create: `libs/game-core/test/durak.spec.ts`
- Modify: `libs/game-core/src/registry.ts`

**Interfaces:**
- Consumes: `card-engine` (Task 11).
- Produces: `durakDefinition: GameDefinition<DurakState, GameAction>` registered as `durak`.
- Produces: `DurakState = { order: PlayerId[]; hands: Record<PlayerId, Card[]>; deck: Card[]; trump: Card | null; table: { attack: Card; defend: Card | null }[]; attackerId; defenderId; discard: Card[]; finished: PlayerId[]; phase }`.
- Rules implemented: 6 cards dealt each; trump is the bottom card; the player holding the lowest trump attacks first; the defender may `card/defend` with a card that `beats` the attack; attackers may add cards whose ranks already appear on the table; `card/take` gives the defender everything on the table and passes the attack on; `card/pass` (all attackers done) discards the table and rotates attacker/defender; hands refill to 6 in turn order starting from the attacker; a player with no cards and an empty deck is finished and gets the next placement; the last player holding cards is the `durak` and gets the worst placement.
- `view` exposes only the viewer's `hand`; everyone else appears in `opponents` as `{ playerId, cardCount, finished }`.

- [ ] **Step 1: Write the failing tests**

```ts
it('deals six cards to each player and sets a trump')
it('the player with the lowest trump attacks first')
it('rejects a defend card that does not beat the attack', () => {
  // expect(() => def.reduce(s, { type: 'card/defend', card: weak, against: attack }, CTX(defender))).toThrow(InvalidActionError)
})
it('rejects an action from a player whose turn it is not')
it('rejects adding a card whose rank is not already on the table')
it('take moves the whole table into the defender hand')
it('pass discards the table and makes the defender the next attacker')
it('a player who runs out of cards with an empty deck is marked finished with the next placement')
it('the last player holding cards is the durak and takes the worst placement')
it('view never leaks another player hand', () => {
  const v = def.view(s, 'a') as CardGameView
  expect(JSON.stringify(v)).not.toContain(cardKey(s.hands.b[0]!))
})
```

- [ ] **Step 2: Run to verify failure**

Run: `cd libs/game-core && pnpm test -- durak`
Expected: FAIL.

- [ ] **Step 3: Implement**

- [ ] **Step 4: Run tests**

Run: `cd libs/game-core && pnpm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(game-core): implement durak on the card engine"
```

---

### Task 13b: Crocodile and Nine — the reuse proof

**Files:**
- Create: `libs/game-core/src/games/crocodile.ts`, `src/games/nine.ts`
- Create: `libs/game-core/test/crocodile.spec.ts`, `test/nine.spec.ts`
- Modify: `libs/game-core/src/registry.ts`

**Interfaces:**
- Consumes: `word-engine`, `card-engine`, the `GameDefinition` contract.
- Produces: `crocodileDefinition` registered as `crocodile` — word-engine with `teamCount: 1` semantics replaced by per-player scoring: everyone except the explainer may guess, the explainer confirms with `word/correct`, and both the explainer and the guesser score. `deck` comes from the `crocodile` word-deck category.
- Produces: `nineDefinition` registered as `nine` — card-engine layout game: the player holding the nine of spades starts by playing it; a card may be played only if it extends an existing suit run adjacent to a placed card, or is a nine; `nine/pass` is legal only when the player has no legal move; the first player to empty their hand wins, remaining players are ranked by cards left.
- Both must reuse the engine primitives rather than reimplementing deck/turn/timer logic. **If either file duplicates engine logic, extend the engine instead.**

- [ ] **Step 1: Write the failing tests**

```ts
// crocodile.spec.ts
it('scores both the explainer and the guesser on a correct guess')
it('rejects word/correct from anyone but the explainer')
it('hides the word from every non-explainer')

// nine.spec.ts
it('requires the nine of spades as the opening move')
it('rejects a card that does not extend a run')
it('allows pass only when the player has no legal move', () => {
  expect(() => def.reduce(stateWithLegalMove, { type: 'nine/pass' }, CTX('a'))).toThrow(InvalidActionError)
})
it('ranks the player who empties their hand first as placement 1')
```

- [ ] **Step 2: Run to verify failure**

Run: `cd libs/game-core && pnpm test`
Expected: FAIL on both suites.

- [ ] **Step 3: Implement**

- [ ] **Step 4: Run the full suite**

Run: `pnpm test`
Expected: PASS across `game-core` and `backend`.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(game-core): add crocodile and nine, reusing existing engines"
```

---

# Phase 5 — Realtime and runtime

### Task 14: WebSocket gateway, presence and chat

**Files:**
- Create: `backend/src/realtime/realtime.module.ts`, `realtime.gateway.ts`, `presence.service.ts`, `redis.module.ts`, `redis.service.ts`, `socket-user.ts`
- Create: `backend/test/presence.service.spec.ts`

**Interfaces:**
- Consumes: `AuthService.verifyAccessToken`, `RoomsService`, `NotificationsService`, `SOCKET_NAMESPACE`, `ClientToServerEvents`, `ServerToClientEvents`, `RECONNECT_GRACE_MS`.
- Produces: `RedisService` exposing `client: Redis`, `subscriber: Redis`, and helpers `withLock(key, fn)`, `rateLimit(key, max, windowMs): Promise<boolean>`.
- Produces: `RealtimeGateway` on namespace `/rt`, using the Socket.IO Redis adapter. Handshake auth: `socket.handshake.auth.token` → `verifyAccessToken` → `socket.data.user: PublicUser`; invalid token disconnects immediately.
- Produces: `PresenceService` with
  `markOnline(roomId, userId, socketId)`,
  `markDisconnected(roomId, userId): void` — starts a `RECONNECT_GRACE_MS` timer that calls the supplied eviction callback,
  `cancelEviction(roomId, userId)`,
  `getConnection(roomId, userId): ConnectionState`,
  `setEvictionHandler(fn: (roomId, userId) => Promise<void>)`.
- Produces: `RealtimeGateway.broadcastRoomState(roomId)` and `.emitToUser(userId, event, payload)` — **Task 15 and Task 17 call these**.
- Handlers implemented here: `room:join`, `room:leave`, `room:ready`, `room:chat`, `room:select_game`, `room:vote_game`, `room:kick`, `room:ban`, `room:transfer_host`. Game and voice handlers land in Tasks 15 and 17.
- Chat messages are validated against `CHAT_MAX_LENGTH` and rate-limited to 10 messages / 10 s per user.

- [ ] **Step 1: Write the failing presence tests**

Use Jest fake timers:
```ts
it('keeps the member in the room during the grace period', () => {
  jest.useFakeTimers()
  const evict = jest.fn()
  service.setEvictionHandler(evict)
  service.markOnline('r1', 'u1', 's1')
  service.markDisconnected('r1', 'u1')
  jest.advanceTimersByTime(RECONNECT_GRACE_MS - 1000)
  expect(evict).not.toHaveBeenCalled()
  expect(service.getConnection('r1', 'u1')).toBe('disconnected')
})

it('evicts the member once the grace period expires', () => {
  jest.useFakeTimers()
  const evict = jest.fn()
  service.setEvictionHandler(evict)
  service.markOnline('r1', 'u1', 's1')
  service.markDisconnected('r1', 'u1')
  jest.advanceTimersByTime(RECONNECT_GRACE_MS + 1)
  expect(evict).toHaveBeenCalledWith('r1', 'u1')
})

it('a reconnect within the grace period cancels the eviction', () => {
  jest.useFakeTimers()
  const evict = jest.fn()
  service.setEvictionHandler(evict)
  service.markOnline('r1', 'u1', 's1')
  service.markDisconnected('r1', 'u1')
  jest.advanceTimersByTime(10_000)
  service.markOnline('r1', 'u1', 's2')
  jest.advanceTimersByTime(RECONNECT_GRACE_MS)
  expect(evict).not.toHaveBeenCalled()
  expect(service.getConnection('r1', 'u1')).toBe('online')
})
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && pnpm test -- presence`
Expected: FAIL.

- [ ] **Step 3: Implement Redis, presence and the gateway**

- [ ] **Step 4: Run tests**

Run: `cd backend && pnpm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(backend): add websocket gateway with presence, reconnect grace and chat"
```

---

### Task 15: Game runtime

**Files:**
- Create: `backend/src/games/games.module.ts`, `game-runtime.service.ts`, `game-timer.service.ts`, `word-deck.service.ts`, `game-history.service.ts`
- Modify: `backend/src/realtime/realtime.gateway.ts` (add `game:start`, `game:action`)
- Create: `backend/test/game-runtime.service.spec.ts`

**Interfaces:**
- Consumes: `getGameDefinition` (Task 10), `GameSession`, `GameResult`, `WordDeck`, `WordDeckEntry` models, `RoomsService`, `RealtimeGateway.broadcastRoomState`, `RedisService`.
- Produces: `WordDeckService.loadDeck(category: string, language: Locale): Promise<string[]>` — returns the word list, cached in Redis for 5 minutes.
- Produces: `GameTimerService` with `set(sessionId, timerId, delayMs, cb)`, `clear(sessionId, timerId)`, `clearAll(sessionId)`. Timers live in process memory keyed by session; `clearAll` runs when a session ends.
- Produces: `GameRuntimeService` with
  `start(roomId: RoomId, requesterId: UserId): Promise<void>` — asserts host, asserts member count within `meta.minPlayers..maxPlayers`, builds `InitContext` (seed from `crypto.randomInt`, deck from `WordDeckService` for word games), persists a `GameSession` row, sets room status to `in_game`, emits `game:started` then per-player `game:state`,
  `dispatch(roomId, actorId, action: GameAction): Promise<void>` — loads state from Redis, calls `reduce`, applies `timers`, persists the new snapshot, emits `game:event` to the room and `game:state` per player, finishes the session when `finished`,
  `handleTimer(sessionId, timerId): Promise<void>`,
  `finish(sessionId): Promise<void>` — writes `GameResult` rows, sets room status to `results`, emits `game:ended`, clears timers and Redis state, then after 8 seconds returns the room to `lobby` and broadcasts room state,
  `pauseForDisconnect(roomId, userId)` / `resumeAfterReconnect(roomId, userId)` — called by presence.
- Produces: `GameHistoryService.listForUser(userId, limit): Promise<MatchHistoryEntry[]>` and the route `GET /api/users/:id/history` that returns it (added to `UsersController` from Task 8).
- Redis keys: `game:state:{sessionId}` (JSON snapshot), `room:session:{roomId}` (active session id).
- `InvalidActionError` from a reducer is converted to an `error` event to the acting socket only — it must never crash the gateway or mutate state.

- [ ] **Step 1: Write the failing runtime tests**

With mocked models and a stub gateway:
```ts
it('refuses to start when the requester is not the host')
it('refuses to start with fewer players than the game minimum')
it('emits a personalised game:state to every player on start', async () => {
  await runtime.start('room1', 'host')
  const words = gateway.emitted.filter((e) => e.event === 'game:state').map((e) => (e.payload as WordGameView).secretWord)
  expect(words.filter(Boolean)).toHaveLength(1)   // only the explainer sees the word
})
it('an invalid action emits error to the actor and leaves state unchanged', async () => {
  const before = await runtime.snapshot('session1')
  await runtime.dispatch('room1', 'not-the-explainer', { type: 'word/correct' })
  expect(gateway.emitted.at(-1)).toMatchObject({ event: 'error' })
  expect(await runtime.snapshot('session1')).toEqual(before)
})
it('writes GameResult rows and sets the room to results when the game finishes')
it('clears all session timers when the game finishes')
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && pnpm test -- game-runtime`
Expected: FAIL.

- [ ] **Step 3: Implement**

- [ ] **Step 4: Run tests**

Run: `cd backend && pnpm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(backend): add authoritative game runtime with timers and persistence"
```

---

### Task 16: End-to-end socket test

**Files:**
- Create: `backend/jest.e2e.config.js`, `backend/test/e2e/room-game.e2e-spec.ts`, `backend/test/e2e/helpers.ts`

**Interfaces:**
- Consumes: the whole backend. Runs against the real Postgres and Redis from docker-compose, using a separate database `gameplatform_test` created by the helper.

- [ ] **Step 1: Write the e2e spec**

Alias requires 4 players per `GAME_CATALOG`, so the scenario uses **four** real `socket.io-client` connections:
```ts
it('runs a full room lifecycle: create -> join -> start alias -> score -> finish', async () => {
  const [host, ...others] = await Promise.all(
    ['Host', 'P2', 'P3', 'P4'].map((n) => guest(n)),
  )
  const room = await createRoom(host)
  for (const p of others) await joinRoom(p, room.id)

  const sockets = await Promise.all([host, ...others].map((p) => connect(p.accessToken)))
  const [hostSocket] = sockets
  for (const s of sockets) await emit(s, 'room:join', { roomId: room.id })

  await emit(hostSocket, 'room:select_game', { roomId: room.id, gameId: 'alias' })
  const started = waitFor(hostSocket, 'game:started')
  await emit(hostSocket, 'game:start', { roomId: room.id })
  expect((await started).gameId).toBe('alias')

  const views = await Promise.all(sockets.map((s) => waitFor(s, 'game:state')))
  // exactly one player is the explainer and only they can see the word
  expect(views.filter((v) => v.secretWord !== null)).toHaveLength(0) // no word before the round starts
  const players = [host, ...others]
  const explainerIndex = players.findIndex((p) => p.user.id === views[0]!.explainerId)
  const explainerSocket = sockets[explainerIndex]!
  await emit(explainerSocket, 'game:action', { roomId: room.id, action: { type: 'word/start_round' } })
  await emit(explainerSocket, 'game:action', { roomId: room.id, action: { type: 'word/correct' } })

  const scored = await waitFor(explainerSocket, 'game:state')
  expect(scored.teams.reduce((n, t) => n + t.score, 0)).toBe(1)
})

it('rejects a game action from a player whose turn it is not, without breaking the session')
it('a reconnecting client receives the current room and game state')
```

- [ ] **Step 2: Run to verify it fails, then passes**

Run: `docker compose up -d postgres redis && cd backend && pnpm test:e2e`
Expected: initially FAIL; after fixing wiring, PASS.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "test(backend): add end-to-end socket scenario for a full alias game"
```

---

### Task 17: Voice tokens and the drawing channel

**Files:**
- Create: `backend/src/voice/voice.module.ts`, `voice.service.ts`
- Create: `backend/src/realtime/drawing.service.ts`
- Modify: `backend/src/realtime/realtime.gateway.ts` (add `voice:token`, `draw:stroke`, `draw:clear`)
- Create: `backend/test/voice.service.spec.ts`

**Interfaces:**
- Consumes: `AppConfigService`, `livekit-server-sdk`, `DRAW_STROKE_LOG_LIMIT`, `RedisService`.
- Produces: `VoiceService.issueToken(roomId: RoomId, user: PublicUser): Promise<VoiceCredentials>` — when `config.voiceEnabled` is false returns `{ enabled: false, url: null, token: null, roomName: null }`; otherwise returns a LiveKit JWT with `identity = user.id`, `name = user.nickname`, grants `{ roomJoin: true, room: 'room-' + roomId, canPublish: true, canSubscribe: true }`, TTL 6 h.
- Produces: `VoiceService.roomName(roomId): string` = `` `room-${roomId}` ``.
- Produces: `DrawingService.append(roomId, stroke)`, `.clear(roomId)`, `.getAll(roomId): Promise<DrawStroke[]>` — Redis list `draw:{roomId}`, trimmed to `DRAW_STROKE_LOG_LIMIT`, TTL 2 h.
- Gateway behaviour: `draw:stroke` is accepted **only** from the current Crocodile explainer, appended, and broadcast to the rest of the room; on `room:join` during an active Crocodile session the joiner receives `draw:sync`; `draw:clear` (explainer or host) empties the log and broadcasts `draw:sync` with `[]`.

- [ ] **Step 1: Write the failing tests**

```ts
it('reports voice disabled when LIVEKIT_URL is absent', async () => {
  const svc = new VoiceService({ voiceEnabled: false } as AppConfigService)
  expect(await svc.issueToken('r1', user)).toEqual({ enabled: false, url: null, token: null, roomName: null })
})

it('issues a token scoped to the requested room only', async () => {
  const creds = await svc.issueToken('r1', user)
  const decoded = JSON.parse(Buffer.from(creds.token!.split('.')[1]!, 'base64').toString())
  expect(decoded.video.room).toBe('room-r1')
  expect(decoded.video.roomJoin).toBe(true)
  expect(decoded.sub).toBe(user.id)
})
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && pnpm test -- voice`
Expected: FAIL.

- [ ] **Step 3: Implement**

- [ ] **Step 4: Run tests and verify against the real LiveKit server**

Run: `cd backend && pnpm test`
Expected: PASS.
Then, with `docker compose up -d livekit` and the backend running, request a token over the socket and confirm `curl -s -o /dev/null -w '%{http_code}' http://localhost:7880` returns `200`.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(backend): issue livekit tokens and relay crocodile drawing strokes"
```

---

# Phase 6 — Frontend

### Task 18: Next.js skeleton, i18n and API client

**Files:**
- Create: `frontend/package.json`, `tsconfig.json`, `next.config.ts`, `postcss.config.mjs`, `src/app/globals.css`
- Create: `frontend/src/app/layout.tsx`, `src/app/page.tsx`
- Create: `frontend/src/lib/api.ts`, `src/lib/i18n/{index.tsx,uk.json,en.json}`, `src/lib/stores/auth-store.ts`
- Create: `frontend/src/components/ui/{button,input,card,modal,avatar}.tsx`

**Interfaces:**
- Consumes: `@gp/shared`.
- Produces: `next.config.ts` with `transpilePackages: ['@gp/shared']`.
- Produces: `api` object — `api.post<T>(path, body)`, `api.get<T>(path)`, `api.patch<T>(path, body)` — reading `NEXT_PUBLIC_API_URL`, sending `credentials: 'include'`, attaching `Authorization: Bearer` from the auth store, and throwing `ApiError { status, code, message }`.
- Produces: `useI18n(): { t(key: string, vars?): string; locale: Locale; setLocale(l: Locale): void }`, backed by flat JSON dictionaries. **Every task that adds UI text adds keys to both `uk.json` and `en.json`.**
- Produces: `useAuthStore` (Zustand, persisted to `localStorage`) with `user: PublicUser | null`, `accessToken: string | null`, `loginAsGuest(nickname)`, `login(email, password)`, `register(...)`, `logout()`, `hydrate()`.
- Produces: the five UI primitives above, Tailwind-styled, dark theme.

- [ ] **Step 1: Scaffold and configure**

Scripts: `dev` (`next dev -p 3000`), `build`, `start`, `typecheck`, `test` (`echo "no frontend tests" && exit 0`).

- [ ] **Step 2: Write the dictionaries and primitives**

- [ ] **Step 3: Build the landing page**

`/` shows the product pitch, a nickname field with a "Грати як гість" button, and — once authenticated — "Створити кімнату" plus a 6-character code input that navigates to `/room/[code]`.

- [ ] **Step 4: Verify**

Run: `cd frontend && pnpm build`
Expected: build succeeds with no type errors.
Then with the backend running: `pnpm dev`, open `http://localhost:3000`, enter a nickname, click "Грати як гість".
Expected: the auth store holds a user and the create-room button appears.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(frontend): scaffold next.js app with i18n, api client and guest login"
```

---

### Task 19: Auth pages and room browser

**Files:**
- Create: `frontend/src/app/login/page.tsx`, `src/app/register/page.tsx`, `src/app/rooms/page.tsx`, `src/app/profile/page.tsx`
- Create: `frontend/src/components/rooms/{room-browser.tsx,create-room-dialog.tsx}`
- Create: `frontend/src/components/profile/{friends-list.tsx,match-history.tsx}`
- Modify: `frontend/src/lib/i18n/{uk,en}.json`

**Interfaces:**
- Consumes: `api`, `useAuthStore`, `RoomBrowserEntry`, `MatchHistoryEntry`, `GAME_CATALOG`.
- Produces: `/rooms` — public room list with filters by game (`GAME_CATALOG`) and a "лише з вільними місцями" toggle, polling `GET /api/rooms` every 5 s, each row linking to `/room/[code]`.
- Produces: `/login` and `/register` — email forms, plus a "Увійти через Google" button rendered only when `GET /api/health` reports `oauth: true`.
- Produces: `/profile` — nickname/avatar editing, friends list with accept/decline for incoming requests, nickname search to send requests, and match history.
- Produces: `create-room-dialog` — visibility, max players (2–10), optional preselected game; on success routes to `/room/[code]` and copies the invite link.

- [ ] **Step 1: Implement the pages**

- [ ] **Step 2: Verify**

Run: `cd frontend && pnpm build`
Expected: success.
Then manually: create a public room in one browser profile, confirm it appears in `/rooms` within 5 s in another.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat(frontend): add auth pages, room browser and profile with friends"
```

---

### Task 20: Room page — socket, lobby and voice

**Files:**
- Create: `frontend/src/app/room/[code]/page.tsx`
- Create: `frontend/src/lib/socket.ts`, `src/lib/stores/room-store.ts`
- Create: `frontend/src/lib/use-voice.ts`
- Create: `frontend/src/components/room/{lobby.tsx,member-list.tsx,chat-panel.tsx,game-picker.tsx,voice-panel.tsx,results-screen.tsx}`

**Interfaces:**
- Consumes: `ClientToServerEvents`, `ServerToClientEvents`, `SOCKET_NAMESPACE`, `VoiceCredentials`, `livekit-client`.
- Produces: `createSocket(token: string): Socket<ServerToClientEvents, ClientToServerEvents>` connecting to `NEXT_PUBLIC_WS_URL + SOCKET_NAMESPACE` with `auth: { token }` and `reconnection: true`.
- Produces: `useRoomStore` with `room: RoomDto | null`, `messages: ChatMessageDto[]`, `view: PlayerView | null`, `standings`, `votes`, and actions `join`, `leave`, `setReady`, `sendChat`, `selectGame`, `voteGame`, `startGame`, `sendAction`, `kick`, `ban`, `transferHost`.
- Produces: `useVoice(roomId)` returning `{ enabled, connected, muted, speakers: Set<UserId>, toggleMute() }` — requests `voice:token`, calls `Room.connect(url, token)`, `enableMicrophone()`, subscribes to `RoomEvent.ActiveSpeakersChanged` and `RoomEvent.TrackSubscribed` (attaching remote audio elements). **Disconnects only on unmount of `/room/[code]`, never on `room.status` change.**
- Produces: `/room/[code]` as a single client component that resolves the code to a room, joins it, and switches its main area on `room.status` — `lobby` → `<Lobby/>`, `in_game` → the game screen from Task 21/22, `results` → `<ResultsScreen/>`. `<VoicePanel/>` and `<ChatPanel/>` render outside that switch so they never unmount.

- [ ] **Step 1: Implement the socket layer and store**

- [ ] **Step 2: Implement the lobby, chat, game picker and voice panel**

The game picker lists `GAME_CATALOG` entries, disabling those whose `minPlayers`/`maxPlayers` do not fit the current member count, and offers both host-select and vote modes. Voice panel shows each member with a mic icon, highlighting active speakers.

- [ ] **Step 3: Verify manually**

Open `/room/CODE` in two browser profiles with `docker compose up -d` running.
Expected: both members appear in the list; chat delivers both ways; both browsers show the microphone permission prompt and each shows the other as an active speaker while talking.

- [ ] **Step 4: Verify the voice connection survives a game transition**

Start a game and let it finish.
Expected: the LiveKit connection indicator stays connected throughout `lobby → in_game → results → lobby` — this is the core product promise from the spec.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(frontend): add room page with socket store, lobby, chat and livekit voice"
```

---

### Task 21: Word game screens

**Files:**
- Create: `frontend/src/components/games/word/{word-game-screen.tsx,round-timer.tsx,team-scoreboard.tsx,explainer-controls.tsx,guesser-view.tsx}`
- Create: `frontend/src/components/games/crocodile/{drawing-canvas.tsx,crocodile-screen.tsx}`
- Modify: `frontend/src/lib/i18n/{uk,en}.json`

**Interfaces:**
- Consumes: `WordGameView`, `GameAction`, `DrawStroke`, `useRoomStore`.
- Produces: `<WordGameScreen view={WordGameView} />` — renders `<TeamScoreboard/>`, `<RoundTimer deadline={view.roundEndsAt} paused={view.roundPaused} />`, and either `<ExplainerControls/>` (big word, "Вгадали" / "Пропустити" / "Завершити раунд" buttons dispatching `word/correct`, `word/skip`, `word/end_round`) or `<GuesserView/>` (word hidden, live team score, list of already-scored words).
- Produces: `<DrawingCanvas mode="draw" | "watch" />` — HTML canvas, pointer events collected into a `DrawStroke` and emitted via `draw:stroke` (throttled to one emit per 50 ms), incoming `draw:stroke` and `draw:sync` replayed onto the canvas, plus a clear button for the explainer.
- Produces: `<CrocodileScreen/>` composing `<WordGameScreen/>` with the canvas in place of `<GuesserView/>`'s empty area.
- The round timer is derived from `roundEndsAt` (a server timestamp) and re-rendered locally each second — the client never decides when a round ends.

- [ ] **Step 1: Implement the shared word screen**

- [ ] **Step 2: Implement the drawing canvas**

- [ ] **Step 3: Verify**

Run: `cd frontend && pnpm build`
Expected: success.
Then play a full Alias round with four browser profiles.
Expected: only the explainer sees the word; scores update for everyone; the round ends on its own at zero.
Then play Crocodile with three profiles.
Expected: strokes appear on the other clients within a fraction of a second, and a late joiner sees the existing drawing.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(frontend): add alias, hat and crocodile game screens"
```

---

### Task 22: Card game screen and results

**Files:**
- Create: `frontend/src/components/games/card/{card-game-screen.tsx,playing-card.tsx,hand.tsx,table.tsx,opponent-row.tsx}`
- Modify: `frontend/src/components/room/results-screen.tsx`

**Interfaces:**
- Consumes: `CardGameView`, `GameAction`.
- Produces: `<PlayingCard card={Card} faceDown?: boolean onClick?: () => void />` rendering rank/suit with correct colours and a face-down back.
- Produces: `<CardGameScreen view={CardGameView} />` — opponents as rows with face-down card counts, the table as attack/defend pairs, the trump card and deck count, and the viewer's hand. Clicking a hand card dispatches `card/attack` when the viewer is the attacker, or `card/defend` against the selected uncovered attack when the viewer is the defender. "Взяти" and "Бито" buttons dispatch `card/take` and `card/pass`, disabled when the action is not legal for the viewer.
- Produces: `<ResultsScreen standings />` — final placements with nicknames and scores, a countdown to the automatic return to the lobby, and a "Обрати наступну гру" button.

- [ ] **Step 1: Implement**

- [ ] **Step 2: Verify**

Run: `cd frontend && pnpm build`
Then play a full Durak game with two browser profiles through to a winner.
Expected: illegal moves are refused with a toast and the game continues; the results screen lists placements and the room returns to the lobby on its own.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat(frontend): add card game screen and results screen"
```

---

# Phase 7 — Infrastructure configs

### Task 24: Terraform — state, network and data

**Files:**
- Create: `infra/{main.tf,providers.tf,variables.tf,outputs.tf,backend.tf,terraform.tfvars.example,README.md}`
- Create: `infra/modules/s3-backend/{main.tf,variables.tf,outputs.tf}`
- Create: `infra/modules/vpc/{main.tf,variables.tf,outputs.tf}`
- Create: `infra/modules/ecr/{main.tf,variables.tf,outputs.tf}`
- Create: `infra/modules/rds/{main.tf,variables.tf,outputs.tf}`
- Create: `infra/modules/redis/{main.tf,variables.tf,outputs.tf}`

**Interfaces:**
- Produces: root variables `project` (default `gameplatform`), `environment`, `aws_region` (default `eu-central-1`), `vpc_cidr`, `cluster_version`, `db_instance_class`, `redis_node_type`, `github_repository`.
- Produces: `modules/s3-backend` — versioned, encrypted, public-access-blocked S3 bucket plus a DynamoDB lock table. Applied once, separately; `backend.tf` documents this in a comment.
- Produces: `modules/vpc` — VPC, 3 public + 3 private subnets across AZs, IGW, single NAT gateway, EKS-required subnet tags (`kubernetes.io/role/elb`, `kubernetes.io/role/internal-elb`).
- Produces: `modules/ecr` — one repository per service from `var.services` (`["backend-api", "frontend"]`), image scanning on push, a lifecycle policy keeping the last 20 images. Outputs `repository_urls` (map).
- Produces: `modules/rds` — PostgreSQL 17 in private subnets, `manage_master_user_password = true` (Secrets Manager, per spec §8.6), security group allowing 5432 from the EKS node security group only, `skip_final_snapshot` driven by `var.environment`. Outputs `endpoint`, `master_user_secret_arn`.
- Produces: `modules/redis` — ElastiCache Redis replication group in private subnets, transit encryption on. Outputs `primary_endpoint`.
- **Every module must include `variables.tf` with descriptions and `outputs.tf`. No hardcoded account IDs, ARNs or CIDRs outside variables.**

- [ ] **Step 1: Write the root configuration and modules**

`providers.tf` pins `required_version = ">= 1.9"` and `aws` provider `~> 5.70`, with `default_tags` applying `Project`, `Environment`, `ManagedBy = "terraform"`.

- [ ] **Step 2: Validate**

Run: `cd infra && terraform fmt -check -recursive && terraform init -backend=false && terraform validate`
Expected: `Success! The configuration is valid.`
If `terraform` is not installed, install it or run `docker run --rm -v "$PWD:/w" -w /w hashicorp/terraform:1.9 validate`.

**Do not run `terraform plan` or `terraform apply`.**

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat(infra): add terraform state, vpc, ecr, rds and redis modules"
```

---

### Task 25: Terraform — cluster, CI/CD identity, GitOps and monitoring

**Files:**
- Create: `infra/modules/eks/{main.tf,variables.tf,outputs.tf}`
- Create: `infra/modules/ci-cd/{main.tf,variables.tf,outputs.tf}`
- Create: `infra/modules/argo_cd/{main.tf,variables.tf,outputs.tf}`
- Create: `infra/modules/monitoring/{main.tf,variables.tf,outputs.tf}`
- Modify: `infra/main.tf`, `infra/outputs.tf`

**Interfaces:**
- Consumes: `modules/vpc` outputs, `modules/ecr` outputs.
- Produces: `modules/eks` — cluster + managed node group + addons `vpc-cni`, `coredns`, `kube-proxy`, `aws-ebs-csi-driver`, plus `metrics-server` via the `helm` provider (spec §2.5 requires it for HPA). IRSA enabled via an OIDC provider. Outputs `cluster_name`, `cluster_endpoint`, `oidc_provider_arn`, `node_security_group_id`.
- Produces: `modules/ci-cd` — a GitHub OIDC identity provider (`token.actions.githubusercontent.com`) and an IAM role assumable only by `repo:${var.github_repository}:*`, with a policy permitting ECR push and `eks:DescribeCluster` and nothing else. **No IAM users, no long-lived access keys** (spec §8.6). Outputs `role_arn`.
- Produces: `modules/argo_cd` — `helm_release` of `argo-cd` into namespace `argocd`, plus a root `Application` (app-of-apps) pointing at `charts/` in `var.gitops_repo_url` on `var.gitops_branch`, with `syncPolicy.automated: { prune: true, selfHeal: true }` (spec §8.4).
- Produces: `modules/monitoring` — `helm_release` of `kube-prometheus-stack` into namespace `monitoring` with persistence sized by variables.
- Produces: root outputs `cluster_name`, `ecr_repository_urls`, `github_actions_role_arn`, `argocd_namespace`.

- [ ] **Step 1: Write the modules and wire them into `main.tf`**

- [ ] **Step 2: Validate**

Run: `cd infra && terraform fmt -check -recursive && terraform init -backend=false && terraform validate`
Expected: valid.

- [ ] **Step 3: Document the cost warning**

`infra/README.md` must carry the spec §8.7 warning: EKS control plane, node group, one ELB per LoadBalancer service, and monitoring PVCs cost money even when idle; run `terraform destroy` (excluding `s3-backend`) outside working hours during development.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(infra): add eks, github oidc, argo cd and monitoring modules"
```

---

### Task 26: Helm charts

**Files:**
- Create: `charts/backend-api/{Chart.yaml,values.yaml,.helmignore}` and `templates/{deployment,service,ingress,hpa,configmap,secret,serviceaccount,_helpers.tpl}.yaml`
- Create: `charts/frontend/` (same shape, no HPA)
- Create: `charts/livekit/{Chart.yaml,values.yaml}` and `templates/{deployment,service,configmap,_helpers.tpl}.yaml`

**Interfaces:**
- Produces: `charts/backend-api` — `image.repository` / `image.tag` (tag is what CI bumps, per spec §8.4), replica count, resources, `readinessProbe` and `livenessProbe` on `/api/health`, env from a ConfigMap plus secret refs for `DATABASE_URL`, `REDIS_URL`, JWT secrets and LiveKit credentials, `HorizontalPodAutoscaler` on CPU and memory (spec §2.5), and a `ServiceAccount` annotated for IRSA.
- Produces: `charts/livekit` — Deployment with the LiveKit config as a ConfigMap (`turn.enabled: true`, per spec §2.3), and a `Service` of type `LoadBalancer` exposing TCP 7880/7881 and the UDP port range 50000–50100. **No `hostNetwork: true` and no manual NodePort mapping** (spec §8.2).
- Produces: every chart's `values.yaml` documents each key with a comment.

- [ ] **Step 1: Write the charts**

- [ ] **Step 2: Validate**

Run: `helm lint charts/backend-api charts/frontend charts/livekit`
Expected: `0 chart(s) failed`.
Then: `helm template charts/backend-api | head -50`
Expected: valid YAML with the image reference resolved.

**Do not run `helm install`.**

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat(charts): add backend-api, frontend and livekit helm charts"
```

---

### Task 27: GitHub Actions workflows

**Files:**
- Create: `.github/workflows/ci.yml`, `backend-deploy.yml`, `frontend-deploy.yml`
- Create: `backend/Dockerfile`, `frontend/Dockerfile`, `.dockerignore`

**Interfaces:**
- Produces: `ci.yml` — on pull request and push to `main`: pnpm install with cache, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`; a `terraform` job running `fmt -check` and `validate`; a `helm lint` job.
- Produces: `backend-deploy.yml` — triggered on push to `main` under `backend/**`, `libs/**`, `charts/backend-api/**`. Permissions `id-token: write`, `contents: write`. Steps: `aws-actions/configure-aws-credentials` with `role-to-assume` (OIDC, no stored AWS keys — spec §8.6) → `aws-actions/amazon-ecr-login` → `docker/build-push-action` with buildx and GHA cache, tagging with the commit SHA → `yq` bumps `charts/backend-api/values.yaml` `image.tag` → commit and push back to `main` so Argo CD picks it up (spec §8.4).
- Produces: `frontend-deploy.yml` — the same shape for `frontend/**`.
- Produces: multi-stage Dockerfiles. Backend: pnpm build of `libs/*` + `backend`, then a slim runtime stage running `node dist/main.js` as a non-root user, `EXPOSE 4000`. Frontend: Next.js standalone output, `EXPOSE 3000`.
- The deploy workflows' git push step must use `[skip ci]` in the commit message to avoid a loop.

- [ ] **Step 1: Write the Dockerfiles**

- [ ] **Step 2: Verify the backend image builds**

Run: `docker build -f backend/Dockerfile -t gameplatform-backend:test .`
Expected: build succeeds.
Then: `docker run --rm gameplatform-backend:test node -e "console.log('ok')"`
Expected: `ok`.

- [ ] **Step 3: Write the workflows**

- [ ] **Step 4: Validate the workflow syntax**

Run: `for f in .github/workflows/*.yml; do python3 -c "import sys,yaml;yaml.safe_load(open(sys.argv[1]))" "$f" && echo "$f ok"; done`
Expected: every file reports `ok`.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "ci: add build/test workflow and oidc-based ecr deploy pipelines"
```

---

### Task 28: README and final verification

**Files:**
- Create: `README.md`
- Modify: anything the final verification pass turns up

**Interfaces:**
- Produces: a README covering what the product is, the monorepo layout, prerequisites, a copy-pasteable quick start (`pnpm install`, `docker compose up -d`, `pnpm --filter backend db:migrate`, `pnpm --filter backend db:seed`, `pnpm dev`), the env-var table, how to play each of the five games, the test commands, and an explicit statement that the infra directory is **configuration only — nothing is deployed**.

- [ ] **Step 1: Write the README**

- [ ] **Step 2: Run the full verification suite**

```bash
pnpm install
pnpm lint
pnpm typecheck
pnpm test
pnpm build
cd infra && terraform fmt -check -recursive && terraform init -backend=false && terraform validate && cd ..
helm lint charts/backend-api charts/frontend charts/livekit
```
Expected: every command exits 0. Record the actual output — do not claim success without it.

- [ ] **Step 3: Run the end-to-end manual smoke test**

With `docker compose up -d` and `pnpm dev`:
1. Open four browser profiles, join one room via its code.
2. Confirm voice connects in all four and speaker indicators light up.
3. Play a full Alias game to the results screen and confirm the automatic return to the lobby with voice still connected.
4. Play a Durak game to completion.
5. Kill the backend, wait 10 s, restart it, and confirm the clients reconnect and recover room state.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "docs: add readme with quick start and verification steps"
```

---

## Self-Review

**Spec coverage** — every spec section maps to at least one task:

| Spec section | Tasks |
|---|---|
| §2 repo structure, Nx, Biome, dependency direction | 1 |
| §3.1 game contract | 10 |
| §3.2 engines | 11 |
| §3.3 five games, drawing off-state | 12, 13, 13b, 17, 21 |
| §4 realtime, runtime, room lifecycle, reconnect | 14, 15, 16 |
| §5 voice | 17, 20 |
| §6 data model incl. WordDeckEntry, RoomBan | 5, 6 |
| §7 auth incl. guest upgrade, flagged OAuth | 7 |
| §8 frontend routes and non-remounting voice | 18, 19, 20, 21, 22 |
| §9 tests | 10–13, 13b, 14, 15, 16 |
| §10 infra configs | 24, 25, 26, 27 |
| §11 risk mitigations | 10 (`view`), 15 (`InvalidActionError`), 17 (voice flag), 13b (reuse proof) |
| friends, notifications, scoreboard, moderation | 8, 9, 15, 19 |

**Type consistency** — `PlayerView`, `GameAction`, `GameEvent`, `Effect`, `GameDefinition`, `VoiceCredentials`, `RoomDto`, `RoomBrowserEntry`, `MatchHistoryEntry` are defined once (Tasks 3 and 10) and referenced by those exact names everywhere after.

**Execution order:** tasks run in document order — 1 … 13, 13b, 14 … 28. Task 13b sits in Phase 4 because Task 21 renders Crocodile's UI and needs its reducer to already exist.
