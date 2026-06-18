'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { validateChild } from '@/lib/validation/validate';
import { updateDraftByCookieId } from '@/db/drafts';
import { getDraftCookieFromRequest } from '@/lib/draft-cookie';
import type { FieldErrors } from '@/lib/validation/validate';
import { type ChildFormValues, STRUCTURED_KEYS, buildChildFeatures } from '@/lib/child-form';
import { backgroundSchema } from '@/lib/validation/schemas';

export interface SubmitChildState {
  errors: FieldErrors;
  // On validation failure we echo the raw submitted values back so the
  // form can repopulate them (React 19 resets uncontrolled inputs to
  // their defaultValue after the action returns).
  values?: ChildFormValues;
}

function readFormValues(formData: FormData): ChildFormValues {
  const get = (k: string) => String(formData.get(k) ?? '');
  const v: ChildFormValues = {
    name: get('name'),
    age_range: get('age_range'),
    gender: get('gender'),
    appearance: get('appearance'),
    background: get('background'),
  } as ChildFormValues;
  for (const k of STRUCTURED_KEYS) v[k] = get(k);
  return v;
}

/**
 * useActionState-shaped server action for the /start/child form.
 * Signature `(prevState, formData) => newState`.
 */
export async function submitChildStep(
  _prevState: SubmitChildState,
  formData: FormData,
): Promise<SubmitChildState> {
  const input = readFormValues(formData);
  const features = buildChildFeatures(input);

  const result = validateChild({
    name: input.name,
    age_range: input.age_range,
    gender: input.gender,
    appearance: input.appearance,
    features,
  });
  if (!result.ok) {
    return { errors: result.errors, values: input };
  }

  // Optional background/heritage. Non-blocking: the input caps at 120, so a
  // too-long value is clamped rather than failing the step. Blank → null.
  const bgParsed = backgroundSchema.safeParse(input.background || undefined);
  const background = bgParsed.success ? (bgParsed.data ?? null) : (input.background.trim().slice(0, 120) || null);

  const cookieId = await getDraftCookieFromRequest();
  if (!cookieId) redirect('/start/reset');

  await updateDraftByCookieId(cookieId, {
    child_name: result.data.name,
    age_range: result.data.age_range,
    child_gender: result.data.gender,
    child_appearance: result.data.appearance ?? '',
    child_features: (result.data.features ?? null) as never,
    background,
    current_step: 'secondaries',
  } as never);

  // Bust the /start layout cache so the fresh child_name propagates to the
  // StepHeader + PricePanel on the next render.
  revalidatePath('/start', 'layout');

  redirect('/start/secondaries');
}
