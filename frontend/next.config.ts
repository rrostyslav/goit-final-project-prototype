import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // @gp/shared is a pnpm workspace package. Required per the task-19 brief;
  // actually verified (not assumed) by building both with and without it --
  // in THIS repo state the build succeeds either way, because libs/shared
  // already ships pre-compiled CommonJS (dist/*.js + *.d.ts), which needs no
  // further transform. Kept anyway as the documented, forward-looking
  // default: it is a no-op today and becomes load-bearing the moment
  // @gp/shared (or a future workspace package) ships raw TS/ESM source
  // instead of a dist build.
  transpilePackages: ['@gp/shared'],

  // Task 27: standalone output. `next build` normally produces a build that
  // still needs the FULL `node_modules` tree (every dependency, including
  // ones only used by the CLI/dev server) copied into the runtime image --
  // hundreds of MB for a Next.js + React 19 + Tailwind app. Standalone mode
  // instead traces the actual runtime import graph and emits a minimal
  // `.next/standalone/` directory containing only `server.js` plus the
  // small subset of `node_modules` genuinely required at request time; the
  // rest (`.next/static/`, `public/`) is copied in by the Dockerfile
  // per Next's documented standalone-output layout. This is a build-output
  // shape change only -- no application code or behavior changes -- and
  // charts/frontend already assumes it: charts/frontend/values.yaml's
  // `service.targetPort` comment and templates/configmap.yaml's `PORT` key
  // both document "Next.js's default listen port for `node server.js` in
  // standalone output mode", i.e. Task 26 was already written expecting
  // this exact flag to be turned on here in Task 27. Enabling it, not
  // shipping the full build, keeps that already-committed assumption true
  // and gives a materially slimmer, faster-to-pull image.
  output: 'standalone',
}

export default nextConfig
