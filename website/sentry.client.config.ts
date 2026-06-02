/*
 * Sentry — browser runtime.
 *
 * Imported by ./instrumentation-client.ts so the client SDK initialises
 * before any React mounts.
 *
 * NEXT_PUBLIC_SENTRY_DSN is browser-safe by design (Sentry DSNs identify
 * a project's ingest endpoint, not authorize anything). The auth-token
 * required for source-map upload stays server-only and isn't referenced
 * here.
 */
import * as Sentry from '@sentry/nextjs';

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  enabled: !!process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 0,
  debug: false,
  // Session Replay deferred — paid feature, not in Phase 1 scope.
  replaysOnErrorSampleRate: 0,
  replaysSessionSampleRate: 0,
});
