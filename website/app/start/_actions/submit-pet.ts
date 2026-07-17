'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { validatePet } from '@/lib/validation/validate';
import { READING_LEVEL_TO_BAND } from '@/lib/validation/schemas';
import { updateDraftByCookieId, type DraftUpdate } from '@/db/drafts';
import { getDraftCookieFromRequest } from '@/lib/draft-cookie';
import type { FieldErrors } from '@/lib/validation/validate';

export interface PetFormValues {
  name: string;
  animal_kind: string;
  appearance: string;
  reading_level: string;
  photos: string[]; // Storage paths already uploaded via uploadPetPhoto
  consent: boolean;
}

export interface SubmitPetState {
  errors: FieldErrors;
  values?: PetFormValues;
}

function readFormValues(formData: FormData): PetFormValues {
  const get = (k: string) => String(formData.get(k) ?? '');
  let photos: string[] = [];
  try {
    const raw = get('pet_photos');
    if (raw) photos = (JSON.parse(raw) as unknown[]).filter((p): p is string => typeof p === 'string');
  } catch {
    photos = [];
  }
  return {
    name: get('name'),
    animal_kind: get('animal_kind'),
    appearance: get('appearance'),
    reading_level: get('reading_level') || 'standard',
    photos,
    consent: formData.get('consent') === 'on',
  };
}

/**
 * useActionState-shaped server action for the /start/child form when book_type='pet'.
 * Validates the pet fields, requires at least one photo + consent (the pet's likeness
 * comes from photos), and persists onto the draft. The pet's name/appearance reuse the
 * child_name/child_appearance columns; animal_kind + photo_urls.pet carry pet identity.
 */
export async function submitPetStep(
  _prevState: SubmitPetState,
  formData: FormData,
): Promise<SubmitPetState> {
  const input = readFormValues(formData);

  const result = validatePet({
    name: input.name,
    reading_level: input.reading_level,
    animal_kind: input.animal_kind,
    appearance: input.appearance,
  });
  if (!result.ok) {
    return { errors: result.errors, values: input };
  }

  // A pet book's likeness comes from photos (text-only renders a generic breed), so
  // at least one photo is required, plus explicit consent to use them.
  const errors: FieldErrors = {};
  if (input.photos.length === 0) errors.photos = 'Please add at least one photo of your pet.';
  if (!input.consent) errors.consent = 'Please confirm you’re happy for us to use these photos.';
  if (Object.keys(errors).length > 0) {
    return { errors, values: input };
  }

  const cookieId = await getDraftCookieFromRequest();
  if (!cookieId) redirect('/start/reset');

  await updateDraftByCookieId(cookieId, {
    child_name: result.data.name,
    // Reading level is chosen directly; age_range is derived to keep the column +
    // orders.child_age (NOT NULL) populated. For a pet the "age" is cosmetic —
    // likeness comes from photos + coat, and resolveReadingLevel uses reading_level.
    reading_level: result.data.reading_level,
    age_range: READING_LEVEL_TO_BAND[result.data.reading_level],
    child_appearance: result.data.appearance,
    // Pet identity (book_type already 'pet' from the hero step).
    animal_kind: result.data.animal_kind,
    // No gender for a pet.
    child_gender: null,
    // Photos keyed by role for the adapter (order.photo_urls.pet → child.photo_paths).
    photo_urls: { pet: input.photos },
    photo_consent_at: new Date().toISOString(),
    character_generation_mode: 'photo_assisted',
    current_step: 'secondaries',
  } as unknown as DraftUpdate);

  revalidatePath('/start', 'layout');

  redirect('/start/secondaries');
}
