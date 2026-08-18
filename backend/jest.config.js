/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  testRegex: 'test/.*\\.spec\\.ts$',
  // Belt-and-suspenders: the e2e specs already use a `.e2e-spec.ts` suffix
  // that testRegex above never matches, but excluding the directory outright
  // keeps this suite (real Postgres/Redis, no mocks) from ever running
  // inside `pnpm test` even if that naming convention drifts later.
  testPathIgnorePatterns: ['<rootDir>/test/e2e/'],
  moduleFileExtensions: ['js', 'json', 'ts'],
  transform: {
    '^.+\\.(t|j)s$': 'ts-jest',
  },
  collectCoverageFrom: ['src/**/*.(t|j)s'],
}
