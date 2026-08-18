/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  // Only files under test/e2e ending in `.e2e-spec.ts` — deliberately a
  // different suffix from the unit suite's `.spec.ts` (see jest.config.js's
  // testPathIgnorePatterns) so `pnpm test` can never accidentally pick these
  // up, and vice versa.
  testRegex: 'test/e2e/.*\\.e2e-spec\\.ts$',
  moduleFileExtensions: ['js', 'json', 'ts'],
  transform: {
    '^.+\\.(t|j)s$': 'ts-jest',
  },
  // Real Postgres/Redis round trips and one deliberate ~8s wait for the
  // runtime's results -> lobby timer (see RESULTS_TO_LOBBY_MS) make this
  // suite much slower than the mocked unit tests' default 5s.
  testTimeout: 30_000,
}
