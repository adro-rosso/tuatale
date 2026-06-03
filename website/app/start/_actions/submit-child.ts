'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { validateChild } from '@/lib/validation/validate';
import { updateDraftByCookieId } from '@/db/drafts';
import { getDraftCookieFromRequest } from '@/lib/draft-cookie';
import type { FieldErrors } from '@/lib/validation/validate';

export interface ChildFormValues {
  name: string;
  age_range: string;
  gender: string;
  appearance: string;
}

export interface SubmitChildState {
  errors: FieldErrors;
  // On validation failure we echo the raw submitted values back so the
  // form can repopulate them. React 19's `<form action={fn}>` calls
  // requestFormReset() after the action returns, so uncontrolled
  // inputs fall back to their defaultValue — which we wire to
  // `state.values?.<field> ?? draft.<field>`. Without this round-trip
  // the customer's typed input gets wiped on the first validation
  // error.
  values?: ChildFormValues;
}

/**
 * useActionState-shaped server action for the /start/child form.
 *
 * Signature `(prevState, formData) => newState`. Validation failures
 * return `{ errors, values }` so React can hydrate them into the form.
 * Success throws via `redirect()` — useActionState handles that as a
 * route change, so the function never actually returns the success
 * state.
 */
export async function submitChildStep(
  _prevState: SubmitChildState,
  formData: FormData,
): Promise<SubmitChildState> {
  const input: ChildFormValues = {
    name: String(formData.get('name') ?? ''),
    age_range: String(formData.get('age_range') ?? ''),
    gender: String(formData.get('gender') ?? ''),
    appearance: String(formData.get('appearance') ?? ''),
  };

  const result = validateChild(input);
  if (!result.ok) {
    return { errors: result.errors, values: input };
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

  // Bust the /start layout's cached server output so the next render
  // re-fetches the draft and propagates the fresh child_name down to
  // StepHeader + PricePanel. Without this, intra-segment navigation
  // reuses the layout's RSC payload from before the write and the
  // personalised heading ("Friends and family for Iris") never lands.
  revalidatePath('/start', 'layout');

  redirect('/start/secondaries');
}
