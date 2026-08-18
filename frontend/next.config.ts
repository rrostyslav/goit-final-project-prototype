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
}

export default nextConfig
