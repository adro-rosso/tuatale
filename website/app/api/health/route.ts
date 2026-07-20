/**
 * GET /api/health — real connectivity check.
 *
 * Each leg actually pings its upstream and measures latency:
 *   - Supabase: client.auth.getSession() — hits the gotrue auth endpoint.
 *     No table or RPC required, so this works on a brand-new project with
 *     no schema. Returns immediately on a healthy server.
 *   - Stripe:   stripe.balance.retrieve() — read-only call to the test-mode
 *     account, no side effects, lightweight.
 *
 * Each leg has a 5-second timeout enforced via Promise.race — a wedged
 * upstream returns an `error` leg instead of hanging the route.
 *
 * Response shape:
 *   { ok, supabase: {ok, responseMs} | {ok:false, error, responseMs},
 *           stripe: {ok, responseMs} | {ok:false, error, responseMs},
 *     timestamp }
 *
 * Status 200 when both legs OK, 503 when either fails (the right code for
 * a health check signaling that downstream services are degraded).
 *
 * The ?test_error=1 trigger throws an uncaught error so Sentry's
 * captureRequestError (wired in instrumentation.ts) can capture it. This
 * URL is meant for manual on-demand checking; no normal traffic hits it.
 */
import { createServerClient } from '@/lib/supabase';
import { getStripe } from '@/lib/stripe';

export const dynamic = 'force-dynamic';

const PROBE_TIMEOUT_MS = 5000;

type LegStatus =
  | { ok: true; responseMs: number }
  | { ok: false; error: string; responseMs: number };

interface HealthResponse {
  ok: boolean;
  supabase: LegStatus;
  stripe: LegStatus;
  /** Which server-only secrets the RUNNING deployment can actually see. */
  config: Record<string, boolean>;
  /** Commit SHA of the running build, so "did my redeploy land?" is answerable. */
  version: string;
  timestamp: string;
}

/**
 * Presence-only view of the secrets whose absence silently disables a feature.
 * BOOLEANS ONLY — never a value, never a prefix, never a length. Mirrors the
 * worker's /health flag block, and exists because a missing CRON_SECRET is
 * otherwise indistinguishable from a failed redeploy from outside the box:
 * the reap route just 500s either way.
 */
function configFlags(): Record<string, boolean> {
  const set = (v: string | undefined) => Boolean(v && v.trim() !== '');
  return {
    CRON_SECRET: set(process.env.CRON_SECRET),
    INTERNAL_RECOVERY_SECRET: set(process.env.INTERNAL_RECOVERY_SECRET),
  };
}

/**
 * Race a promise against a timeout. If the timeout wins, throws with a
 * descriptive message. Either way, clears the timer so the test runner
 * (and production) don't leak handles.
 */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} probe timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

async function probeSupabase(): Promise<LegStatus> {
  const start = Date.now();
  try {
    const client = createServerClient();
    const { error } = await withTimeout(client.auth.getSession(), PROBE_TIMEOUT_MS, 'supabase');
    const responseMs = Date.now() - start;
    if (error) {
      return { ok: false, error: error.message, responseMs };
    }
    return { ok: true, responseMs };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
      responseMs: Date.now() - start,
    };
  }
}

async function probeStripe(): Promise<LegStatus> {
  const start = Date.now();
  try {
    const stripe = getStripe();
    await withTimeout(stripe.balance.retrieve(), PROBE_TIMEOUT_MS, 'stripe');
    return { ok: true, responseMs: Date.now() - start };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
      responseMs: Date.now() - start,
    };
  }
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  if (url.searchParams.get('test_error') === '1') {
    // Sentry verification trigger. Captured by Sentry.captureRequestError
    // wired in instrumentation.ts; surfaces in the Sentry dashboard
    // as an uncaught error with this message.
    throw new Error('sentry test (deliberate /api/health?test_error=1)');
  }

  // Probe both legs in parallel so total response time is bounded by the
  // slower leg, not the sum. Promise.all returns when both have resolved
  // (success OR captured error — neither probe throws to this level).
  const [supabase, stripe] = await Promise.all([probeSupabase(), probeStripe()]);

  const body: HealthResponse = {
    ok: supabase.ok && stripe.ok,
    supabase,
    stripe,
    config: configFlags(),
    version: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? 'local',
    timestamp: new Date().toISOString(),
  };
  return Response.json(body, { status: body.ok ? 200 : 503 });
}
