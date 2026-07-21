/**
 * R2 — terminal-failure recovery fan-out.
 *
 * Triggered by the worker's onFailure (via /api/internal/recover) once a job has
 * exhausted retries. ONE entry point fans out two directions:
 *
 *   B. OPS-ALERT (every failure, paid OR preview): admin email; RESOURCE_EXHAUSTED
 *      is flagged as a distinct "credits depleted" alert.
 *   A. CUSTOMER-RECOVERY (paid orders only): Stripe refund → customer "snag +
 *      refund" email → sync orders.pipeline_status='failed' (the first real caller
 *      of updateOrderPipelineStatus) with a recovery marker written into
 *      pipeline_error.recovery.
 *
 * IDEMPOTENT: for a paid order, if pipeline_error.recovery is already set (a prior
 * fire — Inngest retries / a re-trigger), the whole fan-out is skipped: no double
 * refund, no double email. Belt-and-suspenders, the Stripe refund also uses a
 * deterministic idempotency key so even a racing double-call can't double-refund.
 *
 * Preview failures carry no charge → B only, never A. (No dedupe state for previews;
 * preview retries:1 so at most ~2 alerts, and the credit-depletion flag is the value.)
 *
 * All collaborators are injectable (deps) for testing; production uses the real
 * Stripe / Resend / orders helpers — the same plumbing the ship path uses.
 */
import { getOrderById as realGetOrderById, updateOrderPipelineStatus as realUpdateOrderPipelineStatus } from '@/db/orders';
import { getStripe as realGetStripe } from '@/lib/stripe';
import { sendEmail as realSendEmail } from '@/lib/email/send';
import { buildCustomerFailureEmail, buildOpsAlertEmail } from '@/lib/email/templates/failure';

export interface FailureInput {
  source: 'order' | 'preview' | 'health' | 'checkout';
  /** source='health' only: which synthetic check reported (e.g. 'gemini'). */
  check?: string;
  /** source='health' only: 'went_down' | 'still_down' | 'recovered'. */
  transition?: string;
  /** source='health' only: the probe's verdict. */
  healthy?: boolean;
  orderId?: string;
  previewId?: string;
  jobId?: string;
  /**
   * source='checkout' only: a payment SUCCEEDED but order creation was refused
   * (e.g. the adult branch is gated OFF on unmigrated prod). The customer is charged
   * with no order, so this ALWAYS refunds (terminal + unambiguous) AND alerts. Keyed
   * on the payment_intent, since no order id exists.
   */
  stripeSessionId?: string;
  paymentIntentId?: string | null;
  error: { message?: string; kind?: string };
  /**
   * R3c: the worker's resume controller sets this. true = the failure is TERMINAL
   * (resume exhausted / deterministic) → run customer-recovery (refund + email).
   * false/undefined = transient (resumable or credit-parked) → ops-alert ONLY; the
   * job will resume, so we must NOT refund a book that may still complete.
   */
  terminal?: boolean;
}

export interface RecoveryDeps {
  getOrderById?: typeof realGetOrderById;
  updateOrderPipelineStatus?: typeof realUpdateOrderPipelineStatus;
  getStripe?: typeof realGetStripe;
  sendEmail?: typeof realSendEmail;
  adminEmail?: string;
  now?: () => string;
}

export interface RecoveryResult {
  source: 'order' | 'preview' | 'health' | 'checkout';
  alerted: boolean;
  creditDepleted: boolean;
  recovered: boolean;
  refundId: string | null;
  skipped?: 'already-recovered';
  /** R3c: a non-terminal (resumable/parked) order failure — alerted, recovery deferred. */
  deferred?: 'non-terminal';
}

// Matches BOTH vocabularies: the raw provider error surfaced by a failed job
// (RESOURCE_EXHAUSTED / quota / "prepayment credits are depleted"), and the credit
// monitor's own classified reason (`credits_depleted`). Missing the latter meant a
// real depletion alert arrived WITHOUT the "CREDITS DEPLETED" banner — i.e. the one
// alert whose whole value is telling the operator to top up looked like a generic
// failure. Caught by the health-branch tests, 2026-07-20.
const CREDIT_RE = /RESOURCE_EXHAUSTED|exceeded your current quota|insufficient|quota|credits?[ _-]?(are[ _-]?)?depleted/i;

