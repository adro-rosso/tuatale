/*
 * Next 16 instrumentation hook — server + edge SDK init.
 *
 * `register()` is called by Next.js once per server instance, before the
 * server handles any requests. We dispatch to runtime-specific Sentry
 * configs based on NEXT_RUNTIME so the right SDK initialises in each
 * environment.
 *
 * `onRequestError` is forwarded to Sentry's captureRequestError so
 * uncaught route-handler errors (including the deliberate
 * `/api/health?test_error=1` trigger) reach Sentry without manual
 * instrumentation in every route file.
 *
 * See node_modules/next/dist/docs/01-app/02-guides/instrumentation.md
 * for the hook contract.
 */
import * as Sentry from '@sentry/nextjs';

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config');
  }
  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config');
  }
}

export const onRequestError = Sentry.captureRequestError;
