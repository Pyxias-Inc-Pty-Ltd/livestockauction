import type { Config } from 'jest';

/**
 * Jest configuration for integration tests.
 *
 * These tests require external services (Redis) and are intentionally
 * excluded from the default `npm test` run.  Use `npm run test:integration`.
 *
 * Key differences from jest.config.ts:
 *  - Only runs files under spec/integration/
 *  - 120 s timeout (server startup + real Redis/MongoDB round-trips)
 *  - forceExit: true — closes lingering IORedis/Mongoose connections cleanly
 *  - runInBand: true — avoids port conflicts between parallel test files
 */
const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/spec'],
  testMatch: ['**/integration/**/*.spec.ts'],
  moduleNameMapper: {
    '^@repos/(.*)$': '<rootDir>/src/repos/$1',
    '^@models/(.*)$': '<rootDir>/src/models/$1',
    '^@shared/(.*)$': '<rootDir>/src/shared/$1',
    '^@server$': '<rootDir>/src/server',
    '^@services/(.*)$': '<rootDir>/src/services/$1',
    '^@routes/(.*)$': '<rootDir>/src/routes/$1',
    // src/index.ts starts an HTTP server and parses CLI args on import.
    // Replace it with a stub so services that import `io` from it still
    // compile without side effects.
    '^.+/src/index$': '<rootDir>/spec/helpers/mock-index.ts',
  },
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: './tsconfig.json' }],
  },
  setupFiles: [
    '<rootDir>/spec/helpers/env.ts',
    '<rootDir>/spec/helpers/integration-env.ts',
  ],
  testTimeout: 120_000,
  // Force Jest to exit after all tests complete — IORedis connections and the
  // BullMQ worker keep the event loop alive until explicitly closed, but
  // teardown races mean they sometimes don't drain in time.
  forceExit: true,
};

export default config;
