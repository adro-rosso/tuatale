/**
 * Stripe webhook integration tests.
 *
 * Verifies:
 *   - Missing / invalid signatures get 400 (Stripe will retry — good)
 *   - Missing STRIPE_WEBHOOK_SECRET gets 500
 *   - checkout.session.completed creates an order via createOrderFromDraft
 *     and marks the draft converted
 *   - Idempotency: a second delivery of the same event ack's without
 *     re-creating the order
 *   - Missing-draft and missing-metadata cases ack with 200 (don't make
 *     Stripe retry forever)
 *   - Non-checkout event types ack without action
 *
 * Stripe's webhook signature is pure HMAC: we use the SDK's
 * generateTestHeaderString to forge valid signatures for these tests,
 * keyed off the same secret the route reads from process.env.
 * STRIPE_SECRET_KEY can be any string — the constructor doesn't
 * validate format, and webhook verification doesn't hit the API.
 */
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import Stripe from 'stripe';

const WEBHOOK_SECRET = 'whsec_test_dummy_secret';

const {
  getDraftByIdSpy,
  markDraftConvertedSpy,
  getOrderByStripeSessionIdSpy,
  createOrderFromDraftSpy,
} = vi.hoisted(() => ({
  getDraftByIdSpy: vi.fn(),
  markDraftConvertedSpy: vi.fn(),
  getOrderByStripeSessionIdSpy: vi.fn(),
  createOrderFromDraftSpy: vi.fn(),
}));

vi.mock('@/db/drafts', () => ({
  getDraftById: getDraftByIdSpy,
  markDraftConverted: markDraftConvertedSpy,
}));

vi.mock('@/db/orders', () => ({
  getOrderByStripeSessionId: getOrderByStripeSessionIdSpy,
}));

vi.mock('@/lib/checkout/create-order', () => ({
  createOrderFromDraft: createOrderFromDraftSpy,
}));

// Stripe SDK + webhook secret are imported live — getStripe constructs
// from STRIPE_SECRET_KEY (any string) and constructEvent verifies the
// signature using STRIPE_WEBHOOK_SECRET. Neither hits the network.
beforeAll(() => {
  process.env.STRIPE_SECRET_KEY = 'sk_test_dummy';
  process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;
});

import { POST } from '@/app/api/stripe/webhook/route';

function fakeCheckoutSessionCompletedEvent(
  overrides: {
    sessionId?: string;
    draftId?: string;
    email?: string;
    amountTotal?: number;
    metadata?: Record<string, string>;
  } = {},
) {
  const sessionId = overrides.sessionId ?? 'cs_test_abc123';
  return {
    id: 'evt_test_001',
    object: 'event',
    type: 'checkout.session.completed',
    api_version: '2026-05-27.dahlia',
    created: 1717000000,
    data: {
      object: {
        id: sessionId,
        object: 'checkout.session',
        amount_total: overrides.amountTotal ?? 7900,
        currency: 'aud',
        customer_email: null,
        customer_details: { email: overrides.email ?? 'parent@example.com' },
        payment_intent: 'pi_test_abc',
        created: 1717000000,
        metadata: overrides.metadata ?? {
          draft_id: overrides.draftId ?? 'draft-uuid-1',
          cookie_id: 'cookie-uuid-1',
        },
      },
    },
  };
}

function signedRequest(event: Record<string, unknown>, secret: string = WEBHOOK_SECRET): Request {
  const body = JSON.stringify(event);
  const stripe = new Stripe('sk_test_dummy', { apiVersion: '2026-05-27.dahlia', typescript: true });
  const signature = stripe.webhooks.generateTestHeaderString({ payload: body, secret });
  return new Request('http://localhost/api/stripe/webhook', {
    method: 'POST',
    body,
    headers: { 'stripe-signature': signature, 'content-type': 'application/json' },
  });
}

const activeDraft = {
  id: 'draft-uuid-1',
  status: 'active',
  child_name: 'Iris',
};

