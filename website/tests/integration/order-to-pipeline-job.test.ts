/**
 * End-to-end integration: Stripe webhook -> draft -> order ->
 * pipeline_job -> Inngest dispatch.
 *
 * What this catches that mocked tests miss:
 *   - FK ordering bugs (pipeline_jobs.order_id references orders.id)
 *   - jsonb shape mismatches when draft.secondaries copies into order
 *   - CHECK-constraint surprises on the order insert that the mocked
 *     createOrderFromDraft wouldn't see
 *   - Status sequence: draft 'active' -> 'converted', job at 'pending'
 *
 * Inngest is mocked. We don't fire real events from CI/local — the
 * actual cloud dispatch is exercised in production smoke (the Cycle
 * A.3 Adro task). The test asserts inngest.send was called with the
 * right payload, which is the contract our code actually owns.
 *
 * Skips entirely when TEST_SUPABASE_URL is not set (CI default).
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import Stripe from 'stripe';

const { inngestSendSpy, sentryCaptureSpy } = vi.hoisted(() => ({
  inngestSendSpy: vi.fn(),
  sentryCaptureSpy: vi.fn(),
}));

vi.mock('@/lib/inngest/client', () => ({
  inngest: { send: inngestSendSpy },
}));

vi.mock('@sentry/nextjs', () => ({
  captureException: sentryCaptureSpy,
}));

// Route the supabase server client at the tuatale-test project so
// the webhook's DB calls land in the integration-test database, not
// production.
vi.mock('@/lib/supabase', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/supabase')>();
  const { createClient } = await import('@supabase/supabase-js');
  return {
    ...actual,
    createServerClient: () => {
      const url = process.env.TEST_SUPABASE_URL;
      const key = process.env.TEST_SUPABASE_SERVICE_ROLE_KEY;
      if (!url || !key) {
        throw new Error('TEST_SUPABASE_* env vars not set in mock factory');
      }
      return createClient(url, key, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
    },
  };
});

const WEBHOOK_SECRET = 'whsec_test_dummy_secret';

beforeAll(() => {
  process.env.STRIPE_SECRET_KEY = 'sk_test_dummy';
  process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;
});

import { POST } from '@/app/api/stripe/webhook/route';
import { createDraft, getDraftById, updateDraft } from '@/db/drafts';
import { getOrderByStripeSessionId } from '@/db/orders';
import { getJobByOrderId } from '@/db/pipeline-jobs';
import {
  createTestClient,
  freshUuid,
  shouldSkipIntegrationTests,
  truncateAll,
} from '../db/helpers';
import type { TuataleSupabaseClient } from '@/lib/supabase';

interface FakeEventOpts {
  sessionId: string;
  draftId: string;
  cookieId: string;
  email?: string;
  amountTotal?: number;
}

function fakeCheckoutSessionCompletedEvent(opts: FakeEventOpts) {
  return {
    id: 'evt_test_integration',
    object: 'event',
    type: 'checkout.session.completed',
    api_version: '2026-05-27.dahlia',
    created: Math.floor(new Date('2026-06-06T00:00:00Z').getTime() / 1000),
    data: {
      object: {
        id: opts.sessionId,
        object: 'checkout.session',
        amount_total: opts.amountTotal ?? 7900,
        currency: 'aud',
        customer_email: null,
        customer_details: { email: opts.email ?? 'parent@example.com' },
        payment_intent: `pi_test_${opts.sessionId.slice(-8)}`,
        created: Math.floor(new Date('2026-06-06T00:00:00Z').getTime() / 1000),
        metadata: {
          draft_id: opts.draftId,
          cookie_id: opts.cookieId,
        },
      },
    },
  };
}

function signedRequest(event: Record<string, unknown>): Request {
  const body = JSON.stringify(event);
  const stripe = new Stripe('sk_test_dummy', {
    apiVersion: '2026-05-27.dahlia',
    typescript: true,
  });
  const signature = stripe.webhooks.generateTestHeaderString({
    payload: body,
    secret: WEBHOOK_SECRET,
  });
  return new Request('http://localhost/api/stripe/webhook', {
    method: 'POST',
    body,
    headers: { 'stripe-signature': signature, 'content-type': 'application/json' },
  });
}

const skipSuite = shouldSkipIntegrationTests();
const describeIntegration = skipSuite ? describe.skip : describe;

describeIntegration('full draft -> order -> pipeline_job flow', () => {
  let client: TuataleSupabaseClient;

  beforeAll(() => {
    client = createTestClient();
  });

  beforeEach(async () => {
    await truncateAll(client);
    inngestSendSpy.mockReset();
    sentryCaptureSpy.mockReset();
    inngestSendSpy.mockResolvedValue({ ids: ['evt_integration_123'] });
  });

  it('happy path: a paid checkout produces an order, converted draft, and a pending pipeline job', async () => {
    // Set up a real, fully-populated draft in the test DB.
    const cookieId = freshUuid();
    const draft = await createDraft(cookieId, client);
    await updateDraft(
      draft.id,
      {
        child_name: 'Iris',
        age_range: '5-7',
        child_gender: 'girl',
        child_appearance:
          'Iris has curly brown hair just past her shoulders, brown eyes, and a small gap between her two front teeth.',
        theme: 'Iris discovers a tiny door at the back of the garden shed.',
        current_step: 'payment',
      },
      client,
    );

    const sessionId = `cs_test_${freshUuid().slice(0, 12)}`;
    const event = fakeCheckoutSessionCompletedEvent({
      sessionId,
      draftId: draft.id,
      cookieId,
    });

    const res = await POST(signedRequest(event));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.received).toBe(true);
    expect(body.pipelineDispatch).toBe('requested');
    expect(body.orderId).toBeDefined();
    expect(body.jobId).toBeDefined();

    // Order row exists with the draft's snapshot fields.
    const order = await getOrderByStripeSessionId(sessionId, client);
    expect(order).not.toBeNull();
    expect(order!.id).toBe(body.orderId);
    expect(order!.child_name).toBe('Iris');
    expect(order!.age_range).toBe('5-7');
    // child_age derived from age_range midpoint (Phase 2.E mapping).
    expect(order!.child_age).toBe(6);
    expect(order!.customer_email).toBe('parent@example.com');
    expect(order!.stripe_session_id).toBe(sessionId);
    expect(order!.converted_from_draft_id).toBe(draft.id);

    // Draft transitioned to converted, pointing at the order.
    const convertedDraft = await getDraftById(draft.id, client);
    expect(convertedDraft).not.toBeNull();
    expect(convertedDraft!.status).toBe('converted');
    expect(convertedDraft!.converted_to_order_id).toBe(order!.id);

    // Pipeline job exists, FK'd to the order, in 'pending'.
    const job = await getJobByOrderId(order!.id, client);
    expect(job).not.toBeNull();
    expect(job!.id).toBe(body.jobId);
    expect(job!.order_id).toBe(order!.id);
    expect(job!.status).toBe('pending');
    expect(job!.attempt_count).toBe(0);
    expect(job!.pdf_url).toBeNull();

    // Inngest dispatched with the correct payload.
    expect(inngestSendSpy).toHaveBeenCalledTimes(1);
    expect(inngestSendSpy).toHaveBeenCalledWith({
      name: 'pipeline/job.requested',
      data: { jobId: job!.id, orderId: order!.id },
    });
    expect(sentryCaptureSpy).not.toHaveBeenCalled();
  });

  it('idempotency: re-delivering the same session creates no extra rows + reports idempotent-noop', async () => {
    const cookieId = freshUuid();
    const draft = await createDraft(cookieId, client);
    await updateDraft(
      draft.id,
      {
        child_name: 'Beatrix',
        age_range: '7-9',
        child_gender: 'girl',
        child_appearance:
          'Beatrix is nine, taller than Iris, with the same brown hair but kept in a long ponytail. She always wears a navy hoodie.',
        theme:
          'Beatrix has been quietly noticing the cat next door for weeks, and today is the day she finally meets him.',
        current_step: 'payment',
      },
      client,
    );

    const sessionId = `cs_test_${freshUuid().slice(0, 12)}`;
    const event = fakeCheckoutSessionCompletedEvent({
      sessionId,
      draftId: draft.id,
      cookieId,
    });

    // First delivery — fully succeeds.
    const res1 = await POST(signedRequest(event));
    expect(res1.status).toBe(200);
    const body1 = await res1.json();
    expect(body1.pipelineDispatch).toBe('requested');

    // Second delivery — same session. Should be idempotent: same
    // order, same job, no extra Inngest send.
    inngestSendSpy.mockClear();
    const res2 = await POST(signedRequest(event));
    expect(res2.status).toBe(200);
    const body2 = await res2.json();
    expect(body2.alreadyProcessed).toBe(true);
    expect(body2.pipelineDispatch).toBe('idempotent-noop');

    // Inngest NOT re-sent on the idempotent retry.
    expect(inngestSendSpy).not.toHaveBeenCalled();

    // Single order, single job in the DB.
    const order = await getOrderByStripeSessionId(sessionId, client);
    expect(order).not.toBeNull();
    const job = await getJobByOrderId(order!.id, client);
    expect(job).not.toBeNull();
  });

  it('reconciliation: existing order without a job has its job created on the next delivery', async () => {
    // Simulate the prior-attempt-died-mid-flow state: order +
    // converted draft already exist, no pipeline_job row yet.
    const cookieId = freshUuid();
    const draft = await createDraft(cookieId, client);
    await updateDraft(
      draft.id,
      {
        child_name: 'Iris',
        age_range: '5-7',
        child_gender: 'girl',
        child_appearance:
          'Iris has curly brown hair just past her shoulders, brown eyes, and a small gap between her two front teeth.',
        theme: 'Iris discovers a tiny door at the back of the garden shed.',
        current_step: 'payment',
      },
      client,
    );

    const sessionId = `cs_test_${freshUuid().slice(0, 12)}`;
    const event = fakeCheckoutSessionCompletedEvent({
      sessionId,
      draftId: draft.id,
      cookieId,
    });

    // First delivery — succeed all the way, creating order + draft
    // converted + job. We then DELETE the job to simulate the
    // pre-Cycle-A.3 state where the order existed but no job did.
    const res1 = await POST(signedRequest(event));
    expect(res1.status).toBe(200);
    const order = await getOrderByStripeSessionId(sessionId, client);
    expect(order).not.toBeNull();
    await client.from('pipeline_jobs').delete().eq('order_id', order!.id);
    expect(await getJobByOrderId(order!.id, client)).toBeNull();

    // Second delivery — should reconcile and create the missing
    // job, re-dispatching Inngest.
    inngestSendSpy.mockClear();
    const res2 = await POST(signedRequest(event));
    expect(res2.status).toBe(200);
    const body2 = await res2.json();
    expect(body2.alreadyProcessed).toBe(true);
    expect(body2.pipelineDispatch).toBe('requested');

    // Job now exists.
    const job = await getJobByOrderId(order!.id, client);
    expect(job).not.toBeNull();
    expect(job!.status).toBe('pending');
    expect(inngestSendSpy).toHaveBeenCalledWith({
      name: 'pipeline/job.requested',
      data: { jobId: job!.id, orderId: order!.id },
    });
  });
});
