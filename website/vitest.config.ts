import { defineConfig } from 'vitest/config';
import { loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

/*
 * Vitest config for Tuatale.
 *
 * jsdom environment so React components can render in tests.
 * Path alias mirrors tsconfig's "@/*": "./*" so imports work the same
 * in tests as in production code.
 *
 * Playwright E2E tests live under tests/e2e/ and are excluded here —
 * they run via `npm run test:e2e` against the playwright runner instead.
 *
 * .env.local loading: Vitest does NOT auto-load .env files the way Next.js
 * does — without explicit handling, tests/db/ integration suites that
 * read process.env.TEST_SUPABASE_URL would always see undefined and skip.
 * loadEnv(mode, cwd, '') reads .env, .env.local, .env.{mode},
 * .env.{mode}.local (empty prefix = no filter, so TEST_*, NEXT_PUBLIC_*,
 * SUPABASE_*, STRIPE_*, SENTRY_* all flow through). The test.env object
 * is then assigned onto process.env in each test process.
 *
 * Security note: this means tests run with production-equivalent env
 * available locally (including service-role keys). That's fine for the
 * tuatale-test-only integration suites, but DO NOT add real network
 * calls against tuatale-prod inside any test — the credentials would
 * permit it but the side effects would be unrecoverable.
 */
export default defineConfig(({ mode }) => ({
  plugins: [react()],
  test: {
    env: loadEnv(mode, process.cwd(), ''),
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    include: ['tests/**/*.test.{ts,tsx}'],
    exclude: ['tests/e2e/**', 'node_modules/**', '.next/**'],
    // Serial test-file execution. Required because tests/db/ integration
    // suites share one Supabase test project and each beforeEach truncates
    // all three tables — without this, drafts.test.ts's reads can race
    // against orders.test.ts's truncate. Per-file isolation isn't an
    // option (one schema across all suites). Cost: ~5s wall time vs ~2s
    // for the unit tests; acceptable for v1.
    fileParallelism: false,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
}));
