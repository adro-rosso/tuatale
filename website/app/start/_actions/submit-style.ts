'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { updateDraftByCookieId, type DraftUpdate } from '@/db/drafts';
import { getDraftCookieFromRequest } from '@/lib/draft-cookie';
import { artStyleSchema } from '@/lib/validation/schemas';
import type { FieldErrors } from '@/lib/validation/validate';

export interface SubmitStyleState {
  errors: FieldErrors;
}

/**
 * useActionState-shaped server action for the /start/style form (W-F).
 * Persists draft.art_style, then advances to the character step. The
 * previews on /start/child render in this chosen style.
 *
 * Note: art_style is a real column on the test/prod schema but isn't in
 * the generated Supabase types yet, so the update payload is cast.
 */
export async function submitStyleStep(
  _prevState: SubmitStyleState,
  formData: FormData,
): Promise<SubmitStyleState> {
  // artStyleSchema defaults unknown/absent → watercolour, so this never
  // rejects — the picker only ever submits one of the 6 known values.
  const art_style = artStyleSchema.parse(formData.get('art_style') ?? undefined);

  const cookieId = await getDraftCookieFromRequest();
  if (!cookieId) redirect('/start/reset');

  await updateDraftByCookieId(cookieId, {
    art_style,
    current_step: 'child',
  } as unknown as DraftUpdate);

  revalidatePath('/start', 'layout');

  redirect('/start/child');
}
