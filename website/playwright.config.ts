import { defineConfig, devices } from '@playwright/test';

/*
 * Playwright config for Tuatale.
 *
 * Three viewports:
 *   chromium-desktop — standard desktop (1280x720)
 *   chromium-mobile  — iPhone 14 viewport (390x844 logical, DPR 3)
 *   chromium-tablet  — iPad viewport (820x1180 logical)
 *
 * Phase 1 has no E2E tests yet — this config exists so `npm run test:e2e`
 * exits 0 once tests are added in later phases.
 *
 * Tests live in tests/e2e/. The dev server is auto-started by playwright
 * before tests run, against the build (or `npm run dev`).
 */
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  projects: [
    {
      name: 'chromium-desktop',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'chromium-mobile',
      use: { ...devices['iPhone 14'] },
    },
    {
      name: 'chromium-tablet',
      use: { ...devices['iPad (gen 7)'] },
    },
  ],
});