function isCreditDepletion(error: { message?: string; kind?: string }): boolean {
  return CREDIT_RE.test(`${error?.message ?? ''} ${error?.kind ?? ''}`);
}

export async function handleFailure(input: FailureInput, deps: RecoveryDeps = {}): Promise<RecoveryResult> {
  const {
    getOrderById = realGetOrderById,
    updateOrderPipelineStatus = realUpdateOrderPipelineStatus,
    getStripe = realGetStripe,
    sendEmail = realSendEmail,
    adminEmail = process.env.ADMIN_EMAIL,
    now = () => new Date().toISOString(),
  } = deps;

  const creditDepleted = isCreditDepletion(input.error);
  const reason = input.error?.message || input.error?.kind || 'unknown failure';

  // ---- HEALTH: a synthetic monitor, not a customer failure. ----
  // No order, no preview, nothing to refund — ops-alert ONLY. Exists so the credit
  // monitor can reach ops through the SAME path (and the same "CREDITS DEPLETED"
  // flag) as a real job failure, rather than growing a second alerting mechanism
  // that could rot untested.
  if (input.source === 'health') {
    const label = input.check ?? 'health';
    const alerted = await alertOps({
      adminEmail,
      source: 'health',
      reference: `${label} (${input.transition ?? 'check'})`,
      reason,
      // A recovery notice must NOT carry the depletion banner.
      creditDepleted: creditDepleted && input.healthy !== true,
      sendEmail,
    });
    return { source: 'health', alerted, creditDepleted, recovered: false, refundId: null };
  }

  // ---- CHECKOUT: a charge succeeded but order creation was refused. ----
  // Terminal + unambiguous (no book can be made), so it ALWAYS refunds AND alerts —
  // no `terminal` gate, unlike 'order'. Refund is IDEMPOTENT (Stripe idempotency key
  // on the payment_intent): the webhook retries, and a retry after a successful refund
  // must not double-refund. Ordering is the CALLER's responsibility — it must refund →
  // alert → only THEN acknowledge; if recovered is false, it must let Stripe retry.
  if (input.source === 'checkout') {
    const refundId = await refundByPaymentIntent(
      { paymentIntentId: input.paymentIntentId ?? null, stripeSessionId: input.stripeSessionId },
      getStripe,
    );
    const alerted = await alertOps({
      adminEmail,
      source: 'checkout',
      reference: input.stripeSessionId ?? input.paymentIntentId ?? 'unknown',
      reason: `CHARGED, NO ORDER — ${reason}. ${refundId ? `Auto-refunded (${refundId}).` : 'REFUND FAILED — refund manually.'}`,
      creditDepleted: false,
      sendEmail,
    });
    return { source: 'checkout', alerted, creditDepleted: false, recovered: Boolean(refundId), refundId };
  }

  // ---- PREVIEW: ops-alert only, no customer recovery. ----
  if (input.source === 'preview') {
    const alerted = await alertOps({ adminEmail, source: 'preview', reference: input.previewId ?? 'unknown', reason, creditDepleted, sendEmail });
    return { source: 'preview', alerted, creditDepleted, recovered: false, refundId: null };
  }

  // ---- ORDER (paid). ----
  if (!input.orderId) throw new Error('handleFailure: source=order requires orderId');

  // B. ops-alert ALWAYS — every failure, terminal or not (ops must never be blind).
  const alerted = await alertOps({ adminEmail, source: 'order', reference: input.orderId, reason, creditDepleted, sendEmail });

  // R3c: customer-recovery (refund + email + 'failed' status) ONLY when TERMINAL.
  // A transient failure (resumable / credit-parked) will resume — refunding a book
  // that may still complete would be wrong. Leave orders.pipeline_status untouched
  // (still in-progress); the worker's resume cron carries the job.
  if (!input.terminal) {
    return { source: 'order', alerted, creditDepleted, recovered: false, refundId: null, deferred: 'non-terminal' };
  }

  // A. TERMINAL → idempotent refund → customer email → 'failed' status + recovery marker.
  const order = await getOrderById(input.orderId);
  if (!order) throw new Error(`handleFailure: order ${input.orderId} not found`);

  const existingError = (order.pipeline_error ?? {}) as Record<string, unknown>;
  if (existingError.recovery) {
    // Already recovered on a prior fire — don't double-refund/email.
    return { source: 'order', alerted, creditDepleted, recovered: false, refundId: null, skipped: 'already-recovered' };
  }

  const refundId = await issueRefund(order, getStripe);
  await sendEmail(
    buildCustomerFailureEmail({
      customerEmail: order.customer_email,
      childName: order.child_name,
      orderId: order.id,
      refunded: Boolean(refundId),
    }),
  );
  const recoveredAt = now();
  await updateOrderPipelineStatus(order.id, {
    pipeline_status: 'failed',
    pipeline_completed_at: recoveredAt,
    pipeline_error: {
      ...existingError,
      message: reason,
      kind: input.error?.kind ?? null,
      recovery: { recovered_at: recoveredAt, refund_id: refundId, refunded: Boolean(refundId), notified: true },
    } as never,
  });

  return { source: 'order', alerted, creditDepleted, recovered: true, refundId };
}

