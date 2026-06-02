/*
 * Sentry — edge runtime.
 *
 * Imported by ./instrumentation.ts during Next.js's `register()` hook
 * when process.env.NEXT_RUNTIME === 'edge' (middleware, edge route
 * handlers). Tuatale doesn't ship edge code in Phase 1, but this config
 * is in place so we don't silently lose error reporting if/when we add
 * edge runtime later.
 */
import * as Sentry from '@sentry/nextjs';

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  enabled: !!process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 0,
  debug: false,
});
