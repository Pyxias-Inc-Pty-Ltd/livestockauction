import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/spec'],
  testMatch: ['**/*.spec.ts'],
  moduleNameMapper: {
    '^@repos/(.*)$': '<rootDir>/src/repos/$1',
    '^@models/(.*)$': '<rootDir>/src/models/$1',
    '^@shared/(.*)$': '<rootDir>/src/shared/$1',
    '^@server$': '<rootDir>/src/server',
    '^@services/(.*)$': '<rootDir>/src/services/$1',
    '^@routes/(.*)$': '<rootDir>/src/routes/$1',
  },
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: './tsconfig.json' }],
  },
  setupFiles: ['<rootDir>/spec/helpers/env.ts'],
  testTimeout: 30000,
  coverageDirectory: 'coverage',
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/pre-start/**',
    '!src/index.ts',
  ],
};

export default config;
