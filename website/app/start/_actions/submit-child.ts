'use server';

import { redirect } from 'next/navigation';
import { validateChild } from '@/lib/validation/validate';
import { updateDraftByCookieId } from '@/db/drafts';
import { getDraftCookieFromRequest } from '@/lib/draft-cookie';
import type { FieldErrors } from '@/lib/validation/validate';

export interface SubmitChildState {
  errors: FieldErrors;
}

/**
 * useActionState-shaped server action for the /start/child form.
 *
 * Signature `(prevState, formData) => newState`. Validation failures
 * return `{ errors }` so React can hydrate them into the form. Success
 * throws via `redirect()` — useActionState handles that as a route
 * change, so the function never actually returns the success state.
 */
export async function submitChildStep(
  _prevState: SubmitChildState,
  formData: FormData,
): Promise<SubmitChildState> {
  const input = {
    name: formData.get('name'),
    age_range: formData.get('age_range'),
    gender: formData.get('gender'),
    appearance: formData.get('appearance'),
  };

  const result = validateChild(input);
  if (!result.ok) {
    return { errors: result.errors };
  }

  const cookieId = await getDraftCookieFromRequest();
  if (!cookieId) redirect('/start/reset');

  await updateDraftByCookieId(cookieId, {
    child_name: result.data.name,
    age_range: result.data.age_range,
    child_gender: result.data.gender,
    child_appearance: result.data.appearance,
    current_step: 'secondaries',
  });

  redirect('/start/secondaries');
}
