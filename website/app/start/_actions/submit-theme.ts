'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { validateTheme } from '@/lib/validation/validate';
import { updateDraftByCookieId } from '@/db/drafts';
import { getDraftCookieFromRequest } from '@/lib/draft-cookie';
import type { FieldErrors } from '@/lib/validation/validate';

export interface SubmitThemeState {
  errors: FieldErrors;
}

export async function submitThemeStep(
  _prevState: SubmitThemeState,
  formData: FormData,
): Promise<SubmitThemeState> {
  const input = {
    theme: formData.get('theme'),
    theme_template_id: formData.get('theme_template_id') || undefined,
    // Only present for pet books; '' → undefined → NULL (no vibe).
    vibe: formData.get('vibe') || undefined,
  };

  const result = validateTheme(input);
  if (!result.ok) {
    return { errors: result.errors };
  }

  const cookieId = await getDraftCookieFromRequest();
  if (!cookieId) redirect('/start/reset');

  const update = {
    theme: result.data.theme,
    theme_template_id: result.data.theme_template_id ?? null,
    current_step: 'preview' as const,
  };
  // vibe is a new column that lags the generated DB types — cast its write.
  (update as { vibe?: string | null }).vibe = result.data.vibe ?? null;
  await updateDraftByCookieId(cookieId, update);

  revalidatePath('/start', 'layout');

  redirect('/start/preview');
}
