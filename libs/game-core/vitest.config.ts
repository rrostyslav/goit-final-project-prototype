import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.spec.ts'],
    watch: false,
    // Property tests (Durak, Nine) drive ~100 full simulated games each and
    // are CPU-bound; the default 5000ms per-test timeout is comfortable for
    // any one of them alone but can be exceeded when several run
    // concurrently in separate workers and contend for CPU. Raised well
    // above the ~3.5-4.5s any single property test takes in isolation so
    // the suite stays reliably green under normal parallel execution,
    // without weakening what any test actually asserts.
    testTimeout: 20_000,
  },
})
