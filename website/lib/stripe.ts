/**
 * Stripe server-side client for Tuatale.
 *
 * Phase 1 is inert — the client is constructed when real keys are
 * present, but no API calls are made. /api/health uses this to confirm
 * the SDK initialises cleanly.
 *
 * Test-mode keys only at launch (sk_test_ / pk_test_). Live-mode flip
 * happens at Phase 5 when checkout goes live.
 *
 * NEVER import this from a client component — STRIPE_SECRET_KEY is
 * server-only.
 */
import Stripe from 'stripe';

let cached: Stripe | null = null;

export function getStripe(): Stripe {
  if (cached) return cached;
  const secret = process.env.STRIPE_SECRET_KEY;
  if (!secret || secret.trim() === '') {
    throw new Error(
      'Missing STRIPE_SECRET_KEY. Copy .env.example to .env.local and ' +
        'fill in your Stripe test-mode secret key (sk_test_...).',
    );
  }
  cached = new Stripe(secret, {
    // Pin the API version so SDK upgrades don't change behavior silently.
    // Bump deliberately and test when crossing a Stripe API version.
    // Current pin matches the installed SDK's default (Stripe.LatestApiVersion);
    // if you bump the `stripe` package, verify this constant still aligns.
    apiVersion: '2026-05-27.dahlia',
    typescript: true,
  });
  return cached;
}
