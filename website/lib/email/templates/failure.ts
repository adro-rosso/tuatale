/**
 * Failure-path email templates (R2 reliability cluster).
 *
 *  - buildCustomerFailureEmail: the charged-then-failed recovery note. Warm-
 *    literary voice, matches ship-notification. Tells the customer we hit a snag
 *    and (when true) that they've been refunded.
 *  - buildOpsAlertEmail: the admin alert for ANY failure (paid order OR preview).
 *    creditDepleted flags a RESOURCE_EXHAUSTED incident distinctly so a solo
 *    operator sees "top up credits" at a glance — this is what would have caught
 *    the 2-day outage before it stalled.
 *
 * Both reuse the EmailContent shape the send helper consumes.
 */
import type { EmailContent } from './ship-notification';

export interface CustomerFailureInput {
  customerEmail: string;
  childName: string;
  orderId: string;
  /** Whether a refund was issued (drives the wording). */
  refunded: boolean;
}

export function buildCustomerFailureEmail(input: CustomerFailureInput): EmailContent {
  const { customerEmail, childName, orderId, refunded } = input;
  const shortOrderId = orderId.slice(0, 8);
  const subject = `About ${childName}'s book`;

  const refundLine = refunded
    ? `We've refunded your payment in full — it should appear on your statement within a few business days.`
    : `We're sorting out a full refund for you and will confirm it shortly.`;

  const text = [
    `We're sorry — we ran into a problem making ${childName}'s book and couldn't complete it.`,
    '',
    refundLine,
    '',
    `If you'd like us to try again, or you have any questions, just reply to this email or write to hello@tuatale.com.`,
    '',
    `Order ${shortOrderId}.`,
    '',
    `— Tuatale`,
  ].join('\n');

  const html = `<!DOCTYPE html>
<html lang="en"><body style="margin:0;background:#fbf3ee;font-family:Georgia,serif;color:#2e2620">
  <div style="max-width:480px;margin:0 auto;padding:32px 24px">
    <p style="font-size:18px;line-height:1.6">We're sorry — we ran into a problem making ${childName}'s book and couldn't complete it.</p>
    <p style="font-size:16px;line-height:1.6">${refundLine}</p>
    <p style="font-size:16px;line-height:1.6">If you'd like us to try again, or you have any questions, just reply to this email or write to <a href="mailto:hello@tuatale.com" style="color:#7a3328">hello@tuatale.com</a>.</p>
    <p style="font-size:13px;color:#7a6f62">Order ${shortOrderId}.</p>
    <p style="font-size:16px">— Tuatale</p>
  </div>
</body></html>`;

  return { to: customerEmail, subject, html, text };
}

export interface OpsAlertInput {
  adminEmail: string;
  /** 'order' = paid pipeline failure; 'preview' = pre-purchase preview failure. */
  source: 'order' | 'preview';
  /** orderId or previewId — whatever identifies the failed unit. */
  reference: string;
  reason: string;
  /** RESOURCE_EXHAUSTED / credit depletion detected → distinct "blocked-on-credits" alert. */
  creditDepleted: boolean;
}

export function buildOpsAlertEmail(input: OpsAlertInput): EmailContent {
  const { adminEmail, source, reference, reason, creditDepleted } = input;
  const subject = creditDepleted
    ? `⚠ CREDITS DEPLETED — Tuatale ${source} failure`
    : `Tuatale ${source} failure (${reference.slice(0, 8)})`;

  const creditNote = creditDepleted
    ? `\nThis is a RESOURCE_EXHAUSTED / quota failure — Gemini credits are likely depleted. TOP UP before resuming; polling will not recover it.\n`
    : '';

  const text = [
    `A ${source} failed.`,
    '',
    `Reference: ${reference}`,
    `Reason: ${reason}`,
    creditNote,
    source === 'order'
      ? `Customer recovery (refund + email + status sync) was attempted automatically.`
      : `No customer impact (pre-purchase preview); no refund/email sent.`,
  ].join('\n');

  return { to: adminEmail, subject, html: `<pre>${text}</pre>`, text };
}
