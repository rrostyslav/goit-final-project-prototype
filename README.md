# Game Platform Prototype

A persistent room for a group of friends: someone creates a room, shares a
code or invite link, everyone joins the same voice chat, the room picks a
game together, plays it, and stays in the same voice chat afterwards to pick
the next one. Up to 10 people per room.

This is a **prototype**. It implements the Must-have and Should-have scope of
the underlying spec (`docs/superpowers/specs/2026-08-17-game-platform-design.md`)
and is honest below about what is cut, simulated, or a known weak point.
Out of scope entirely: social-deduction games (Mafia/Spy) and any third game
per category beyond the five described here.

| Area | What's implemented |
|---|---|
| Rooms | private (code + invite link), public browser with filters, lobby, `lobby → in_game → results → lobby` lifecycle |
| Voice | LiveKit (self-hosted), real WebRTC connection, mute/unmute, active-speaker indicator, survives the whole room lifecycle |
| Word games | Alias, Hat (Alias in a different scoring mode), Crocodile (word engine + a drawing channel) |
| Card games | Durak, Nine |
| Auth | guest mode, email register/login, guest→account upgrade (same user id), Google OAuth behind an env flag |
| Social | friends, friend requests, in-app notifications (pushed and stored server-side; no frontend component reads them yet), match history |
| Moderation | kick, ban, rate limiting on room creation, player reports (`POST /api/rooms/:id/report` + a `RoomReport` table; no frontend surface — no report button anywhere in the UI yet) |
| Infra | Terraform modules, Helm charts, GitHub Actions — **configuration only, nothing is deployed** (see [Infra](#infra--configuration-only-nothing-is-deployed)) |

## Repository layout

An Nx package-based pnpm monorepo. `apps/*` is the usual Nx convention; this
repo instead follows the top-level layout the originating spec calls for
(`backend/ frontend/ infra/ charts/`) and adds two shared libraries.

```
backend/              NestJS 11 — platform modules + game runtime + WS gateway
frontend/              Next.js 15 (App Router)
libs/shared/           @gp/shared — WS event contract, DTOs, view-state types
libs/game-core/        @gp/game-core — game engines and game definitions, pure TS
infra/                 Terraform (AWS EKS target)
charts/                Helm charts: backend-api, frontend, livekit
.github/workflows/     ci.yml, backend-deploy.yml, frontend-deploy.yml
docker-compose.yml     postgres, redis, livekit (local dev only)
```

Enforced dependency direction: `frontend → shared`, `backend → shared,
game-core`, `game-core → shared`, `shared → nothing`. `game-core` never
imports from `backend` or `frontend` — the game rules are plain, testable
TypeScript with no framework underneath them.

**Tooling:** pnpm workspaces, Nx for the task graph and caching, Biome for
lint + format (not ESLint/Prettier), TypeScript strict everywhere.

## Prerequisites

- Node 24
- pnpm 11.2.2 (`packageManager` is pinned in `package.json`)
- Docker + Docker Compose (for Postgres, Redis, and a local LiveKit server)

## Quick start

```bash
git clone <this-repo>
cd goit-final-project-prototype

# 1. Install dependencies. This does not build anything yet — the first
#    `pnpm dev`/`pnpm build`/`pnpm test` below builds libs/shared and
#    libs/game-core automatically first, via Nx's dependsOn: ["^build"].
pnpm install

# 2. Create your env files from the committed examples.
#    Both are gitignored — nothing sensitive is committed, but you must
#    create them yourself; the app will not start without them.
cp .env.example backend/.env
cp .env.example frontend/.env.local

# 3. Start Postgres, Redis, and a local LiveKit server
docker compose up -d

# 4. Run migrations, then seed the word decks (idempotent — safe to re-run)
pnpm --filter backend db:migrate
pnpm --filter backend db:seed

# 5. Start backend (:4000) and frontend (:3000) together
pnpm dev
```

Open http://localhost:3000. `GET http://localhost:4000/api/health` should
return `{"status":"ok","voice":true,"oauth":false}` once the backend is up
(`voice`/`oauth` reflect whether `LIVEKIT_URL` / `GOOGLE_CLIENT_ID` are set —
see below).

`backend/.env` and `frontend/.env.local` both read from the **same**
`.env.example` template; the backend ignores the `NEXT_PUBLIC_*` keys and the
frontend ignores everything else, so copying the same file to both locations
is deliberate, not a mistake.

To stop the local services: `docker compose down` (add `-v` to also drop the
Postgres volume).

## Environment variables

`.env.example` is the canonical list. All of these matter to at least one of
the two apps; a value of `dev-*-secret-*` etc. is fine for local dev and must
never be reused anywhere real.

| Variable | Used by | Purpose |
|---|---|---|
| `NODE_ENV` | backend | `development` locally |
| `PORT` | backend | API/WS port, default `4000` |
| `CORS_ORIGIN` | backend | Origin allowed to call the API — must match where the frontend is served |
| `DATABASE_URL` | backend | Postgres connection string (also read directly by `sequelize-cli` for migrate/seed) |
| `REDIS_URL` | backend | Redis connection string — Socket.IO adapter, presence pub/sub, game session cache, rate limiting |
| `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` | backend | Signing secrets for the two JWTs |
| `JWT_ACCESS_TTL` / `JWT_REFRESH_TTL` | backend | Token lifetimes, default `15m` / `30d` |
| `LIVEKIT_URL` | backend, frontend | LiveKit server URL. **Empty disables voice entirely** — `GET /api/health` reports `voice: false` and the frontend shows the voice panel as unavailable. The app still runs without Docker this way. |
| `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` | backend | Used to mint scoped LiveKit access tokens |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | backend | **Empty disables Google OAuth** — the strategy is registered but unreachable; guest and email auth are unaffected |
| `GOOGLE_CALLBACK_URL` | backend | OAuth callback URL, only relevant if the above two are set |
| `NEXT_PUBLIC_API_URL` | frontend | Base URL the browser calls for REST |
| `NEXT_PUBLIC_WS_URL` | frontend | Base URL the browser connects the Socket.IO client to |

## How to play

**Alias** — Teams take turns. One player on the active team explains a
secret word to their teammates without saying the word itself or any part of
it; teammates call out guesses out loud, the explainer marks a guess
correct in the UI, and the round clock keeps running until it hits zero.
Skipping a word costs the team a point.

**Hat** — Same rules and the same word-engine round as Alias, just scored
without the skip penalty (a skip costs nothing). Functionally a second
difficulty setting on Alias, not a separate game.

**Crocodile** — Same word-engine round as Alias/Hat, but there are no teams:
every player is scored individually. Instead of explaining with words, the
active player draws the secret word on a shared canvas. When someone guesses
correctly out loud, the drawer picks **who** guessed it from the roster —
that player is the one who scores.

**Durak** ("Fool") — Standard 36-card Durak. One player attacks by placing a
card; the defender must beat it with a higher card of the same suit or any
trump, or take the whole pile into their hand. Other players may pile on
more attacking cards of a rank already on the table, up to the defender's
hand size. A round ends when the defender either beats every attack (cards
go to the discard pile) or takes (the attacking cards go to their hand and
the attack passes to the next player). First player to empty their hand with
no cards left to draw is out; the last player still holding cards is the
Durak. Because a non-adaptive strategy can in principle keep a Durak game
going indefinitely, the server caps the number of actions in a single
session as a backstop.

**Nine** — Sequence-building with the full 36-card deck dealt out (no draw
pile). The first play of the game must be the nine of spades. After that,
any nine opens its suit's run; any other card extends an already-open suit
upward or downward from what's already on the table. First player to empty
their hand wins.

## Testing and verification

```bash
pnpm install
pnpm lint                 # Biome
pnpm typecheck             # tsc --noEmit across all four projects
pnpm test                  # game-core (Vitest) + backend (Jest); frontend has no automated tests
pnpm build                  # shared, game-core, frontend (Next build), backend (Nest build)
cd backend && pnpm test:e2e  # real-socket e2e scenarios, needs docker compose services running
```

**Test coverage as of this commit:** backend 152 unit tests + 3 e2e
scenarios (full Alias lifecycle, a rejected out-of-turn action, and
disconnect/reconnect within the grace period, all over real sockets against
a real Postgres+Redis); `libs/game-core` 118 tests (rule tables, round
flows, deterministic-shuffle property tests, `view()` secret-leak checks).
**The frontend has no automated tests** — `pnpm --filter frontend test` is a
placeholder that exits 0. Everything on the frontend was verified manually
during development; there is no regression net for it beyond `typecheck` and
`build`.

## Infra — configuration only, nothing is deployed

**`infra/` and `charts/` are Terraform and Helm configuration. No
`terraform apply`, no `terraform plan` against a real AWS account, no `helm
install`, and no `kubectl apply` have been run against real infrastructure
at any point.** What has been run, and is safe to re-run, is offline
validation:

```bash
cd infra
terraform fmt -check -recursive
terraform init -backend=false
terraform validate

cd ..
helm lint charts/backend-api charts/frontend charts/livekit
```

`infra/README.md` has the full detail (module list, remote-state
bootstrapping, cost warnings). The short version of what's there:
Terraform modules for a VPC, ECR, RDS (Postgres), ElastiCache (Redis), EKS,
a GitHub OIDC role for CI, Argo CD, and a monitoring stack; Helm charts for
`backend-api`, `frontend`, and `livekit`; three GitHub Actions workflows
(`ci.yml`, `backend-deploy.yml`, `frontend-deploy.yml`).

### Known limitations — read before treating any of this as production-ready

- **Presence is in-process.** `PresenceService` tracks who's connected in
  each backend replica's own memory. The Socket.IO Redis adapter still
  routes messages correctly across replicas, but presence (who's shown as
  online/disconnected) is only accurate with exactly one backend replica.
  `charts/backend-api/values.yaml` defaults to `replicaCount: 1` and
  `autoscaling.enabled: false` for exactly this reason — turning on the HPA
  today is a correctness regression, not added capacity.
- **In-process game timers do not survive a restart, and neither does the
  Redis state they depend on — there is no rehydration and no TTL.**
  `GameTimerService`'s round clock (word games) and
  `GameRuntimeService`'s `lobbyReturnTimers` (the 8s `results → lobby`
  countdown) are bare `setTimeout` calls tracked only in process memory;
  the `game:state:*` and `room:session:*` Redis keys they depend on carry no
  TTL either. Any pod restart — including a routine Helm rolling update at
  the default `replicaCount: 1` — leaves an in-flight round's clock never
  firing, and strands any room caught inside the 8-second results window in
  `results` with no player action able to clear it. Word games are partly
  recoverable (the explainer's own end-round button still dispatches once
  the process is back, since the Redis state itself survived); a stuck
  `results` screen is not. The fix for a player abandoning a game (see
  `GameRuntimeService.abandonIfPlayerLeft`) does **not** rescue this case
  either: by the time a room reaches `results`, `doFinish` has already
  cleared the session state that fix depends on to detect an active game, so
  a departure during `results` is simply a no-op. A real fix needs a
  durable/shared scheduler (e.g. a Redis-backed delayed job queue) plus TTLs
  on both Redis key families — the same shape of gap `GameTimerService`'s
  own doc comment already names for the timer half of this.
- **The backend-api Ingress is inert by default.** Its
  `alb.ingress.kubernetes.io/*` annotations target the AWS Load Balancer
  Controller. This repo's Terraform does not install that controller (only
  `metrics-server`, needed for the HPA). The Ingress object is valid and
  will render, but nothing will satisfy it until an operator installs the
  AWS Load Balancer Controller on the target cluster — that is a named
  prerequisite for a real deployment, not an implementation detail.
