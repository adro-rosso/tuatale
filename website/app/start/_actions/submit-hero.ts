'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { updateDraftByCookieId, type DraftUpdate } from '@/db/drafts';
import { getDraftCookieFromRequest } from '@/lib/draft-cookie';
import { bookTypeSchema } from '@/lib/validation/schemas';
import type { FieldErrors } from '@/lib/validation/validate';

export interface SubmitHeroState {
  errors: FieldErrors;
}

/**
 * useActionState-shaped server action for the /start/hero step (pet-as-hero).
 * Persists draft.book_type ('child' | 'pet'), then advances to the style step.
 * The protagonist step (/start/child) renders the child OR pet form based on this.
 *
 * book_type is a real column on the test/prod schema but not yet in the generated
 * Supabase types, so the update payload is cast (same pattern as art_style).
 */
export async function submitHeroStep(
  _prevState: SubmitHeroState,
  formData: FormData,
): Promise<SubmitHeroState> {
  // bookTypeSchema defaults unknown/absent → 'child', so this never rejects — the
  // picker only ever submits 'child' or 'pet'.
  const book_type = bookTypeSchema.parse(formData.get('book_type') ?? undefined);

  const cookieId = await getDraftCookieFromRequest();
  if (!cookieId) redirect('/start/reset');

  await updateDraftByCookieId(cookieId, {
    book_type,
    current_step: 'style',
  } as unknown as DraftUpdate);

  revalidatePath('/start', 'layout');

  redirect('/start/style');
}
