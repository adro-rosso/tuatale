/**
 * Snapshot a draft + a completed Stripe Checkout Session into a new
 * order row.
 *
 * Called from the Stripe webhook handler after signature verification
 * + idempotency check pass. Once this returns, the caller marks the
 * draft as converted (linking the order id back) — separate so the
 * webhook can also reconcile if a prior attempt only made it halfway.
 *
 * All required orders columns are sourced from the draft except:
 *   - customer_email: from the Stripe session's customer_details (the
 *     email the customer typed at Checkout), falling back to the
 *     draft if Stripe somehow didn't get one
 *   - stripe_session_id / stripe_payment_intent_id / amount_paid_cents
 *     / currency / paid_at: from the Stripe session
 *   - child_age: derived from the age_range bucket via ageFromRange,
 *     since the orders table predates age_range as the form input and
 *     still requires child_age NOT NULL
 */
import type Stripe from 'stripe';
import type { Tables, TablesInsert } from '@/types/database';
import { createOrder } from '@/db/orders';
import type { TuataleSupabaseClient } from '@/lib/supabase';
import { isStructuredComplete } from '@/lib/validation/schemas';
import { isPurchasableStyle } from '@/lib/art-style-options';
import { ageFromRange } from './draft-complete';

type Draft = Tables<'drafts'>;
type OrderRow = Tables<'orders'>;
type OrderInsert = TablesInsert<'orders'>;

export interface CreateOrderFromDraftInput {
  draft: Draft;
  stripeSession: Stripe.Checkout.Session;
}

