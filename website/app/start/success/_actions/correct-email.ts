'use server';

/**
 * Batch 4b — self-serve post-order email correction.
 *
 * Ownership proof: possession of the Stripe Checkout Session id (the `session_id` in the
 * success URL) — the same unguessable bearer token the success page already trusts to reveal
 * the order. No account/login exists; this adds no weaker assumption than the page itself.
 *
 * Guarded, in order:
 *   1. FLAG (EMAIL_CORRECTION_ENABLED) — fail-closed; off → refuse + point to support.
 *   2. FORMAT — reject an obviously malformed address before any write.
 *   3. OWNERSHIP — the session id must resolve to a real order.
 *   4. UNSHIPPED — refuse once the book has shipped (the notification already went out; only
 *      support can help then). A missing pipeline job counts as unshipped (book not sent yet).
 *   5. RATE LIMIT — derived from email_change_log: max changes per order + a short cooldown.
 *
 * Then (optimistic): update customer_email + append the audit entry, and best-effort send a
 * confirmation to the NEW address and an alert to the OLD one (both non-blocking; sendEmail
 * Sentry-captures its own failures). Only Tuatale's own order emails are redirected — Stripe's
 * receipt already went to the checkout address and can't be moved.
 *
 * RETURNS a structured result (never throws user-facing copy): Next redacts thrown Server
 * Action messages client-side (project_server-action-error-redaction).
 */
import { getOrderByStripeSessionId, applyEmailCorrection, type EmailChangeLogEntry } from '@/db/orders';
import { getJobByOrderId } from '@/db/pipeline-jobs';
import { isEmailCorrectionEnabled } from '@/lib/flags';
import { isValidEmail, normalizeEmail, maskEmail } from '@/lib/validation/email';
import { sendEmail } from '@/lib/email/send';
import { buildEmailChangeConfirmation, buildEmailChangeAlert } from '@/lib/email/templates/email-change';

export type CorrectEmailState =
  | { status: 'idle' }
  | { status: 'success'; email: string }
  | { status: 'error'; message: string };

const MAX_CHANGES = 3;
const COOLDOWN_MS = 60_000;
const SUPPORT = 'hello@tuatale.com';

/** Generic support-fallback error copy — kept vague so the token isn't a probing oracle. */
function err(message: string): CorrectEmailState {
  return { status: 'error', message };
}

export async function correctOrderEmail(
  sessionId: string,
  _prev: CorrectEmailState,
  formData: FormData,
): Promise<CorrectEmailState> {
  // 1. FLAG — fail-closed.
  if (!isEmailCorrectionEnabled()) {
    return err(`This isn't available right now — please email ${SUPPORT} and we'll fix it for you.`);
  }

  const raw = String(formData.get('email') ?? '').trim();
  if (!raw) return err(`Enter the email address you'd like us to use.`);

  // 2. FORMAT.
  if (!isValidEmail(raw)) return err(`That doesn't look like a valid email address.`);
  const newEmail = normalizeEmail(raw);

  // 3. OWNERSHIP — the session token must resolve to an order.
  if (!sessionId) return err(`We couldn't find that order — please email ${SUPPORT}.`);
  const order = await getOrderByStripeSessionId(sessionId);
  if (!order) return err(`We couldn't find that order — please email ${SUPPORT}.`);

  if (normalizeEmail(order.customer_email) === newEmail) {
    return err(`That's already the email on your order — nothing to change.`);
  }

  // 4. UNSHIPPED — once shipped, the notification already went to the old address.
  const job = await getJobByOrderId(order.id);
  if (job?.status === 'shipped') {
    return err(`Your book has already been sent to the address on file. Email ${SUPPORT} and we'll help.`);
  }

  // 5. RATE LIMIT — from the audit log (no extra infra).
  const existing = ((order as { email_change_log?: EmailChangeLogEntry[] }).email_change_log ?? []).filter(
    (e): e is EmailChangeLogEntry => !!e && typeof e.at === 'string',
  );
  if (existing.length >= MAX_CHANGES) {
    return err(`You've changed this a few times already — please email ${SUPPORT} and we'll sort it out.`);
  }
  const last = existing[existing.length - 1];
  if (last && Date.now() - new Date(last.at).getTime() < COOLDOWN_MS) {
    return err(`Just a moment — please wait a minute before changing this again.`);
  }

  // Optimistic update: write the correction + append the audit entry.
  const oldEmail = order.customer_email;
  const entry: EmailChangeLogEntry = {
    from: oldEmail,
    to: newEmail,
    at: new Date().toISOString(),
    source: 'self_serve_success',
  };
  try {
    await applyEmailCorrection(order.id, newEmail, [...existing, entry]);
  } catch {
    return err(`Something went wrong saving that — please try again, or email ${SUPPORT}.`);
  }

  // Best-effort notifications (non-blocking; sendEmail Sentry-captures its own failures):
  //  - confirmation to the NEW address (also the reachability test for a typo'd correction)
  //  - alert to the OLD address (security note; new address masked)
  await Promise.allSettled([
    sendEmail(buildEmailChangeConfirmation({ newEmail, childName: order.child_name, orderId: order.id })),
    sendEmail(
      buildEmailChangeAlert({
        oldEmail,
        newEmailMasked: maskEmail(newEmail),
        childName: order.child_name,
        orderId: order.id,
      }),
    ),
  ]);

  return { status: 'success', email: newEmail };
}
