/**
 * Resend SDK client for Tuatale's transactional email.
 *
 * Lazy-instantiated so importing this module doesn't require the
 * env var to be set — tests that mock `getResend` never touch
 * the SDK at all.
 *
 * Single shared instance across the lifetime of the server
 * process; Resend's SDK is stateless w.r.t. requests so reuse
 * is fine.
 *
 * Server-only — never imported from a client component (would
 * leak RESEND_API_KEY).
 */
import { Resend } from 'resend';
import { EmailConfigError } from './errors';

let cached: Resend | null = null;

export function getResend(): Resend {
  if (cached) return cached;
  const key = process.env.RESEND_API_KEY;
  if (!key || key.trim() === '') {
    throw new EmailConfigError(
      'Missing RESEND_API_KEY. Copy .env.example into .env.local and fill in your Resend API key.',
    );
  }
  cached = new Resend(key);
  return cached;
}

/**
 * Test-only injection point. Tests construct a fake Resend and
 * stash it here; production code never calls this.
 *
 * Pass null to clear the cache (so the next getResend() call will
 * re-read RESEND_API_KEY).
 */
export function setResendForTesting(resend: Resend | null): void {
  cached = resend;
}
