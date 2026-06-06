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
  getJobByOrderIdSpy,
  createJobSpy,
  inngestSendSpy,
  sentryCaptureSpy,
} = vi.hoisted(() => ({
  getDraftByIdSpy: vi.fn(),
  markDraftConvertedSpy: vi.fn(),
  getOrderByStripeSessionIdSpy: vi.fn(),
  createOrderFromDraftSpy: vi.fn(),
  getJobByOrderIdSpy: vi.fn(),
  createJobSpy: vi.fn(),
  inngestSendSpy: vi.fn(),
  sentryCaptureSpy: vi.fn(),
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

vi.mock('@/db/pipeline-jobs', () => ({
  getJobByOrderId: getJobByOrderIdSpy,
  createJob: createJobSpy,
}));

vi.mock('@/lib/inngest/client', () => ({
  inngest: {
    send: inngestSendSpy,
  },
}));

vi.mock('@sentry/nextjs', () => ({
  captureException: sentryCaptureSpy,
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
    getJobByOrderIdSpy.mockReset();
    createJobSpy.mockReset();
    inngestSendSpy.mockReset();
    sentryCaptureSpy.mockReset();
    // Default: no existing job, createJob succeeds, dispatch succeeds.
    // Individual tests override to exercise failure paths.
    getJobByOrderIdSpy.mockResolvedValue(null);
    createJobSpy.mockResolvedValue({
      id: 'job-uuid-1',
      order_id: 'order-uuid-1',
      status: 'pending',
    });
    inngestSendSpy.mockResolvedValue({ ids: ['evt_test_123'] });
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

  it('creates an order + marks draft converted + creates pipeline job + dispatches Inngest event', async () => {
    getDraftByIdSpy.mockResolvedValue(activeDraft);
    getOrderByStripeSessionIdSpy.mockResolvedValue(null);
    createOrderFromDraftSpy.mockResolvedValue({ id: 'order-uuid-1' });

    const event = fakeCheckoutSessionCompletedEvent();
    const res = await POST(signedRequest(event));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.received).toBe(true);
    expect(body.orderId).toBe('order-uuid-1');
    expect(body.pipelineDispatch).toBe('requested');
    expect(body.jobId).toBe('job-uuid-1');
    expect(createOrderFromDraftSpy).toHaveBeenCalledTimes(1);
    expect(createOrderFromDraftSpy.mock.calls[0]![0]!.draft).toBe(activeDraft);
    expect(markDraftConvertedSpy).toHaveBeenCalledWith('draft-uuid-1', 'order-uuid-1');
    // Pipeline job created for the new order.
    expect(createJobSpy).toHaveBeenCalledWith({ orderId: 'order-uuid-1' });
    // Inngest event fired with the right payload.
    expect(inngestSendSpy).toHaveBeenCalledWith({
      name: 'pipeline/job.requested',
      data: { jobId: 'job-uuid-1', orderId: 'order-uuid-1' },
    });
    expect(sentryCaptureSpy).not.toHaveBeenCalled();
  });

  it("idempotency: a second delivery of the same session ack's without re-creating order OR job", async () => {
    getDraftByIdSpy.mockResolvedValue({ ...activeDraft, status: 'converted' });
    getOrderByStripeSessionIdSpy.mockResolvedValue({ id: 'order-uuid-existing' });
    // Existing job exists too — fully idempotent re-entry.
    getJobByOrderIdSpy.mockResolvedValue({
      id: 'job-uuid-existing',
      order_id: 'order-uuid-existing',
      status: 'pending',
    });

    const res = await POST(signedRequest(fakeCheckoutSessionCompletedEvent()));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.alreadyProcessed).toBe(true);
    expect(body.pipelineDispatch).toBe('idempotent-noop');
    expect(createOrderFromDraftSpy).not.toHaveBeenCalled();
    // Draft already converted — markDraftConverted skipped.
    expect(markDraftConvertedSpy).not.toHaveBeenCalled();
    // Job already exists — createJob + Inngest dispatch skipped.
    expect(createJobSpy).not.toHaveBeenCalled();
    expect(inngestSendSpy).not.toHaveBeenCalled();
  });

  it('reconciles when a prior attempt created the order but not the draft conversion + dispatches missing job', async () => {
    // Draft still 'active' AND no pipeline job yet (previous attempt
    // died before either reached). Resume both downstream steps.
    getDraftByIdSpy.mockResolvedValue(activeDraft);
    getOrderByStripeSessionIdSpy.mockResolvedValue({ id: 'order-uuid-existing' });
    getJobByOrderIdSpy.mockResolvedValue(null);
    createJobSpy.mockResolvedValue({
      id: 'job-uuid-reconciled',
      order_id: 'order-uuid-existing',
      status: 'pending',
    });

    const res = await POST(signedRequest(fakeCheckoutSessionCompletedEvent()));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.alreadyProcessed).toBe(true);
    expect(body.pipelineDispatch).toBe('requested');
    expect(createOrderFromDraftSpy).not.toHaveBeenCalled();
    // The draft was 'active' so we DO mark it converted now.
    expect(markDraftConvertedSpy).toHaveBeenCalledWith('draft-uuid-1', 'order-uuid-existing');
    // Reconciliation creates the missing job + dispatches Inngest.
    expect(createJobSpy).toHaveBeenCalledWith({ orderId: 'order-uuid-existing' });
    expect(inngestSendSpy).toHaveBeenCalledWith({
      name: 'pipeline/job.requested',
      data: { jobId: 'job-uuid-reconciled', orderId: 'order-uuid-existing' },
    });
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
    expect(createJobSpy).not.toHaveBeenCalled();
    expect(inngestSendSpy).not.toHaveBeenCalled();
  });

  it('fail-open on createJob failure: 200 + Sentry capture + orphan response', async () => {
    getDraftByIdSpy.mockResolvedValue(activeDraft);
    getOrderByStripeSessionIdSpy.mockResolvedValue(null);
    createOrderFromDraftSpy.mockResolvedValue({ id: 'order-uuid-1' });
    const dbErr = new Error('FK violation: order does not exist');
    createJobSpy.mockRejectedValue(dbErr);

    const res = await POST(signedRequest(fakeCheckoutSessionCompletedEvent()));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.received).toBe(true);
    expect(body.orderId).toBe('order-uuid-1');
    expect(body.pipelineDispatch).toBe('failed-orphan-needs-manual');
    expect(body.jobId).toBeUndefined();
    // Inngest dispatch skipped because there's no job to point at.
    expect(inngestSendSpy).not.toHaveBeenCalled();
    // Sentry captured with the right tags + extras for admin triage.
    expect(sentryCaptureSpy).toHaveBeenCalledWith(
      dbErr,
      expect.objectContaining({
        tags: expect.objectContaining({
          component: 'stripe-webhook',
          failure: 'pipeline-job-create',
        }),
        extra: expect.objectContaining({
          orderId: 'order-uuid-1',
          stripeSessionId: 'cs_test_abc123',
        }),
      }),
    );
  });

  it('fail-open on Inngest dispatch failure: 200 + Sentry capture + job still pending', async () => {
    getDraftByIdSpy.mockResolvedValue(activeDraft);
    getOrderByStripeSessionIdSpy.mockResolvedValue(null);
    createOrderFromDraftSpy.mockResolvedValue({ id: 'order-uuid-1' });
    const dispatchErr = new Error('Inngest API unreachable');
    inngestSendSpy.mockRejectedValue(dispatchErr);

    const res = await POST(signedRequest(fakeCheckoutSessionCompletedEvent()));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.received).toBe(true);
    expect(body.orderId).toBe('order-uuid-1');
    expect(body.pipelineDispatch).toBe('failed-dispatch-job-pending');
    // Job WAS created (Cycle A.4+ sweeper picks it up later).
    expect(createJobSpy).toHaveBeenCalledWith({ orderId: 'order-uuid-1' });
    expect(sentryCaptureSpy).toHaveBeenCalledWith(
      dispatchErr,
      expect.objectContaining({
        tags: expect.objectContaining({
          component: 'stripe-webhook',
          failure: 'inngest-dispatch',
        }),
        extra: expect.objectContaining({
          jobId: 'job-uuid-1',
          orderId: 'order-uuid-1',
        }),
      }),
    );
  });
});
