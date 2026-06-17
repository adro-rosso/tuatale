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
  source: 'order' | 'preview';
  orderId?: string;
  previewId?: string;
  jobId?: string;
  error: { message?: string; kind?: string };
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
  source: 'order' | 'preview';
  alerted: boolean;
  creditDepleted: boolean;
  recovered: boolean;
  refundId: string | null;
  skipped?: 'already-recovered';
}

const CREDIT_RE = /RESOURCE_EXHAUSTED|exceeded your current quota|insufficient|quota/i;

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

  // ---- PREVIEW: ops-alert only, no customer recovery. ----
  if (input.source === 'preview') {
    const alerted = await alertOps({ adminEmail, source: 'preview', reference: input.previewId ?? 'unknown', reason, creditDepleted, sendEmail });
    return { source: 'preview', alerted, creditDepleted, recovered: false, refundId: null };
  }

  // ---- ORDER (paid): idempotency gate, then A + B. ----
  if (!input.orderId) throw new Error('handleFailure: source=order requires orderId');
  const order = await getOrderById(input.orderId);
  if (!order) throw new Error(`handleFailure: order ${input.orderId} not found`);

  const existingError = (order.pipeline_error ?? {}) as Record<string, unknown>;
  if (existingError.recovery) {
    // Already recovered on a prior fire — skip everything (no double refund/email/alert).
    return { source: 'order', alerted: false, creditDepleted, recovered: false, refundId: null, skipped: 'already-recovered' };
  }

  // B. ops-alert.
  const alerted = await alertOps({ adminEmail, source: 'order', reference: input.orderId, reason, creditDepleted, sendEmail });

  // A. refund → customer email → status sync (with recovery marker).
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
  source: 'order' | 'preview';
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
