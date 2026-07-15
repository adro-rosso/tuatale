import { getDraft } from '@/lib/draft-fetch';
import { HeroForm } from './HeroForm';

/**
 * Step 0 — who's the book about? (pet-as-hero). A child or a pet. This comes FIRST
 * because it decides which protagonist step the customer sees (child vs pet) and it
 * sets draft.book_type. Default 'child' (the existing product is unchanged).
 */
export default async function HeroStepPage() {
  const result = await getDraft();
  const draft = result.kind === 'found' ? result.draft : null;
  const initial = (draft as { book_type?: string | null } | null)?.book_type ?? 'child';

  return <HeroForm initial={initial} />;
}
