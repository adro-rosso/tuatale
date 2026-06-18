'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { updateDraftByCookieId, type DraftUpdate } from '@/db/drafts';
import { getDraftCookieFromRequest } from '@/lib/draft-cookie';
import { dedicationMessageSchema } from '@/lib/validation/schemas';

/**
 * Review step — saves the OPTIONAL custom dedication, then advances to payment.
 *
 * dedication_message is a real column (test/prod) not yet in the generated
 * Supabase types, so the update payload is cast (same as submit-style's
 * art_style). Non-blocking by design: a too-long value (the textarea already
 * caps at 120) is clamped rather than blocking the customer at the final step.
 * Blank/whitespace → null → the book renders the auto-default dedication.
 */
export async function submitReviewStep(formData: FormData): Promise<void> {
  const raw = formData.get('dedication_message');
  const parsed = dedicationMessageSchema.safeParse(typeof raw === 'string' ? raw : undefined);
  const dedication_message = parsed.success
    ? (parsed.data ?? null)
    : typeof raw === 'string'
      ? raw.trim().slice(0, 120) || null
      : null;

  const cookieId = await getDraftCookieFromRequest();
  if (!cookieId) redirect('/start');

  await updateDraftByCookieId(cookieId, {
    dedication_message,
    current_step: 'payment',
  } as unknown as DraftUpdate);

  revalidatePath('/start', 'layout');
  redirect('/start/payment');
}
