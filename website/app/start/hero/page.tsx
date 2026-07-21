import { getDraft } from '@/lib/draft-fetch';
import { isAdultBranchEnabled } from '@/lib/flags';
import { HeroForm } from './HeroForm';

/**
 * Step 0 — who's the book about? (pet-as-hero). A child or a pet. This comes FIRST
 * because it decides which protagonist step the customer sees (child vs pet) and it
 * sets draft.book_type. Default 'child' (the existing product is unchanged).
 */
export default async function HeroStepPage() {
  const result = await getDraft();
  const draft = result.kind === 'found' ? result.draft : null;
  const initial = draft?.book_type ?? 'child';

  // LAYER 1: the flag is read SERVER-SIDE (it is not a NEXT_PUBLIC_* var, so a client
  // component can't see it) and passed down; HeroForm hides the "An adult" option when
  // off. A stale draft whose book_type is 'adult' but the flag is now off falls back to
  // 'child' for the initial selection.
  const adultEnabled = isAdultBranchEnabled();
  const initialSafe = initial === 'adult' && !adultEnabled ? 'child' : initial;

  return <HeroForm initial={initialSafe} adultEnabled={adultEnabled} />;
}
