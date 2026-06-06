/**
 * Send wrapper around Resend's emails.send.
 *
 * Returns a discriminated success/failure object instead of
 * throwing — the callers (currently shipJobAction) want to log the
 * outcome to the DB and continue rather than crash the admin's
 * action. Every failure path also Sentry-captures so the ops team
 * gets an alert independent of whatever the caller does with the
 * result.
 *
 * From-address is read from EMAIL_FROM at send time so an env
 * change (e.g. swapping onboarding@resend.dev for the eventual real
 * Tuatale domain) takes effect on the next deploy without a code
 * change.
 *
 * Sentry capture wraps the underlying error in EmailSendError so
 * Sentry's grouping is consistent — Resend's own error shape
 * varies between transports.
 */
import * as Sentry from '@sentry/nextjs';
import { randomUUID } from 'node:crypto';
import { getResend } from './client';
import { EmailSendError } from './errors';
import type { EmailContent } from './templates/ship-notification';

export type SendEmailResult =
  | { success: true; messageId: string }
  | { success: false; error: string };

const DEFAULT_FROM = 'onboarding@resend.dev';
const FAKE_EMAIL_FLAG = 'E2E_TEST_MODE_FAKE_EMAIL_SEND';

// Module-load defensive: if the test-mode flag somehow leaks into a
// production deploy, scream into the logs. The flag never gets read
// in production deploys (Vercel env doesn't set it) and the
// playwright config only sets it for the e2e dev server — but the
// safety net is cheap.
if (process.env[FAKE_EMAIL_FLAG] === 'true' && process.env.NODE_ENV === 'production') {
  // eslint-disable-next-line no-console
  console.error(
    `[email/send] DANGER: ${FAKE_EMAIL_FLAG}=true with NODE_ENV=production — emails will NOT be delivered.`,
  );
}

export async function sendEmail(content: EmailContent): Promise<SendEmailResult> {
  const from = process.env.EMAIL_FROM?.trim() || DEFAULT_FROM;
  const sentryExtras = { to: content.to, subject: content.subject, from };

  // Test-only short-circuit. Set by tests/e2e/playwright.config.ts on
  // the dev server it spawns; production env never has this flag.
  // Returns a synthetic success result so the calling code's success
  // path runs (notification_sent_at + notification_message_id get
  // persisted) without hitting Resend's API.
  if (process.env[FAKE_EMAIL_FLAG] === 'true') {
    return {
      success: true,
      messageId: `msg_test_e2e_${randomUUID().replace(/-/g, '').slice(0, 16)}`,
    };
  }

  try {
    const resend = getResend();
    const { data, error } = await resend.emails.send({
      from,
      to: content.to,
      subject: content.subject,
      html: content.html,
      text: content.text,
    });

    if (error) {
      const message =
        typeof error === 'object' && error && 'message' in error
          ? String((error as { message: unknown }).message)
          : 'Unknown Resend error';
      Sentry.captureException(new EmailSendError(message, error), {
        tags: { component: 'email-send' },
        extra: sentryExtras,
      });
      return { success: false, error: message };
    }

    if (!data?.id) {
      // Defence-in-depth: Resend's SDK should always populate id on
      // success, but if a future SDK upgrade returns a different shape
      // we'd rather surface it loudly than silently record a missing
      // message id.
      const message = 'Resend returned no message id';
      Sentry.captureException(new EmailSendError(message), {
        tags: { component: 'email-send' },
        extra: sentryExtras,
      });
      return { success: false, error: message };
    }

    return { success: true, messageId: data.id };
  } catch (err) {
    // Includes EmailConfigError (RESEND_API_KEY unset) + any network
    // error the SDK didn't catch internally.
    const message = err instanceof Error ? err.message : 'Unknown send error';
    Sentry.captureException(err, {
      tags: { component: 'email-send' },
      extra: sentryExtras,
    });
    return { success: false, error: message };
  }
}