- **The EKS API server is open to the internet by default.** The root
  `eks_cluster_endpoint_public_access_cidrs` variable (passed through to
  `modules/eks`'s `cluster_endpoint_public_access_cidrs`) defaults to
  `0.0.0.0/0`. It genuinely is a tunable knob — set it in `terraform.tfvars`
  (see `terraform.tfvars.example`) to an office/VPN/CI-runner CIDR range —
  but the shipped default is acceptable only for a prototype that deploys
  nothing; narrow it before any real use.
- **The access token lives in `localStorage`**, which is readable by any
  script that achieves XSS on the frontend. This is bounded, not fixed: the
  access token's TTL is 15 minutes, and the refresh token that renews it
  lives only in an httpOnly cookie the JS layer can never read.
- **Logout does not revoke the refresh JWT.** It clears client-side state
  and the cookie, but the token itself stays valid until it expires — a
  replay window exists for anyone who captured it beforehand. A real
  deployment would need a revocation list or rotating token family.
- **REST room mutations are not covered by the Redis lock that serializes
  WebSocket room mutations.** WS handlers for the same room are
  mutex-protected against each other; a REST call racing a WS action on the
  same room is not.
- **LiveKit's Kubernetes Service declares 104 listeners on one Network Load
  Balancer** (2 TCP + a 101-port UDP media range + UDP TURN). This is
  likely above the default AWS quota for listeners per NLB and would need a
  quota increase request before a real deploy succeeds. Not verified
  against a real account.
- **`image.repository` is intentionally empty** in every chart's
  `values.yaml` (it's account-specific ECR URL, not something to hardcode).
  CI only bumps `image.tag`; an operator sets `image.repository` at deploy
  time.
- **Durak can, in principle, run forever** under a sufficiently
  non-adaptive strategy (verified in testing: a 48-action periodic orbit at
  one seed/player-count combination). The game runtime caps the number of
  actions allowed in a single session as a backstop; it does not change the
  card rules.
- **`charts/applications/*.yaml` carries a placeholder Argo CD repo URL.**
  These `Application` manifests exist to prove the GitOps wiring renders
  correctly (each points a `Chart.yaml` path so Argo Helm-renders it, not a
  bare Kubernetes manifest) — they are not pointed at a real Git remote.

None of the above are hidden defects; they're documented tradeoffs for a
prototype scoped explicitly to configuration, not deployment.

## License

MIT — see `LICENSE`.
