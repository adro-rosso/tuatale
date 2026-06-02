import { defineConfig } from 'vitest/config';
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
 */
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    include: ['tests/**/*.test.{ts,tsx}'],
    exclude: ['tests/e2e/**', 'node_modules/**', '.next/**'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
});
