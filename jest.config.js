/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  testMatch: ['<rootDir>/tests/**/*.test.ts'],
  globalSetup: '<rootDir>/tests/helpers/global-setup.js',
  setupFilesAfterEnv: ['<rootDir>/tests/helpers/jest.setup.ts'],
  testTimeout: 30000,
  maxWorkers: 1,
  forceExit: true,
  verbose: true,
};
