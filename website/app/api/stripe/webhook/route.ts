/**
 * Stripe webhook receiver.
 *
 * Stripe POSTs events here whenever something happens server-side.
 * Right now we care about exactly one event: checkout.session.completed,
 * which fires when a customer finishes paying. On that event we:
 *
 *   1. Verify the signature (cryptographic — without it we'd happily
 *      mint orders for any unauth POST)
 *   2. Look up the draft via the session's metadata.draft_id
 *   3. Idempotency-check by stripe_session_id (Stripe retries failed
 *      webhooks; we must not double-create orders)
 *   4. Snapshot draft → order
 *   5. Mark the draft as converted, linking to the order id
 *   6. Create pipeline_jobs row + dispatch Inngest event (Cycle A.3 —
 *      the bridge between the customer payment and the Track A
 *      pipeline runtime)
 *
 * Every non-event response is 200 with a payload describing why we
 * skipped — Stripe retries non-2xx responses, and we don't want to
 * retry indefinitely on application-level "draft not found" cases.
 * 400 is reserved for signature/transport-level rejections where a
 * retry has a chance of succeeding (e.g. our env was misconfigured).
 *
 * Routes in App Router that need to read raw bodies must NOT have the
 * body parsed automatically. App Router's `req.text()` returns the raw
 * UTF-8 body, which is what stripe.webhooks.constructEvent wants.
 */
import { NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import type Stripe from 'stripe';
import { getStripe } from '@/lib/stripe';
import { getDraftById, markDraftConverted } from '@/db/drafts';
import { getOrderByStripeSessionId } from '@/db/orders';
import * as pipelineJobs from '@/db/pipeline-jobs';
import { createOrderFromDraft, AdultBranchDisabledError } from '@/lib/checkout/create-order';
import { handleFailure } from '@/lib/recovery/recover-failed-order';
import { inngest } from '@/lib/inngest/client';
import type { Tables } from '@/types/database';

type OrderRow = Tables<'orders'>;
type PipelineJobRow = Tables<'pipeline_jobs'>;

/**
 * Best-effort: create the pipeline job + fire the Inngest event.
 *
 * Two failure modes, both fail-open (logged to Sentry but the webhook
 * still returns 200):
 *
 *   - createJob throws: the order exists and the draft is converted
 *     but no work will happen until manual admin intervention.
 *     Orphan visible in the admin dashboard (Cycle A.4).
 *
 *   - inngest.send throws: the job row exists in 'pending' state but
 *     no Inngest run is scheduled. Recoverable by a periodic sweeper
 *     (Cycle A.4 / A.5) that re-dispatches stuck pendings.
 *
 * We fail-open because returning non-2xx would make Stripe retry the
 * whole webhook — which would attempt duplicate order creation. The
 * orders unique constraint on stripe_session_id catches the duplicate
 * (createOrderFromDraft throws DatabaseError on the second attempt),
 * but the resulting Sentry noise would obscure the real underlying
 * failure (the dispatch problem).
 *
 * If a job already exists (idempotent re-entry after a prior webhook
 * delivery succeeded all the way through), this is a no-op.
 */
async function dispatchPipelineJob(
  order: OrderRow,
  sessionId: string,
): Promise<
  | { dispatch: 'requested'; job: PipelineJobRow }
  | { dispatch: 'idempotent-noop'; job: PipelineJobRow }
  | { dispatch: 'failed-orphan-needs-manual' }
  | { dispatch: 'failed-dispatch-job-pending'; job: PipelineJobRow }
> {
  // Belt-and-suspenders idempotency: the unique(order_id) index on
  // pipeline_jobs would catch a duplicate at insert time, but
  // pre-checking keeps the happy-path retry quiet — no exception
  // bubbling into the createJob catch + Sentry capture.
  const existingJob = await pipelineJobs.getJobByOrderId(order.id);
  if (existingJob) {
    return { dispatch: 'idempotent-noop', job: existingJob };
  }

  let job: PipelineJobRow;
  try {
    job = await pipelineJobs.createJob({ orderId: order.id });
  } catch (err) {
    Sentry.captureException(err, {
      tags: { component: 'stripe-webhook', failure: 'pipeline-job-create' },
      extra: { orderId: order.id, stripeSessionId: sessionId },
    });
    return { dispatch: 'failed-orphan-needs-manual' };
  }

  try {
    await inngest.send({
      name: 'pipeline/job.requested',
      data: { jobId: job.id, orderId: order.id },
    });
  } catch (err) {
    Sentry.captureException(err, {
      tags: { component: 'stripe-webhook', failure: 'inngest-dispatch' },
      extra: { jobId: job.id, orderId: order.id, stripeSessionId: sessionId },
    });
    return { dispatch: 'failed-dispatch-job-pending', job };
  }

  return { dispatch: 'requested', job };
}

// Force the route to run on Node runtime — the Stripe SDK's webhook
// signature verification uses Node crypto, which the Edge runtime
// doesn't fully support.
export const runtime = 'nodejs';

export async function POST(req: Request): Promise<NextResponse> {
  const body = await req.text();
  const signature = req.headers.get('stripe-signature');

  if (!signature) {
    return NextResponse.json({ error: 'Missing stripe-signature header' }, { status: 400 });
  }

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret || webhookSecret.trim() === '') {
    console.error('[stripe-webhook] STRIPE_WEBHOOK_SECRET not configured');
    return NextResponse.json({ error: 'Webhook secret not configured' }, { status: 500 });
  }

  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(body, signature, webhookSecret);
  } catch (err) {
    // Signature mismatch is the common case here. Log enough to debug
    // (without leaking the raw secret) but return 400 so Stripe retries.
    console.error('[stripe-webhook] signature verification failed:', err);
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  if (event.type !== 'checkout.session.completed') {
    // We don't subscribe to anything else, but if the webhook is
    // configured to send more events than we care about, ack and skip.
    return NextResponse.json({ received: true, ignored: event.type });
  }

  const session = event.data.object as Stripe.Checkout.Session;
  const draftId = session.metadata?.draft_id;

  if (!draftId) {
    // Without metadata we can't find the draft. Don't retry — log and ack.
    console.error('[stripe-webhook] event missing draft_id metadata', {
      sessionId: session.id,
    });
    return NextResponse.json({ received: true, error: 'missing_draft_id_metadata' });
  }

  const draft = await getDraftById(draftId);
  if (!draft) {
    console.error('[stripe-webhook] draft not found for completed checkout', {
      draftId,
      sessionId: session.id,
    });
    return NextResponse.json({ received: true, error: 'draft_not_found' });
  }

  // Idempotency. Stripe retries on non-2xx; same event hitting us
  // twice must not create two orders. The stripe_session_id unique
  // constraint on orders would catch it at the DB level anyway, but
  // checking here keeps the happy-path retry quiet.
  const existing = await getOrderByStripeSessionId(session.id);
  if (existing) {
    // Belt-and-suspenders reconciliation: if a previous attempt
    // created the order but failed before marking the draft, the
    // draft is still 'active'. Mark it now (no-op if already
    // converted, since markDraftConverted's WHERE id=... will just
    // update the same row to the same values).
    if (draft.status === 'active') {
      await markDraftConverted(draft.id, existing.id);
    }
    // Same reconciliation for pipeline_jobs: a prior attempt may
    // have died between createOrder and createJob. If so, finish
    // the job creation + dispatch now. dispatchPipelineJob is
    // idempotent — if the job already exists it returns
    // idempotent-noop without touching Inngest.
    const result = await dispatchPipelineJob(existing, session.id);
    return NextResponse.json({
      received: true,
      alreadyProcessed: true,
      pipelineDispatch: result.dispatch,
    });
  }

  let order;
  try {
    order = await createOrderFromDraft({ draft, stripeSession: session });
  } catch (err) {
    // LAYER 4: a charge succeeded but order creation was refused (adult branch OFF).
    // ORDER OF OPERATIONS is load-bearing: refund (idempotent) → alert → THEN 2xx.
    // Only acknowledge if the refund succeeded; otherwise return non-2xx so Stripe
    // RETRIES — the retry is our only recovery, and the idempotency key makes it safe.
    if (err instanceof AdultBranchDisabledError) {
      const result = await handleFailure({
        source: 'checkout',
        stripeSessionId: err.stripeSessionId,
        paymentIntentId: err.paymentIntentId,
        error: { message: 'adult branch disabled at order creation', kind: 'adult_branch_disabled' },
      });
      if (result.recovered) {
        return NextResponse.json({ received: true, chargedNoOrder: true, refunded: true, refundId: result.refundId });
      }
      // Refund did NOT succeed → do NOT acknowledge. Let Stripe retry (idempotency-safe).
      return NextResponse.json({ error: 'checkout recovery pending — refund not yet confirmed' }, { status: 500 });
    }
    throw err;
  }
  await markDraftConverted(draft.id, order.id);

  const result = await dispatchPipelineJob(order, session.id);

  return NextResponse.json({
    received: true,
    orderId: order.id,
    pipelineDispatch: result.dispatch,
    ...(result.dispatch === 'requested' || result.dispatch === 'idempotent-noop'
      ? { jobId: result.job.id }
      : {}),
  });
}
