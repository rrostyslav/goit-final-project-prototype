# syntax=docker/dockerfile:1
#
# Backend image: NestJS API + Socket.IO gateway (backend/src/main.ts),
# started with `node dist/main.js`, listening on 4000.
#
# Build context is the REPO ROOT (see docker-compose.yml / CI: this file is
# always invoked as `docker build -f backend/Dockerfile .`), because this is
# an Nx package-based pnpm monorepo: `backend` depends on `@gp/shared` and
# `@gp/game-core` (libs/shared, libs/game-core) via `workspace:*`, and both
# are consumed as their COMPILED CommonJS `dist/` output, not raw TypeScript
# (see each package's `package.json`: `"main": "dist/index.js"`). A build
# that only copies `backend/` and skips building those two libs first would
# produce an image that fails at import time — there is no `dist/` for
# `require('@gp/shared')` to resolve. All three packages are built together
# below in dependency order.

ARG NODE_VERSION=24-alpine
ARG PNPM_VERSION=11.2.2

# ---------------------------------------------------------------------------
# Stage: base — Node + pnpm, nothing else
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION} AS base
RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate
WORKDIR /app

# ---------------------------------------------------------------------------
# Stage: deps — install the full workspace dependency graph (incl. dev deps,
# needed for `nest build`/`tsc`) using only manifests, so this layer is
# cached across builds that don't touch dependencies at all.
# ---------------------------------------------------------------------------
FROM base AS deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml .npmrc ./
COPY libs/shared/package.json ./libs/shared/package.json
COPY libs/game-core/package.json ./libs/game-core/package.json
COPY backend/package.json ./backend/package.json
# frontend/ is part of the pnpm workspace glob but is NOT a dependency of
# backend at runtime; deliberately not copied into this image at all, so a
# lockfile/workspace resolution that happened to touch frontend can't leak
# frontend-only deps into the backend's install.
RUN pnpm install --frozen-lockfile

# ---------------------------------------------------------------------------
# Stage: build — compile libs/shared, libs/game-core (tsc) then backend
# (`nest build`), in that dependency order. Only `dist/` from this stage is
# used later; its node_modules (full dev+prod install) is never copied
# forward.
# ---------------------------------------------------------------------------
FROM deps AS build
COPY tsconfig.base.json ./
COPY libs/shared ./libs/shared
COPY libs/game-core ./libs/game-core
COPY backend ./backend

RUN pnpm --filter @gp/shared build \
 && pnpm --filter @gp/game-core build \
 && pnpm --filter backend build

# ---------------------------------------------------------------------------
# Stage: prod-deps — a SEPARATE, from-scratch `--prod` install (manifests
# only, same as `deps` above), rather than `pnpm prune --prod` run against
# the `deps`/`build` install. Verified this the hard way: `pnpm prune --prod`
# invoked at the workspace root does not just strip devDependencies the way
# its name suggests — in this workspace it collapsed EVERY project's
# node_modules (root's own, and backend's, checked directly inside the
# built image) down to empty, `@gp/shared`/`@gp/game-core`'s symlinks
# included, leaving a runtime image that fails with `Cannot find module
# '@gp/shared'`. A dedicated `--prod` install sidesteps that entirely: it
# never installs devDependencies in the first place, so there is nothing to
# prune, and it produces the correct `backend/node_modules/@gp/{shared,
# game-core}` workspace symlinks directly.
# ---------------------------------------------------------------------------
FROM base AS prod-deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml .npmrc ./
COPY libs/shared/package.json ./libs/shared/package.json
COPY libs/game-core/package.json ./libs/game-core/package.json
COPY backend/package.json ./backend/package.json
RUN pnpm install --frozen-lockfile --prod

# ---------------------------------------------------------------------------
# Stage: runtime — slim final image, non-root user, only compiled output +
# production node_modules.
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION} AS runtime
ENV NODE_ENV=production
WORKDIR /app

# node:*-alpine ships a pre-created, unprivileged `node` user (uid/gid 1000)
# for exactly this purpose — no separate `addgroup`/`adduser` needed.
COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=prod-deps --chown=node:node /app/backend/node_modules ./backend/node_modules
COPY --from=build --chown=node:node /app/libs/shared/package.json ./libs/shared/package.json
COPY --from=build --chown=node:node /app/libs/shared/dist ./libs/shared/dist
COPY --from=build --chown=node:node /app/libs/game-core/package.json ./libs/game-core/package.json
COPY --from=build --chown=node:node /app/libs/game-core/dist ./libs/game-core/dist
# libs/game-core itself depends on @gp/shared (its own package.json:
# `"dependencies": {"@gp/shared": "workspace:*"}` — used by its `alias.ts`
# word-game engine). Node resolves that `require('@gp/shared')` starting
# from libs/game-core's OWN node_modules, not backend's, so that symlink
# has to be copied too — verified by hitting exactly this at container
# startup (`Cannot find module '@gp/shared'`, required from
# `libs/game-core/dist/games/alias.js`) before this line was added.
COPY --from=prod-deps --chown=node:node /app/libs/game-core/node_modules ./libs/game-core/node_modules
COPY --from=build --chown=node:node /app/backend/package.json ./backend/package.json
COPY --from=build --chown=node:node /app/backend/dist ./backend/dist

USER node
WORKDIR /app/backend

# backend/src/config/env.config.ts requires DATABASE_URL, REDIS_URL,
# JWT_ACCESS_SECRET and JWT_REFRESH_SECRET at process start (no defaults);
# these are injected at deploy time (charts/backend-api's Secret/ConfigMap),
# never baked into this image. backend/.env is excluded from the build
# context entirely — see .dockerignore.
EXPOSE 4000

CMD ["node", "dist/main.js"]
