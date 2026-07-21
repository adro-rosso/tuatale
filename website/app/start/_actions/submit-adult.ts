'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { validateAdult } from '@/lib/validation/validate';
import { updateDraftByCookieId, type DraftUpdate } from '@/db/drafts';
import { getDraftCookieFromRequest } from '@/lib/draft-cookie';
import type { FieldErrors } from '@/lib/validation/validate';

export interface AdultFormValues {
  name: string;
  age: string;
  gender: string;
  appearance: string;
  photos: string[];
  consent: boolean;
}

export interface SubmitAdultState {
  errors: FieldErrors;
  values?: AdultFormValues;
}

function readFormValues(formData: FormData): AdultFormValues {
  const get = (k: string) => String(formData.get(k) ?? '');
  let photos: string[] = [];
  try {
    const raw = get('adult_photos');
    if (raw) photos = (JSON.parse(raw) as unknown[]).filter((p): p is string => typeof p === 'string');
  } catch {
    photos = [];
  }
  return {
    name: get('name'),
    age: get('age'),
    gender: get('gender'),
    appearance: get('appearance'),
    photos,
    consent: formData.get('consent') === 'on',
  };
}

/**
 * useActionState-shaped server action for the /start/child form when book_type='adult'
 * (text-only, Slice 1 — the photo path is Slice 2). The adult's name/appearance reuse
 * the child_name/child_appearance columns; the EXPLICIT age goes to child_age (the
 * migration widened its CHECK to 18-120 for adults).
 *
 * reading_level and age_range are stored NULL on purpose: the ADULT register
 * (audience='adult', set by the adapter from book_type) governs adult prose, NOT the
 * reading level — there is no path where reading_level also steers adult prose. NULL
 * resolves to 'advanced' downstream and is then overridden, so there is no double
 * control. (orders.age_range was made nullable for exactly this.)
 */
export async function submitAdultStep(
  _prevState: SubmitAdultState,
  formData: FormData,
): Promise<SubmitAdultState> {
  const input = readFormValues(formData);

  const result = validateAdult({
    name: input.name,
    age: input.age,
    gender: input.gender,
    appearance: input.appearance,
  });
  if (!result.ok) {
    return { errors: result.errors, values: input };
  }

  // A photo is OPTIONAL for an adult book (text-only still renders). But IF one is
  // present, self-attested consent is REQUIRED — the photo cannot be stored without it.
  if (input.photos.length > 0 && !input.consent) {
    return { errors: { consent: 'Please confirm the checkbox to use a photo.' }, values: input };
  }

  const cookieId = await getDraftCookieFromRequest();
  if (!cookieId) redirect('/start/reset');

  const hasPhoto = input.photos.length > 0 && input.consent;

  await updateDraftByCookieId(cookieId, {
    child_name: result.data.name,
    // The explicit adult age — drives the narrated age + milestone number. The photo
    // drives appearance; the two can differ (age-reconciliation decision).
    child_age: result.data.age,
    // Adult gender stored as the child enum (boy/girl/non_binary); ADULT_AUDIENCE_
    // OVERRIDE maps it to man/woman/non-binary. The form shows the adult labels.
    child_gender: result.data.gender,
    child_appearance: result.data.appearance,
    // NULL on purpose (see the doc comment): the adult register drives prose, not the
    // reading level. No child band for an adult.
    reading_level: null,
    age_range: null,
    // Adult photos under the .adult key — a DELIBERATE separation from the legally-
    // gated .child key (uploadPhoto is hard-denied). Consent timestamp gates them.
    ...(hasPhoto
      ? {
          photo_urls: { adult: input.photos },
          photo_consent_at: new Date().toISOString(),
          character_generation_mode: 'photo_assisted',
        }
      : {
          // No photo → text-only path. Clear any prior photo/consent if they removed it.
          photo_urls: {},
          photo_consent_at: null,
          character_generation_mode: 'text_only',
        }),
    current_step: 'secondaries',
  } as unknown as DraftUpdate);

  revalidatePath('/start', 'layout');

  redirect('/start/secondaries');
}
