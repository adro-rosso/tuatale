/**
 * GET /api/health — wiring smoke test.
 *
 * Returns { ok, supabase, stripe } where each leg is 'connected' if the
 * client constructs without error or 'error' if construction throws
 * (typically because env vars are missing). Phase 1 verifies wiring,
 * not actual connectivity — no real queries against Supabase or Stripe.
 *
 * Query-param trigger for Sentry verification (Part 7):
 *   GET /api/health?test_error=1  -> throws so Sentry captures it.
 *
 * Cached: no — health changes per-request as env / dependencies shift.
 */
import { createServerClient } from '@/lib/supabase';
import { getStripe } from '@/lib/stripe';

export const dynamic = 'force-dynamic';

type LegStatus = 'connected' | 'error' | 'not_configured';

interface HealthResponse {
  ok: boolean;
  supabase: LegStatus;
  stripe: LegStatus;
}

function probeLeg(probe: () => void): LegStatus {
  try {
    probe();
    return 'connected';
  } catch (err) {
    // 'not_configured' if the env var was missing entirely;
    // 'error' if construction failed for any other reason.
    const message = err instanceof Error ? err.message : String(err);
    return message.includes('Missing required environment variable') ||
      message.includes('Missing STRIPE_SECRET_KEY')
      ? 'not_configured'
      : 'error';
  }
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  if (url.searchParams.get('test_error') === '1') {
    // Sentry verification trigger — Phase 1 Part 7. Triggered manually,
    // not by any normal traffic. Once Sentry confirms capture, this stays
    // as a permanent on-demand health-of-error-tracking check.
    throw new Error('sentry test (deliberate /api/health?test_error=1)');
  }

  const supabase = probeLeg(() => {
    createServerClient();
  });
  const stripe = probeLeg(() => {
    getStripe();
  });

  const body: HealthResponse = {
    ok: supabase === 'connected' && stripe === 'connected',
    supabase,
    stripe,
  };
  return Response.json(body, { status: body.ok ? 200 : 503 });
}