export async function createOrderFromDraft(
  { draft, stripeSession }: CreateOrderFromDraftInput,
  client?: TuataleSupabaseClient,
): Promise<OrderRow> {
  // Required-field guard. The webhook only reaches this after the
  // checkout completed, so the draft SHOULD already be complete (the
  // Server Action validated it). But Stripe webhooks are
  // server-to-server — if anything got mutated between checkout and
  // webhook (race, manual DB tinkering), surface a clear error
  // rather than letting the DB CHECK throw a less-legible one.
  // Pet-as-hero (book_type='pet'): the protagonist is a pet, not a child — no gender,
  // and appearance is the pet's coat/markings free text (no structured features).
  const bookType = draft.book_type ?? 'child';
  const isPet = bookType === 'pet';
  const isAdult = bookType === 'adult';
  const animalKind = draft.animal_kind ?? null;
  if (isAdult) {
    // Adult: require name, the EXPLICIT age (goes straight to child_age; the CHECK was
    // widened to 18-120 for adults), gender, free-text appearance, and theme. No
    // age_range (adults have no child band — orders.age_range is now nullable).
    if (!draft.child_name || draft.child_age == null || !draft.child_gender || !draft.child_appearance || !draft.theme) {
      throw new Error(`Adult draft ${draft.id} is missing required fields (name, age, gender, appearance, theme) when creating order`);
    }
  } else if (isPet) {
    // Pet: require name (pet name), animal_kind, coat appearance, age_range (drives
    // reading level + the NOT NULL child_age), and theme. No gender.
    if (!draft.child_name || !draft.age_range || !animalKind || !draft.child_appearance || !draft.theme) {
      throw new Error(`Pet draft ${draft.id} is missing required fields (name, animal_kind, appearance, theme) when creating order`);
    }
  } else {
    // Child: appearance requirement mirrors the Zod rule — a 50+ char free-text
    // description OR a structured-complete character (the 4 identity axes).
    const hasAppearance = !!draft.child_appearance || isStructuredComplete(draft.child_features);
    if (
      !draft.child_name ||
      !draft.age_range ||
      !draft.child_gender ||
      !hasAppearance ||
      !draft.theme
    ) {
      throw new Error(`Draft ${draft.id} is missing required fields when creating order`);
    }
  }

  const customerEmail =
    stripeSession.customer_details?.email ?? stripeSession.customer_email ?? draft.customer_email;
  if (!customerEmail) {
    throw new Error(`Stripe session ${stripeSession.id} produced no customer email`);
  }

  if (typeof stripeSession.amount_total !== 'number' || stripeSession.amount_total < 0) {
    throw new Error(
      `Stripe session ${stripeSession.id} has invalid amount_total: ${stripeSession.amount_total}`,
    );
  }

  // Stripe session.created is a unix timestamp in seconds; orders.paid_at
  // is a timestamptz. We treat session creation time as paid_at — for
  // checkout.session.completed events the gap is sub-second.
  const paidAt = stripeSession.created
    ? new Date(stripeSession.created * 1000).toISOString()
    : new Date().toISOString();

  const paymentIntentId =
    typeof stripeSession.payment_intent === 'string'
      ? stripeSession.payment_intent
      : (stripeSession.payment_intent?.id ?? null);

  // art_style is a new column (W-C) not yet in the generated Database types — cast
  // its read/write, same pattern as the preview_jobs table. Defaults to watercolour.
  //
  // DEFENSE-IN-DEPTH (never-reject): the pre-payment gate in create-checkout-session
  // already blocks preview-only styles. This runs in the post-payment webhook — the
  // customer is ALREADY charged, so we must NEVER reject. If a non-purchasable style
  // somehow reached here (pre-gate bypassed / race), coerce to watercolour + log loud,
  // so a paid order always yields a deliverable book (pricing is style-independent).
  const requestedStyle = draft.art_style ?? 'watercolour';
  // Book-type aware: flat_modern is purchasable for pets, preview-only for children.
  const safeArtStyle = isPurchasableStyle(requestedStyle, bookType) ? requestedStyle : 'watercolour';
  if (safeArtStyle !== requestedStyle) {
    console.error(
      `[create-order] PRE-GATE BYPASS: draft ${draft.id} reached order creation with ` +
      `non-purchasable art_style "${requestedStyle}" — coerced to watercolour (order ${stripeSession.id}).`,
    );
  }
  // Adult: the EXPLICIT captured age (drives narrated age + milestone number), and no
  // child band. Pet/child: derive child_age from the age band as before. The `!`s are
  // safe — the required-field guard above already threw on a missing value per type.
  const orderChildAge = isAdult ? draft.child_age! : ageFromRange(draft.age_range!);
  // orders.age_range was made nullable for adults; the generated types lag that
  // migration (project_migration-history-drift), so cast the null write.
  const orderAgeRange = (isAdult ? null : draft.age_range) as unknown as OrderInsert['age_range'];
  const payload: OrderInsert = {
    customer_email: customerEmail,
    child_name: draft.child_name,
    child_age: orderChildAge,
    age_range: orderAgeRange,
    // Pet: no gender. Adult + child: the stored boy/girl/non_binary enum (adult wording
    // is applied downstream by ADULT_AUDIENCE_OVERRIDE).
    child_gender: isPet ? null : draft.child_gender,
    child_appearance: draft.child_appearance,
    child_features: draft.child_features,
    // Pet-as-hero passthrough (default 'child' / null for the existing product).
    book_type: bookType,
    animal_kind: animalKind,
    art_style: safeArtStyle,
    // Optional custom dedication (front matter); null → auto-default at render.
    dedication_message: draft.dedication_message ?? null,
    // Optional child background/heritage (parent's words); null → no heritage clause.
    background: draft.background ?? null,
    // Reading level (prose difficulty); null → worker derives from the age band.
    reading_level: draft.reading_level ?? null,
    secondaries: draft.secondaries,
    theme: draft.theme,
    theme_template_id: draft.theme_template_id,
    photo_urls: draft.photo_urls,
    photo_consent_at: draft.photo_consent_at,
    character_generation_mode: draft.character_generation_mode,
    stripe_session_id: stripeSession.id,
    stripe_payment_intent_id: paymentIntentId,
    amount_paid_cents: stripeSession.amount_total,
    currency: stripeSession.currency ?? 'aud',
    paid_at: paidAt,
    converted_from_draft_id: draft.id,
    // pipeline_status defaults to 'queued' at the DB level. Phase 4
    // pipeline integration will flip it forward.
  };
  // vibe (pet story mood) — new column lagging the generated DB types; cast read+write.
  (payload as { vibe?: string | null }).vibe = (draft as { vibe?: string | null }).vibe ?? null;

  return client ? createOrder(payload, client) : createOrder(payload);
}
