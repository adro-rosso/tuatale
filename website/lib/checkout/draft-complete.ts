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

type Draft = Tables<'drafts'>;

const REQUIRED_FIELDS = [
  'child_name',
  'age_range',
  'child_gender',
  'child_appearance',
  'theme',
] as const;

export type RequiredDraftField = (typeof REQUIRED_FIELDS)[number];

export interface DraftCompletenessResult {
  complete: boolean;
  missing: ReadonlyArray<RequiredDraftField>;
}

export function checkDraftCompleteness(draft: Draft): DraftCompletenessResult {
  const missing = REQUIRED_FIELDS.filter((f) => {
    const value = draft[f];
    return value === null || value === undefined || value === '';
  });
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
