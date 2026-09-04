/**
 * "Does this draft show real intention/effort?" — the bar that decides whether a draft is worth
 * keeping.
 *
 * Used in two places, and they MUST agree:
 *   1. startNewBook — when the customer starts another book, the one they're leaving is PARKED
 *      only if it clears this bar; below it, the draft is silently discarded (expired → the
 *      reaper erases the row + any photos) so a barely-touched draft never clutters "My books".
 *   2. listActiveDraftsByCookieId — the same bar governs what "My books" lists, so a discarded-
 *      on-leave draft and a not-yet-substantial current draft look consistent (neither shows).
 *
 * The bar (either clause is enough):
 *   - PAST THE CHARACTER STEP — current_step is `secondaries` or later, i.e. they've submitted
 *     who the book is about (`child` is the character step; `hero`/`style` come before it).
 *   - ANY MAIN PHOTO uploaded — photo_urls has a non-empty role array (child/pet/adult). A photo
 *     is effort regardless of step (e.g. a pet book still on the character step with a pet photo
 *     already in). Companion photos live in draft.secondaries, which by definition means the
 *     draft is at/after the secondaries step — already covered by the step clause.
 */
import { isWizardStep, stepIndex } from '@/lib/wizard-steps';

/** First step that counts as "past the character step". */
const SUBSTANCE_STEP_INDEX = stepIndex('secondaries');

/** current_step is `secondaries` or later (they've filled in who the book is about). */
export function isPastCharacterStep(currentStep: string | null | undefined): boolean {
  if (!currentStep || !isWizardStep(currentStep)) return false;
  return stepIndex(currentStep) >= SUBSTANCE_STEP_INDEX;
}

/** photo_urls (role-keyed object) holds at least one uploaded main photo. */
export function hasAnyMainPhoto(photoUrls: unknown): boolean {
  if (!photoUrls || typeof photoUrls !== 'object' || Array.isArray(photoUrls)) return false;
  return Object.values(photoUrls as Record<string, unknown>).some(
    (v) => Array.isArray(v) && v.length > 0,
  );
}

/** True when the draft is worth keeping (parking / listing); false → safe to silently discard. */
export function draftHasSubstance(input: {
  current_step: string | null;
  photo_urls: unknown;
}): boolean {
  return isPastCharacterStep(input.current_step) || hasAnyMainPhoto(input.photo_urls);
}
