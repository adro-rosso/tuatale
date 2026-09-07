/**
 * Email-correction templates (Batch 4b) — two transactional emails sent when a customer
 * self-corrects the address on their order from the success page:
 *
 *   - buildEmailChangeConfirmation → to the NEW address ("your Tuatale order emails now come
 *     here"). Doubles as the reachability test: if the new address was itself a typo, this
 *     bounces and the customer never sees it (support is the fallback).
 *   - buildEmailChangeAlert → to the OLD address ("the email on your order was changed…").
 *     Best-effort security note so the original buyer is told if a link-holder changes it; the
 *     new address is masked so the alert doesn't leak it.
 *
 * Warm-literary voice, inline CSS only, HTML + plain-text — mirrors ship-notification.ts.
 * Honest scope: this only redirects Tuatale's OWN order emails; Stripe's payment receipt
 * already went to the checkout address and can't be moved.
 */
import type { EmailContent } from './ship-notification';

export interface EmailChangeConfirmationInput {
  /** The new (corrected) address — the recipient. */
  newEmail: string;
  childName: string;
  orderId: string;
}

export function buildEmailChangeConfirmation(input: EmailChangeConfirmationInput): EmailContent {
  const { newEmail, childName, orderId } = input;
  const shortOrderId = orderId.slice(0, 8);
  const subject = `Your Tuatale order emails now come here`;

  const text = [
    `You changed the email for ${childName}'s Tuatale order to this address.`,
    '',
    `From now on, the email with your finished book — and anything else about this order —`,
    `will come here.`,
    '',
    `If you didn't make this change, please write to hello@tuatale.com.`,
    '',
    `Order ${shortOrderId}.`,
    '',
    `— Tuatale`,
  ].join('\n');

  const html = renderShell({
    heading: `Your order emails now come here.`,
    bodyParas: [
      `You changed the email for ${escapeHtml(childName)}'s Tuatale order to this address.`,
      `From now on, the email with your finished book — and anything else about this order — will come here.`,
    ],
    footerNote: `If you didn't make this change, please write to <a href="mailto:hello@tuatale.com" style="color:#7A3328;">hello@tuatale.com</a>.`,
    shortOrderId,
  });

  return { to: newEmail, subject, html, text };
}

export interface EmailChangeAlertInput {
  /** The old (previous) address — the recipient of the alert. */
  oldEmail: string;
  /** The new address, already masked for display (e.g. "a•••@example.com"). */
  newEmailMasked: string;
  childName: string;
  orderId: string;
}

export function buildEmailChangeAlert(input: EmailChangeAlertInput): EmailContent {
  const { oldEmail, newEmailMasked, childName, orderId } = input;
  const shortOrderId = orderId.slice(0, 8);
  const subject = `The email on your Tuatale order was changed`;

  const text = [
    `The email for ${childName}'s Tuatale order was just changed to ${newEmailMasked}.`,
    '',
    `Future emails about this order will go there instead of here.`,
    '',
    `If this was you, no action is needed. If it wasn't, please write to hello@tuatale.com`,
    `straight away and we'll help.`,
    '',
    `Order ${shortOrderId}.`,
    '',
    `— Tuatale`,
  ].join('\n');

  const html = renderShell({
    heading: `The email on your order was changed.`,
    bodyParas: [
      `The email for ${escapeHtml(childName)}'s Tuatale order was just changed to ${escapeHtml(newEmailMasked)}.`,
      `Future emails about this order will go there instead of here.`,
    ],
    footerNote: `If this was you, no action is needed. If it wasn't, please write to <a href="mailto:hello@tuatale.com" style="color:#7A3328;">hello@tuatale.com</a> straight away and we'll help.`,
    shortOrderId,
  });

  return { to: oldEmail, subject, html, text };
}

interface ShellInput {
  heading: string;
  bodyParas: string[];
  footerNote: string;
  shortOrderId: string;
}

function renderShell({ heading, bodyParas, footerNote, shortOrderId }: ShellInput): string {
  const paras = bodyParas
    .map(
      (p) => `<p style="margin:0 0 24px 0; font-size:16px; line-height:1.5;">${p}</p>`,
    )
    .join('\n          ');
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(heading)}</title>
  </head>
  <body style="margin:0; padding:0; background-color:#FBF3EE; font-family: Georgia, 'EB Garamond', serif; color:#2E2620; line-height:1.6;">
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center" width="100%" style="max-width:560px; margin:48px auto; background-color:#FBF3EE;">
      <tr>
        <td style="padding:32px 32px 16px 32px;">
          <p style="margin:0; font-family: Georgia, 'EB Garamond', serif; font-style: italic; font-size:24px; color:#7A3328; letter-spacing:0.02em;">
            tuatale
          </p>
        </td>
      </tr>
      <tr>
        <td style="padding:16px 32px;">
          <p style="margin:0 0 24px 0; font-size:18px; line-height:1.5;">
            ${escapeHtml(heading)}
          </p>
          ${paras}
          <p style="margin:0 0 16px 0; font-size:14px; color:#7A6F62;">
            ${footerNote}
          </p>
          <p style="margin:0; font-size:14px; color:#7A6F62;">
            Order ${escapeHtml(shortOrderId)}.
          </p>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

/** Minimal HTML escaper (same five characters as ship-notification.ts). */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
