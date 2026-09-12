// Jest sets NODE_ENV=test automatically, which makes src/config/env.ts load .env.test
// (a separate carwash_test database) instead of the development .env.
jest.setTimeout(30000);
