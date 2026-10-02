import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests drive the real stack: Next.js → API → PostgreSQL, with the mock provider delivering signed
 * webhooks. Start the API and web app first (`pnpm dev`), or let Playwright start them from a production build.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  use: { baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1360, height: 900 } } }],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : [
        // The suite signs in dozens of times from one address, so the login rate limit is lifted for the test run only.
        { command: 'pnpm --filter @paybridge/api start', url: 'http://localhost:4000/health/ready', reuseExistingServer: !process.env.CI, timeout: 60_000, cwd: '../..', env: { RATE_LIMIT_DISABLED: 'true', MOCK_PROVIDER_DELAY_MS: '1000' } },
        { command: 'pnpm --filter @paybridge/web start', url: 'http://localhost:3000/login', reuseExistingServer: !process.env.CI, timeout: 60_000, cwd: '../..' },
      ],
});
