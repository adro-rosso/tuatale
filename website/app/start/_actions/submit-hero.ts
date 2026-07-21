'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { updateDraftByCookieId, getDraftByCookieId, type DraftUpdate } from '@/db/drafts';
import { getDraftCookieFromRequest } from '@/lib/draft-cookie';
import { bookTypeSchema } from '@/lib/validation/schemas';
import { isAdultBranchEnabled } from '@/lib/flags';
import type { FieldErrors } from '@/lib/validation/validate';

// Vibes that only exist for ADULT books (see ADULT_VIBES). 'adventure' is shared with
// the pet enum, so it is deliberately NOT here — switching an adult→pet draft keeps a
// valid 'adventure' vibe, only the adult-exclusive registers are cleared.
const ADULT_ONLY_VIBES = new Set(['romantic', 'milestone', 'roast']);

export interface SubmitHeroState {
  errors: FieldErrors;
}

/**
 * useActionState-shaped server action for the /start/hero step (pet-as-hero).
 * Persists draft.book_type ('child' | 'pet'), then advances to the style step.
 * The protagonist step (/start/child) renders the child OR pet form based on this.
 *
 * book_type is a real column on the test/prod schema but not yet in the generated
 * Supabase types, so the update payload is cast (same pattern as art_style).
 */
export async function submitHeroStep(
  _prevState: SubmitHeroState,
  formData: FormData,
): Promise<SubmitHeroState> {
  // bookTypeSchema defaults unknown/absent → 'child', so this never rejects — the
  // picker only ever submits 'child', 'pet', or (when enabled) 'adult'.
  const book_type = bookTypeSchema.parse(formData.get('book_type') ?? undefined);

  // LAYER 2b: a stale/forged 'adult' submit with the branch OFF must NOT silently become
  // a child book — never substitute a different product than the customer chose (the
  // stale-client case: hero open while the flag was on, flag flips off, they click adult).
  // Redirect back to hero, which re-renders WITHOUT the adult card. No persist.
  if (book_type === 'adult' && !isAdultBranchEnabled()) {
    redirect('/start/hero');
  }

  const cookieId = await getDraftCookieFromRequest();
  if (!cookieId) redirect('/start/reset');

  const update: Record<string, unknown> = { book_type, current_step: 'style' };

  // LAYER 2a: switching to a NON-adult book clears adult-shaped stale fields left by a
  // prior adult flow. TWO reasons, both load-bearing: (1) on the migrated schema, a
  // child/pet book with a >12 child_age VIOLATES the drafts CHECK, so this very UPDATE
  // would fail without the clear; (2) it makes the charged-then-failed prevention
  // EXPLICIT here, instead of depending on create-order re-deriving child_age from
  // age_range (an unrelated function a future refactor could change). Also clears a
  // stale adult-only vibe (e.g. 'roast') that would otherwise ride onto a child order.
  if (book_type !== 'adult') {
    const draft = await getDraftByCookieId(cookieId);
    const staleAge = (draft as { child_age?: number | null } | null)?.child_age;
    const staleVibe = (draft as { vibe?: string | null } | null)?.vibe;
    if (typeof staleAge === 'number' && staleAge > 12) update.child_age = null;
    if (typeof staleVibe === 'string' && ADULT_ONLY_VIBES.has(staleVibe)) update.vibe = null;
  }

  await updateDraftByCookieId(cookieId, update as unknown as DraftUpdate);

  revalidatePath('/start', 'layout');

  redirect('/start/style');
}
