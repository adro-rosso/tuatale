/*
 * Sentry — server runtime (Node.js).
 *
 * Imported by ./instrumentation.ts during Next.js's `register()` hook
 * when process.env.NEXT_RUNTIME === 'nodejs'.
 *
 * Phase 1: error tracking only. No performance tracing, no session
 * replay — they're paid features and the spec only requires error capture.
 * If you turn on Tracing here, set tracesSampleRate to 0.1 in production
 * (full sample rate at 100% is expensive and noisy).
 */
import * as Sentry from '@sentry/nextjs';

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  // No-op gracefully when DSN missing (local dev without env).
  enabled: !!process.env.NEXT_PUBLIC_SENTRY_DSN,
  // Error tracking only at launch.
  tracesSampleRate: 0,
  debug: false,
});
