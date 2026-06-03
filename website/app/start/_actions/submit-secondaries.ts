'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { validateSecondaries } from '@/lib/validation/validate';
import { updateDraftByCookieId } from '@/db/drafts';
import { getDraftCookieFromRequest } from '@/lib/draft-cookie';
import type { FieldErrors } from '@/lib/validation/validate';
import type { Json } from '@/types/database';

export interface SubmitSecondariesState {
  errors: FieldErrors;
}

interface SubmitSecondariesPayload {
  secondaries: unknown;
}

/**
 * Direct-call Server Action for the secondaries step.
 *
 * Unlike the child / theme steps (which use FormData + useActionState),
 * secondaries has a variable-shape payload (array of card objects), so
 * the client passes the JS state directly. Successful submission redirects
 * via `redirect()`; validation failures return `{ errors }` for the client
 * to surface.
 */
export async function submitSecondariesStep(
  payload: SubmitSecondariesPayload,
): Promise<SubmitSecondariesState | undefined> {
  const result = validateSecondaries(payload.secondaries);
  if (!result.ok) return { errors: result.errors };

  const cookieId = await getDraftCookieFromRequest();
  if (!cookieId) redirect('/start/reset');

  await updateDraftByCookieId(cookieId, {
    secondaries: result.data as unknown as Json,
    current_step: 'theme',
  });

  // Bust the /start layout cache so PricePanel re-renders with the
  // updated secondaries count + extra-care total.
  revalidatePath('/start', 'layout');

  redirect('/start/theme');
}