async function alertOps(args: {
  adminEmail: string | undefined;
  source: 'order' | 'preview' | 'health' | 'checkout';
  reference: string;
  reason: string;
  creditDepleted: boolean;
  sendEmail: typeof realSendEmail;
}): Promise<boolean> {
  if (!args.adminEmail) {
    console.error('[recovery] ADMIN_EMAIL unset — skipping ops alert', { source: args.source, reference: args.reference });
    return false;
  }
  const res = await args.sendEmail(
    buildOpsAlertEmail({ adminEmail: args.adminEmail, source: args.source, reference: args.reference, reason: args.reason, creditDepleted: args.creditDepleted }),
  );
  return res.success;
}

/**
 * Refund the order's payment, idempotently. Prefers the stored
 * stripe_payment_intent_id; falls back to retrieving it from the session. Returns
 * the refund id, or null if no payment intent could be resolved / the refund
 * errored (recovery still proceeds — the customer email + status sync run, and the
 * ops alert already fired so a human can finish a stuck refund).
 */
/**
 * Refund a charge that has NO order (checkout refused post-payment). Idempotent on the
 * payment_intent — the webhook retries, and the same key makes Stripe return the SAME
 * refund rather than creating a second. Resolves the payment_intent from the session
 * when not passed. Returns the refund id, or null if it could not refund (caller then
 * lets Stripe retry — never acknowledges a charge left un-refunded).
 */
async function refundByPaymentIntent(
  { paymentIntentId, stripeSessionId }: { paymentIntentId: string | null; stripeSessionId?: string },
  getStripe: typeof realGetStripe,
): Promise<string | null> {
  try {
    const stripe = getStripe();
    let pi = paymentIntentId;
    if (!pi && stripeSessionId) {
      const session = await stripe.checkout.sessions.retrieve(stripeSessionId);
      pi = typeof session.payment_intent === 'string' ? session.payment_intent : (session.payment_intent?.id ?? null);
    }
    if (!pi) {
      console.error('[recovery] checkout refund: no payment_intent', { stripeSessionId });
      return null;
    }
    const refund = await stripe.refunds.create(
      { payment_intent: pi },
      { idempotencyKey: `tuatale-refund-checkout-${pi}` },
    );
    return refund.id;
  } catch (e) {
    console.error('[recovery] checkout refund failed', { stripeSessionId, error: (e as Error)?.message });
    return null;
  }
}

async function issueRefund(
  order: { id: string; stripe_payment_intent_id: string | null; stripe_session_id: string },
  getStripe: typeof realGetStripe,
): Promise<string | null> {
  try {
    const stripe = getStripe();
    let paymentIntentId = order.stripe_payment_intent_id;
    if (!paymentIntentId) {
      const session = await stripe.checkout.sessions.retrieve(order.stripe_session_id);
      paymentIntentId = typeof session.payment_intent === 'string' ? session.payment_intent : (session.payment_intent?.id ?? null);
    }
    if (!paymentIntentId) {
      console.error('[recovery] no payment_intent for order — refund skipped', { orderId: order.id });
      return null;
    }
    const refund = await stripe.refunds.create(
      { payment_intent: paymentIntentId },
      { idempotencyKey: `tuatale-refund-${order.id}` },
    );
    return refund.id;
  } catch (e) {
    console.error('[recovery] refund failed', { orderId: order.id, error: (e as Error)?.message });
    return null;
  }
}
