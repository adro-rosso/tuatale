'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { validateSecondaries } from '@/lib/validation/validate';
import { updateDraftByCookieId, type DraftUpdate } from '@/db/drafts';
import { getDraftCookieFromRequest } from '@/lib/draft-cookie';
import { isConsentVersion, buildConsentRecord } from '@/lib/consent/registry';
import type { FieldErrors } from '@/lib/validation/validate';
import type { Json } from '@/types/database';

export interface SubmitSecondariesState {
  errors: FieldErrors;
}

interface SubmitSecondariesPayload {
  secondaries: unknown;
  /** Set when the parent consented to companion photos. Stamps photo_consent_at. */
  photoConsent?: boolean;
  /** CHILD-book companions: the versioned attestation to record PER CARD (companion-v1).
   *  Undefined for pet books (timestamp-only). Server writes the canonical text. */
  photoConsentVersion?: string;
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

  // Child-book companions: attach the versioned consent record to each card that has
  // photos (companions can be children). Added POST-validation because the Zod schema
  // strips unknown keys; re-stamped each submit (the consent checkbox re-attests on return).
  let secondaries = result.data as unknown as Array<Record<string, unknown>>;
  if (payload.photoConsentVersion && isConsentVersion(payload.photoConsentVersion)) {
    const record = buildConsentRecord(payload.photoConsentVersion, new Date().toISOString());
    secondaries = secondaries.map((card) => {
      const photos = (card as { photos?: unknown }).photos;
      return Array.isArray(photos) && photos.length > 0 ? { ...card, photo_consent: record } : card;
    });
  }

  const update: DraftUpdate = {
    secondaries: secondaries as unknown as Json,
    current_step: 'theme',
  };
  // Stamp consent when the parent uploaded + confirmed companion photos.
  if (payload.photoConsent) {
    (update as unknown as { photo_consent_at: string }).photo_consent_at = new Date().toISOString();
  }
  await updateDraftByCookieId(cookieId, update);

  // Bust the /start layout cache so PricePanel re-renders with the
  // updated secondaries count + extra-care total.
  revalidatePath('/start', 'layout');

  redirect('/start/theme');
}
