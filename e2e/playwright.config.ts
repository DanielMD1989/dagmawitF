import { defineConfig } from '@playwright/test';
import { env } from './support/env';

/**
 * The browser suite (docs/testing.md). The specs are one story, in order: she takes jobs, lives her calendar, works
 * without signal, and signs out. So they run one after another in one worker.
 */
export default defineConfig({
  testDir: '.',
  testMatch: /\d\d-.*\.spec\.ts$/,
  globalSetup: './global-setup.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 10_000 },
  // On GitHub, failures also become annotations on the run, readable without opening the logs.
  reporter: process.env.CI
    ? [['github'], ['list'], ['html', { open: 'never', outputFolder: '../playwright-report' }]]
    : 'list',
  outputDir: '../test-results',
  use: {
    baseURL: env.baseURL,
    actionTimeout: 10_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  // Without E2E_BASE_URL, the suite starts the built app itself (run `npm run build` first).
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: 'npm run start -- -p 3000',
        url: `${env.baseURL}/sign-in`,
        reuseExistingServer: !process.env.CI,
        timeout: 60_000,
      },
});
