/**
 * Server-side guard: is a draft complete enough to charge for?
 *
 * Shared between the /start/payment Server Component (which redirects
 * back to /start/review when fields are missing) and the
 * create-checkout-session Server Action (which throws CheckoutError —
 * the action should never see an incomplete draft if the page guard
 * worked, but defence-in-depth).
 *
 * "Complete" means: every field the orders table requires NOT NULL is
 * populated on the draft. customer_email is excluded because Stripe
 * Checkout collects it from the customer during payment, not from us.
 * photo_consent_at + photo_urls + character_generation_mode all have
 * defaults on orders, so an empty draft is fine for those.
 */
import type { Tables } from '@/types/database';
import { isStructuredComplete } from '@/lib/validation/schemas';

type Draft = Tables<'drafts'>;

// Always-required (orders NOT NULL) — appearance is handled separately below
// because it's now satisfied by EITHER free-text OR a structured-complete
// character (the 4 identity axes), mirroring the Zod rule + create-order guard.
const REQUIRED_FIELDS = ['child_name', 'age_range', 'child_gender', 'theme'] as const;

export type RequiredDraftField =
  | (typeof REQUIRED_FIELDS)[number]
  | 'child_appearance'
  | 'animal_kind'
  | 'pet_photos';

export interface DraftCompletenessResult {
  complete: boolean;
  missing: ReadonlyArray<RequiredDraftField>;
}

const isEmpty = (v: unknown) => v === null || v === undefined || v === '';

export function checkDraftCompleteness(draft: Draft): DraftCompletenessResult {
  const bookType = (draft as { book_type?: string | null }).book_type ?? 'child';

  // Pet-as-hero: name, kind, coat appearance, reading age, theme, and ≥1 photo (the
  // pet's likeness comes from photos). No gender / no structured features.
  if (bookType === 'pet') {
    const missing: RequiredDraftField[] = [];
    if (isEmpty(draft.child_name)) missing.push('child_name');
    if (isEmpty(draft.age_range)) missing.push('age_range');
    if (isEmpty((draft as { animal_kind?: string | null }).animal_kind)) missing.push('animal_kind');
    if (isEmpty(draft.child_appearance)) missing.push('child_appearance');
    if (isEmpty(draft.theme)) missing.push('theme');
    const petPhotos = (draft as { photo_urls?: { pet?: string[] } | null }).photo_urls?.pet;
    if (!Array.isArray(petPhotos) || petPhotos.length === 0) missing.push('pet_photos');
    return { complete: missing.length === 0, missing };
  }

  const missing: RequiredDraftField[] = REQUIRED_FIELDS.filter((f) => isEmpty(draft[f]));
  // Appearance requirement: free-text OR a structured-complete character.
  if (isEmpty(draft.child_appearance) && !isStructuredComplete(draft.child_features)) {
    missing.push('child_appearance');
  }
  return { complete: missing.length === 0, missing };
}

/**
 * Map the age_range bucket to a single representative age. Used when
 * snapshotting a draft into an order — orders.child_age is NOT NULL
 * (the schema predates age_range as the form input), so we pick the
 * middle of the bucket. The pipeline can re-derive whatever it needs
 * from age_range, which we also store.
 */
export function ageFromRange(ageRange: string): number {
  switch (ageRange) {
    case '3-5':
      return 4;
    case '5-7':
      return 6;
    case '7-9':
      return 8;
    default:
      // Shouldn't happen — the form constrains to the enum and the DB
      // has a CHECK — but if it does, pick a sensible middle-of-the-
      // road value rather than throwing.
      return 6;
  }
}
