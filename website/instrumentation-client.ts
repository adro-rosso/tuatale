/*
 * Next 16 client-instrumentation hook — browser SDK init.
 *
 * This file is loaded by Next.js before any client JS executes, so the
 * Sentry SDK is ready to capture errors that fire during the initial
 * render. The actual init lives in ./sentry.client.config.ts (the file
 * the user spec specifically named).
 *
 * `onRouterTransitionStart` is forwarded to Sentry so client-side
 * navigation events are surfaced as breadcrumbs.
 */
import * as Sentry from '@sentry/nextjs';
import './sentry.client.config';

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
