import { defineConfig, devices } from '@playwright/test';

/*
 * Playwright config for Tuatale.
 *
 * Three viewports:
 *   chromium-desktop — standard desktop (1280x720)
 *   chromium-mobile  — iPhone 14 viewport (390x844 logical, DPR 3)
 *   chromium-tablet  — iPad viewport (820x1180 logical)
 *
 * Tests live in tests/e2e/. The dev server is auto-started by playwright
 * before tests run, against the build (or `npm run dev`).
 *
 * webServer.env override
 * ----------------------
 * The Cycle A.6 full-funnel test needs the dev server to point at
 * tuatale-test (not whatever .env.local says) so the webhook and admin
 * ship-flow write to the same DB the test process is asserting against.
 * It also needs the dummy Stripe webhook secret the fixture signs with
 * + the E2E_TEST_MODE_FAKE_EMAIL_SEND flag so Resend isn't called.
 *
 * Pass-through chain:
 *   - TEST_SUPABASE_URL                  → NEXT_PUBLIC_SUPABASE_URL
 *   - TEST_SUPABASE_SERVICE_ROLE_KEY     → SUPABASE_SERVICE_ROLE_KEY
 *                                       AND NEXT_PUBLIC_SUPABASE_ANON_KEY
 *                                       (no anon key for the test project;
 *                                        admin/* routes use service role)
 *   - ADMIN_USERNAME / ADMIN_PASSWORD     pass through unchanged
 *   - STRIPE_SECRET_KEY = sk_test_dummy
 *   - STRIPE_WEBHOOK_SECRET = the dummy secret the fixture forges against
 *   - E2E_TEST_MODE_FAKE_EMAIL_SEND = true
 *   - INNGEST_EVENT_KEY: the dev server's stripe webhook calls
 *     inngest.send after creating the job, but the dispatch is
 *     fail-open. Setting a dummy key lets the Inngest SDK construct
 *     without throwing; the send call may noisily fail and that's fine.
 *
 * Non-CI runs `reuseExistingServer: true`, which means if you already
 * have `npm run dev` running with prod env, the full-funnel test will
 * be confused — the env override only applies to dev servers playwright
 * spawns itself. For a clean run from a dirty terminal, stop the dev
 * server first.
 */
// Only apply the full-funnel dev-server env overrides when we're
// actually equipped to run that test — TEST_SUPABASE_URL +
// TEST_SUPABASE_SERVICE_ROLE_KEY both present. Otherwise the wizard
// e2e tests that read the customer-facing .env.local would be broken
// by us forcing an empty NEXT_PUBLIC_SUPABASE_URL onto the dev server.
const fullFunnelConfigured =
  !!process.env.TEST_SUPABASE_URL && !!process.env.TEST_SUPABASE_SERVICE_ROLE_KEY;

const fullFunnelEnv: Record<string, string> = fullFunnelConfigured
  ? {
      // Point the dev server's Supabase client at tuatale-test so its
      // webhook + admin write to the same DB the test asserts against.
      NEXT_PUBLIC_SUPABASE_URL: process.env.TEST_SUPABASE_URL!,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.TEST_SUPABASE_SERVICE_ROLE_KEY!,
      SUPABASE_SERVICE_ROLE_KEY: process.env.TEST_SUPABASE_SERVICE_ROLE_KEY!,
      // Stripe — dummies the fixture's generateTestHeaderString signs against.
      STRIPE_SECRET_KEY: 'sk_test_dummy',
      STRIPE_WEBHOOK_SECRET: 'whsec_test_dummy_secret',
      // Resend — fake the email send for the full-funnel test so we
      // don't burn quota / deliver to inboxes.
      E2E_TEST_MODE_FAKE_EMAIL_SEND: 'true',
      RESEND_API_KEY: process.env.RESEND_API_KEY ?? 're_dummy_for_module_load',
      EMAIL_FROM: process.env.EMAIL_FROM ?? 'onboarding@resend.dev',
      // Inngest dispatch from the stripe webhook is fail-open, so dummy
      // keys are fine — the test invokes the handler directly.
      INNGEST_EVENT_KEY: process.env.INNGEST_EVENT_KEY ?? 'evt_dummy_for_module_load',
      INNGEST_SIGNING_KEY: process.env.INNGEST_SIGNING_KEY ?? 'signkey-prod-dummy-for-module-load',
      NEXT_PUBLIC_SITE_URL: 'http://localhost:3000',
    }
  : {};

// Admin auth env passes through unconditionally — needed by the Cycle
// A.4 admin auth tests + the full-funnel test. Defaults to empty so
// when unset, the admin tests skip (their existing gate) and the
// wizard tests are unaffected.
fullFunnelEnv.ADMIN_USERNAME = process.env.ADMIN_USERNAME ?? '';
fullFunnelEnv.ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? '';

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
    env: fullFunnelEnv,
  },
  projects: [
    // All three projects pinned to chromium. The default iPhone 14 /
    // iPad device descriptors use webkit, but our CI/local setup only
    // installs chromium (smaller download, fewer browsers to maintain).
    // We override browserName explicitly so the device's viewport +
    // user-agent + DPR all apply on top of chromium.
    {
      name: 'chromium-desktop',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'chromium-mobile',
      use: { ...devices['iPhone 14'], browserName: 'chromium' },
    },
    {
      name: 'chromium-tablet',
      use: { ...devices['iPad (gen 7)'], browserName: 'chromium' },
    },
  ],
});
