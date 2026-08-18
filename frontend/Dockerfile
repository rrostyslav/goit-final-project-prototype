# syntax=docker/dockerfile:1
#
# Frontend image: Next.js app (App Router), standalone output, `node
# server.js`, listening on 3000.
#
# Build context is the REPO ROOT (`docker build -f frontend/Dockerfile .`) —
# same reasoning as backend/Dockerfile: this is an Nx package-based pnpm
# monorepo and `frontend` depends on `@gp/shared` (libs/shared) via
# `workspace:*`, consumed as compiled CommonJS (`libs/shared/package.json`'s
# `"main": "dist/index.js"`), so `libs/shared` must be built before
# `frontend`. `frontend` does NOT depend on `@gp/game-core` or `backend`, so
# neither is copied into this build at all.
#
# IMPORTANT — this image is environment-specific, not portable. Next.js
# inlines every `NEXT_PUBLIC_*` env var directly into the client-side
# JavaScript bundle at `next build` time (a static string substitution done
# once, not something the running server re-reads per request — see
# frontend/src/lib/api.ts / socket.ts, both read via `process.env` at
# module-eval time, and charts/frontend/values.yaml's top-of-file comment,
# which documents this same constraint from the Helm-chart side and
# deliberately exposes no such key at deploy time because it would have zero
# effect on an already-built image). Whatever `NEXT_PUBLIC_API_URL` /
# `NEXT_PUBLIC_WS_URL` this image is built with are permanently baked into
# it — pointed at one environment's backend. Deploying the SAME image tag to
# a different environment (say, staging's API host) would silently talk to
# the wrong backend from the browser's perspective. There is no config fix
# for this at the Kubernetes/Helm layer; the only correct fix is building a
# separate image per environment (distinct tag) whenever these URLs differ.
ARG NODE_VERSION=24-alpine
ARG PNPM_VERSION=11.2.2

# Build-time-only values baked into the client bundle — see the notice
# above. Defaults match the docker-compose/local dev backend so a bare
# `docker build` (e.g. Step 2's local verification build) still produces a
# working image; override both with `--build-arg` for any real environment.
ARG NEXT_PUBLIC_API_URL=http://localhost:4000
ARG NEXT_PUBLIC_WS_URL=http://localhost:4000

# ---------------------------------------------------------------------------
# Stage: base — Node + pnpm, nothing else
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION} AS base
RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate
WORKDIR /app

# ---------------------------------------------------------------------------
# Stage: deps — install the workspace dependency graph frontend actually
# needs (frontend + @gp/shared), using only manifests, cached independently
# of source changes.
# ---------------------------------------------------------------------------
FROM base AS deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml .npmrc ./
COPY libs/shared/package.json ./libs/shared/package.json
COPY frontend/package.json ./frontend/package.json
RUN pnpm install --frozen-lockfile

# ---------------------------------------------------------------------------
# Stage: build — compile libs/shared (tsc), then `next build` with
# `output: 'standalone'` (frontend/next.config.ts).
# ---------------------------------------------------------------------------
FROM deps AS build
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_WS_URL
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
ENV NEXT_PUBLIC_WS_URL=${NEXT_PUBLIC_WS_URL}

COPY tsconfig.base.json ./
COPY libs/shared ./libs/shared
COPY frontend ./frontend

RUN pnpm --filter @gp/shared build \
 && pnpm --filter frontend build

# Known Next.js + pnpm standalone-output tracing gap, verified directly (not
# assumed): `.next/standalone`'s copy of `@swc/helpers` — required by every
# SWC-compiled file's interop helpers — is missing its `esm/` subdirectory,
# even though `cjs/` is present, in BOTH this Docker build and a bare `next
# build` run outside Docker against the exact same lockfile. Node 24's CJS
# loader resolves one of `@swc/helpers`' subpath `exports` conditions to the
# `esm/` target for a plain `require()` (`require(esm)`, stable in current
# Node) — exactly the file Next's tracer didn't consider reachable and
# therefore didn't copy. Without this, the runtime stage fails at startup
# with `Error: Cannot find module '.../@swc/helpers/esm/_interop_require_default.js'`.
# Fix: overlay the complete, untraced `@swc/helpers` package (present in
# this stage's full `node_modules`, `esm/` included) over the incomplete
# traced copy, wherever the traced tree references it.
RUN SRC="$(find node_modules/.pnpm -maxdepth 1 -type d -name '@swc+helpers@*')/node_modules/@swc/helpers" && \
    test -d "$SRC/esm" && \
    for dst in $(find frontend/.next/standalone -type d -path '*/node_modules/@swc/helpers'); do \
      rm -rf "$dst" && cp -a "$SRC" "$dst"; \
    done

# ---------------------------------------------------------------------------
# Stage: runtime — Next.js standalone output only. `output: 'standalone'`
# traces the real runtime import graph and writes a self-contained
# `.next/standalone/` (server.js + the small subset of node_modules actually
# needed), which is dramatically smaller than shipping the full build tree
# plus complete node_modules. Because this is a monorepo, the traced root is
# the repo root, so `.next/standalone/` mirrors that layout as
# `.next/standalone/frontend/server.js` (verified by inspecting the actual
# build output, not assumed) — hence copying `.../standalone/.` (which
# contains both the top-level hoisted node_modules AND the nested
# `frontend/` dir) rather than a flattened path. Static assets and `public/`
# are deliberately excluded from standalone tracing by Next itself and must
# be copied in separately, per Next's documented standalone deployment
# steps.
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION} AS runtime
ENV NODE_ENV=production
WORKDIR /app

# node:*-alpine ships a pre-created, unprivileged `node` user (uid/gid 1000).
COPY --from=build --chown=node:node /app/frontend/.next/standalone ./
COPY --from=build --chown=node:node /app/frontend/.next/static ./frontend/.next/static
COPY --from=build --chown=node:node /app/frontend/public ./frontend/public

USER node
WORKDIR /app/frontend

# next/dist/server/lib/start-server (invoked by server.js) binds hostname
# from $HOSTNAME (defaults to 0.0.0.0, verified by reading the generated
# server.js) and port from $PORT (defaults to 3000) — matches
# charts/frontend/values.yaml's service.targetPort/ConfigMap PORT entry.
EXPOSE 3000

CMD ["node", "server.js"]
