'use server';

import { addSignup } from '@/db/waitlist';

/**
 * useActionState-shaped server action for the landing-page waitlist form.
 *
 * Pre-launch capture: validate the email, normalize it (trim + lower-case
 * so the unique constraint dedupes case/whitespace variants), and upsert.
 * The upsert makes a repeat signup a success, so the customer never sees a
 * "you're already on the list" error — they just see the thank-you state.
 *
 * Returns a small status object the client form renders inline. We never
 * throw to the boundary on a bad email — that's expected user input, not
 * an exception.
 */
export interface WaitlistState {
  status: 'idle' | 'success' | 'error';
  message?: string;
  /** Echoed back so the form can repopulate on error without losing input. */
  email?: string;
}

// Pragmatic email shape check — not RFC-perfect (no validator is), just
// enough to reject obvious typos before we store it. Real deliverability
// is confirmed when the launch email actually sends.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function joinWaitlist(
  _prevState: WaitlistState,
  formData: FormData,
): Promise<WaitlistState> {
  const raw = String(formData.get('email') ?? '');
  const email = raw.trim().toLowerCase();
  const source = String(formData.get('source') ?? 'landing') || 'landing';

  if (!EMAIL_RE.test(email) || email.length > 320) {
    return { status: 'error', message: 'Please enter a valid email address.', email: raw };
  }

  try {
    await addSignup({ email, source });
    return { status: 'success' };
  } catch {
    // DB / network hiccup — keep the customer's input so a retry is one tap.
    return {
      status: 'error',
      message: 'Something went wrong saving that. Please try again.',
      email: raw,
    };
  }
}
