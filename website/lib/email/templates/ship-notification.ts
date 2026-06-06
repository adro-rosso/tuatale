/**
 * Ship-notification email template.
 *
 * Single transactional email Tuatale sends at launch — when admin
 * clicks Ship on a job, the customer gets one of these. Warm-literary
 * voice (no exclamation marks, no "magical adventure"); minimal
 * content (heading, link, signoff); inline CSS only (email clients
 * strip <style> blocks).
 *
 * Both an HTML and a plain-text rendering — Resend sends both, and
 * mail clients pick the right one for their context (HTML for the
 * browser-grade renderers; text for plain-text clients,
 * accessibility tools, search/index pipelines).
 *
 * From-address comes from EMAIL_FROM env (settable by ops). The send
 * helper reads the env; this template only owns the body.
 */

export interface ShipNotificationInput {
  customerEmail: string;
  childName: string;
  orderId: string;
  /** Raw URL from job.pdf_url. May be the Cycle A.2 stub URL — the
   * caller decides whether to send for a stub job (we currently
   * skip stub-pdf sends in shipJobAction). */
  pdfUrl: string;
}

export interface EmailContent {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export function buildShipNotification(input: ShipNotificationInput): EmailContent {
  const { customerEmail, childName, orderId, pdfUrl } = input;
  const shortOrderId = orderId.slice(0, 8);

  const subject = `${childName}'s book is ready`;

  const text = [
    `${childName}'s book is ready.`,
    '',
    `Download it here: ${pdfUrl}`,
    '',
    `If you have any questions, reply to this email or write to`,
    `hello@tuatale.com.`,
    '',
    `Order ${shortOrderId}.`,
    '',
    `— Tuatale`,
  ].join('\n');

  const html = renderHtml({
    childName,
    pdfUrl,
    shortOrderId,
  });

  return { to: customerEmail, subject, html, text };
}

interface HtmlInput {
  childName: string;
  pdfUrl: string;
  shortOrderId: string;
}

function renderHtml({ childName, pdfUrl, shortOrderId }: HtmlInput): string {
  // Brand palette inline (cream/iron-oxide). Georgia falls back from
  // EB Garamond on clients that don't have the webfont — close enough.
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(childName)}'s book is ready</title>
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
            ${escapeHtml(childName)}'s book is ready.
          </p>
          <p style="margin:0 0 32px 0; font-size:16px;">
            You can download it here:
          </p>
          <p style="margin:0 0 40px 0;">
            <a href="${escapeHtmlAttr(pdfUrl)}" style="display:inline-block; padding:14px 28px; background-color:#7A3328; color:#FBF3EE; text-decoration:none; font-size:16px; letter-spacing:0.02em;">
              Download the book
            </a>
          </p>
          <p style="margin:0 0 16px 0; font-size:14px; color:#7A6F62;">
            If you have any questions, reply to this email or write to
            <a href="mailto:hello@tuatale.com" style="color:#7A3328;">hello@tuatale.com</a>.
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

/**
 * Minimal HTML escaper. Covers the five characters that matter for
 * interpolation in element bodies + attribute values: & < > " '.
 *
 * Email is server-rendered, so attacker-controlled values land via
 * order.child_name (Zod-validated on input but defence-in-depth) and
 * pdfUrl (URL string, no whitespace constraint at the Resend
 * boundary, so an injected `"` or `>` inside an href could break out
 * of the attribute and rewrite the link).
 */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeHtmlAttr(s: string): string {
  return escapeHtml(s);
}
