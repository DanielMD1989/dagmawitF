import { defineConfig } from 'vitest/config';

// Database tests: run against a real PostgreSQL (Supabase local stack in CI, or any plain
// PostgreSQL server locally). See test/db/global-setup.ts.
export default defineConfig({
  test: {
    include: ['test/db/**/*.test.ts'],
    globalSetup: ['test/db/global-setup.ts'],
    // One shared database, each test in its own rolled-back transaction.
    fileParallelism: false,
    testTimeout: 20_000,
  },
});
