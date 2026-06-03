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
import type Stripe from 'stripe';
import { getStripe } from '@/lib/stripe';
import { getDraftById, markDraftConverted } from '@/db/drafts';
import { getOrderByStripeSessionId } from '@/db/orders';
import { createOrderFromDraft } from '@/lib/checkout/create-order';

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
    return NextResponse.json({ received: true, alreadyProcessed: true });
  }

  const order = await createOrderFromDraft({ draft, stripeSession: session });
  await markDraftConverted(draft.id, order.id);

  return NextResponse.json({ received: true, orderId: order.id });
}
