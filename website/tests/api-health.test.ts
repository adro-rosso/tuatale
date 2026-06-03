/**
 * /api/health unit tests.
 *
 * The route handler is exercised with vitest module mocks replacing
 * createServerClient and getStripe. We construct mock SupabaseClient and
 * Stripe instances that expose only the methods the handler calls
 * (auth.getSession and balance.retrieve respectively), then cast through
 * unknown to satisfy the strict TypeScript types of the real clients.
 *
 * Coverage:
 *   1. both legs healthy        → 200, ok=true
 *   2. supabase fails           → 503, supabase.error populated
 *   3. stripe fails             → 503, stripe.error populated
 *   4. both legs fail           → 503, both errors populated
 *   5. ?test_error=1            → throws (Sentry trigger preserved)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type Stripe from 'stripe';

vi.mock('@/lib/supabase', () => ({
  createServerClient: vi.fn(),
}));
vi.mock('@/lib/stripe', () => ({
  getStripe: vi.fn(),
}));

import { GET } from '@/app/api/health/route';
import { createServerClient } from '@/lib/supabase';
import { getStripe } from '@/lib/stripe';

const mockedSupabase = vi.mocked(createServerClient);
const mockedStripe = vi.mocked(getStripe);

function fakeRequest(query = ''): Request {
  return new Request(`http://localhost/api/health${query ? '?' + query : ''}`);
}

function supabaseStub(opts: { error?: string } = {}): SupabaseClient {
  const result = opts.error
    ? { data: { session: null }, error: { message: opts.error } }
    : { data: { session: null }, error: null };
  return {
    auth: {
      getSession: vi.fn().mockResolvedValue(result),
    },
  } as unknown as SupabaseClient;
}

function stripeStub(opts: { throws?: string } = {}): Stripe {
  return {
    balance: {
      retrieve: opts.throws
        ? vi.fn().mockRejectedValue(new Error(opts.throws))
        : vi.fn().mockResolvedValue({ available: [], pending: [] }),
    },
  } as unknown as Stripe;
}

describe('/api/health', () => {
  beforeEach(() => {
    mockedSupabase.mockReset();
    mockedStripe.mockReset();
  });

  it('both connected → 200 + ok:true + responseMs + ISO timestamp', async () => {
    mockedSupabase.mockReturnValue(supabaseStub());
    mockedStripe.mockReturnValue(stripeStub());

    const res = await GET(fakeRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.supabase.ok).toBe(true);
    expect(body.stripe.ok).toBe(true);
    expect(typeof body.supabase.responseMs).toBe('number');
    expect(body.supabase.responseMs).toBeGreaterThanOrEqual(0);
    expect(typeof body.stripe.responseMs).toBe('number');
    expect(body.stripe.responseMs).toBeGreaterThanOrEqual(0);
    expect(body.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it('supabase fails → 503 + ok:false + supabase.error populated', async () => {
    mockedSupabase.mockReturnValue(supabaseStub({ error: 'gotrue 500' }));
    mockedStripe.mockReturnValue(stripeStub());

    const res = await GET(fakeRequest());
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.supabase.ok).toBe(false);
    expect(body.supabase.error).toContain('gotrue 500');
    expect(body.stripe.ok).toBe(true);
  });

  it('stripe fails → 503 + ok:false + stripe.error populated', async () => {
    mockedSupabase.mockReturnValue(supabaseStub());
    mockedStripe.mockReturnValue(stripeStub({ throws: 'stripe network refused' }));

    const res = await GET(fakeRequest());
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.supabase.ok).toBe(true);
    expect(body.stripe.ok).toBe(false);
    expect(body.stripe.error).toContain('stripe network refused');
  });

  it('both fail → 503 + both errors populated', async () => {
    mockedSupabase.mockReturnValue(supabaseStub({ error: 'gotrue gone' }));
    mockedStripe.mockReturnValue(stripeStub({ throws: 'stripe gone' }));

    const res = await GET(fakeRequest());
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.supabase.ok).toBe(false);
    expect(body.supabase.error).toContain('gotrue gone');
    expect(body.stripe.ok).toBe(false);
    expect(body.stripe.error).toContain('stripe gone');
  });

  it('?test_error=1 → throws (Sentry trigger preserved)', async () => {
    mockedSupabase.mockReturnValue(supabaseStub());
    mockedStripe.mockReturnValue(stripeStub());

    await expect(GET(fakeRequest('test_error=1'))).rejects.toThrow(/sentry test/);
  });
});
