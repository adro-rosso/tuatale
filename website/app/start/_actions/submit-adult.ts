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
}

export interface SubmitAdultState {
  errors: FieldErrors;
  values?: AdultFormValues;
}

function readFormValues(formData: FormData): AdultFormValues {
  const get = (k: string) => String(formData.get(k) ?? '');
  return { name: get('name'), age: get('age'), gender: get('gender'), appearance: get('appearance') };
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

  const cookieId = await getDraftCookieFromRequest();
  if (!cookieId) redirect('/start/reset');

  await updateDraftByCookieId(cookieId, {
    child_name: result.data.name,
    // The explicit adult age — drives the narrated age + milestone number. The photo
    // (Slice 2) drives appearance; the two can differ (age-reconciliation decision).
    child_age: result.data.age,
    // Adult gender stored as the child enum (boy/girl/non_binary); ADULT_AUDIENCE_
    // OVERRIDE maps it to man/woman/non-binary. The form shows the adult labels.
    child_gender: result.data.gender,
    child_appearance: result.data.appearance,
    // NULL on purpose (see the doc comment): the adult register drives prose, not the
    // reading level. No child band for an adult.
    reading_level: null,
    age_range: null,
    current_step: 'secondaries',
  } as unknown as DraftUpdate);

  revalidatePath('/start', 'layout');

  redirect('/start/secondaries');
}
