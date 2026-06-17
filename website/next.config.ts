import type { NextConfig } from 'next';
import path from 'node:path';
import { withSentryConfig } from '@sentry/nextjs';

/*
 * Tuatale website Next.js config.
 *
 * turbopack.root: pinned to this directory because the website lives as a
 * sibling of the DaBookTing pipeline at the repo root (which has its own
 * package-lock.json). Without this pin, Next.js would walk up looking for
 * a workspace root and pick the wrong one.
 *
 * Sentry: withSentryConfig wraps the config to enable source-map upload,
 * route-handler instrumentation, and the tunnel route for ad-blocker
 * resilience. Source-map upload only fires when SENTRY_AUTH_TOKEN +
 * SENTRY_ORG + SENTRY_PROJECT are present — without them, runtime
 * tracking still works but stack traces in the Sentry UI will be
 * minified. Add those env vars in Phase 2 when you wire CI uploads.
 */
const nextConfig: NextConfig = {
  turbopack: {
    root: path.resolve(__dirname),
  },
  experimental: {
    // The character-preview photo path uploads a (downscaled) PNG through a
    // Server Action. The default body limit is 1MB, which a full-res phone
    // photo silently exceeds; raise it. The client also downscales to ~640px
    // first, so this is belt-and-suspenders.
    serverActions: {
      bodySizeLimit: '4mb',
    },
  },
};

export default withSentryConfig(nextConfig, {
  // Silent during local dev; verbose in CI to surface build-time issues.
  silent: !process.env.CI,
  // Disable telemetry; we self-report via the SDK already.
  telemetry: false,
  // Tunnel route hides Sentry traffic behind /monitoring so ad blockers
  // don't drop events. Cheap and harmless.
  tunnelRoute: '/monitoring',
  // Source-map upload is opt-in via env. When SENTRY_AUTH_TOKEN is unset,
  // the withSentryConfig wrapper still works for runtime; it just skips
  // the upload step (warning printed in CI, silent locally).
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
});