describe('Stripe webhook handler', () => {
  beforeEach(() => {
    getDraftByIdSpy.mockReset();
    markDraftConvertedSpy.mockReset();
    getOrderByStripeSessionIdSpy.mockReset();
    createOrderFromDraftSpy.mockReset();
  });

  it('returns 400 when stripe-signature header is missing', async () => {
    const event = fakeCheckoutSessionCompletedEvent();
    const req = new Request('http://localhost/api/stripe/webhook', {
      method: 'POST',
      body: JSON.stringify(event),
      headers: { 'content-type': 'application/json' },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/signature/i);
  });

  it('returns 400 when signature is invalid', async () => {
    const event = fakeCheckoutSessionCompletedEvent();
    // Sign with the wrong secret — route's verify rejects.
    const req = signedRequest(event, 'whsec_wrong_secret');
    const res = await POST(req);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/invalid signature/i);
  });

  it('returns 500 when STRIPE_WEBHOOK_SECRET is not configured', async () => {
    const original = process.env.STRIPE_WEBHOOK_SECRET;
    process.env.STRIPE_WEBHOOK_SECRET = '';
    try {
      const req = signedRequest(fakeCheckoutSessionCompletedEvent());
      const res = await POST(req);
      expect(res.status).toBe(500);
    } finally {
      process.env.STRIPE_WEBHOOK_SECRET = original;
    }
  });

  it('creates an order + marks draft converted on checkout.session.completed', async () => {
    getDraftByIdSpy.mockResolvedValue(activeDraft);
    getOrderByStripeSessionIdSpy.mockResolvedValue(null);
    createOrderFromDraftSpy.mockResolvedValue({ id: 'order-uuid-1' });

    const event = fakeCheckoutSessionCompletedEvent();
    const res = await POST(signedRequest(event));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.received).toBe(true);
    expect(body.orderId).toBe('order-uuid-1');
    expect(createOrderFromDraftSpy).toHaveBeenCalledTimes(1);
    expect(createOrderFromDraftSpy.mock.calls[0]![0]!.draft).toBe(activeDraft);
    expect(markDraftConvertedSpy).toHaveBeenCalledWith('draft-uuid-1', 'order-uuid-1');
  });

  it("idempotency: a second delivery of the same session ack's without re-creating", async () => {
    getDraftByIdSpy.mockResolvedValue({ ...activeDraft, status: 'converted' });
    getOrderByStripeSessionIdSpy.mockResolvedValue({ id: 'order-uuid-existing' });

    const res = await POST(signedRequest(fakeCheckoutSessionCompletedEvent()));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.alreadyProcessed).toBe(true);
    expect(createOrderFromDraftSpy).not.toHaveBeenCalled();
    // Draft already converted — markDraftConverted skipped.
    expect(markDraftConvertedSpy).not.toHaveBeenCalled();
  });

  it('reconciles when a prior attempt created the order but not the draft conversion', async () => {
    // Draft still 'active' (previous attempt didn't reach markDraftConverted).
    getDraftByIdSpy.mockResolvedValue(activeDraft);
    getOrderByStripeSessionIdSpy.mockResolvedValue({ id: 'order-uuid-existing' });

    const res = await POST(signedRequest(fakeCheckoutSessionCompletedEvent()));
    expect(res.status).toBe(200);
    expect((await res.json()).alreadyProcessed).toBe(true);
    expect(createOrderFromDraftSpy).not.toHaveBeenCalled();
    // The draft was 'active' so we DO mark it converted now.
    expect(markDraftConvertedSpy).toHaveBeenCalledWith('draft-uuid-1', 'order-uuid-existing');
  });

  it("ack's 200 (no retry) when event has no draft_id metadata", async () => {
    const event = fakeCheckoutSessionCompletedEvent({ metadata: {} });
    const res = await POST(signedRequest(event));
    expect(res.status).toBe(200);
    expect((await res.json()).error).toMatch(/missing_draft_id_metadata/);
    expect(getDraftByIdSpy).not.toHaveBeenCalled();
    expect(createOrderFromDraftSpy).not.toHaveBeenCalled();
  });

  it("ack's 200 (no retry) when the referenced draft is gone", async () => {
    getDraftByIdSpy.mockResolvedValue(null);
    const res = await POST(signedRequest(fakeCheckoutSessionCompletedEvent()));
    expect(res.status).toBe(200);
    expect((await res.json()).error).toMatch(/draft_not_found/);
    expect(createOrderFromDraftSpy).not.toHaveBeenCalled();
  });

  it('ignores non-checkout event types', async () => {
    const irrelevant = {
      id: 'evt_test_002',
      type: 'payment_intent.succeeded',
      api_version: '2026-05-27.dahlia',
      created: 1717000000,
      data: { object: { id: 'pi_test' } },
    };
    const res = await POST(signedRequest(irrelevant));
    expect(res.status).toBe(200);
    expect((await res.json()).ignored).toBe('payment_intent.succeeded');
    expect(getDraftByIdSpy).not.toHaveBeenCalled();
    expect(createOrderFromDraftSpy).not.toHaveBeenCalled();
  });
});
