'use server';

import { redirect } from 'next/navigation';
import { getStripe } from '@/lib/stripe';
import { getDraftCookieFromRequest } from '@/lib/draft-cookie';
import { getDraftByCookieId } from '@/db/drafts';
import { calculatePrice, PRICING } from '@/lib/pricing';
import { checkDraftCompleteness } from '@/lib/checkout/draft-complete';
import { isPurchasableStyle } from '@/lib/art-style-options';
import { CheckoutError } from './errors';

/**
 * Create a Stripe Checkout Session for the current draft and redirect
 * the customer to Stripe's hosted Checkout page.
 *
 * The order isn't created here. We pass draft_id + cookie_id through
 * Stripe's session metadata; the webhook handler reads that metadata
 * on checkout.session.completed, creates the order, and marks the
 * draft converted. That keeps the "is the customer paid" decision
 * inside the webhook — the only place Stripe has cryptographically
 * confirmed payment for us.
 *
 * Why redirect-flow Checkout (not embedded Elements):
 *   - Zero PCI surface — we never touch card data
 *   - Stripe owns the form UX, accessibility, currency formatting,
 *     wallet integrations (Apple Pay, Google Pay, Link), 3DS prompts
 *   - One less Next 16 client-component to maintain
 *
 * The trade is the full-page redirect away from tuatale.com. For a
 * one-shot transactional checkout that's acceptable; nothing about
 * Tuatale's flow requires staying in our chrome through payment.
 *
 * @returns never — always redirects (to Stripe on success, throws
 *   CheckoutError on any guard failure).
 */
export async function createCheckoutSession(): Promise<never> {
  const cookieId = await getDraftCookieFromRequest();
  if (!cookieId) throw new CheckoutError('no_cookie');

  const draft = await getDraftByCookieId(cookieId);
  if (!draft) throw new CheckoutError('no_draft');

  const { complete, missing } = checkDraftCompleteness(draft);
  if (!complete) {
    throw new CheckoutError(
      'draft_incomplete',
      `Draft missing required fields: ${missing.join(', ')}`,
    );
  }

  // PRE-PAYMENT purchasable-style gate. Purchasable = the page-vocab-tuned,
  // book-grade styles (isPurchasableStyle: watercolour + coloured pencil today;
  // the rest are preview-only). Block BEFORE creating the Stripe session so a
  // preview-only style can never be charged (gating in the post-payment webhook
  // would mean charged-then-rejected). The payment page pre-empts this with a
  // friendly "switch to a purchasable style" prompt; this is the hard backstop.
  const artStyle = (draft as { art_style?: string | null }).art_style ?? 'watercolour';
  // Book-type aware: flat_modern is purchasable for pet books, preview-only for children.
  const bookTypeForStyle = (draft as { book_type?: string | null }).book_type ?? 'child';
  if (!isPurchasableStyle(artStyle, bookTypeForStyle)) {
    throw new CheckoutError(
      'style_not_purchasable',
      `Art style "${artStyle}" is preview-only and can't be ordered yet.`,
    );
  }

  // Type narrowing — checkDraftCompleteness has guaranteed these are
  // strings, but TS can't see through the runtime check. Assert via
  // non-null after the guard rather than scattering `!`s through the
  // line_items shape.
  const childName = draft.child_name as string;
  const theme = draft.theme as string;

  const price = calculatePrice({
    secondaries: Array.isArray(draft.secondaries)
      ? (draft.secondaries as Array<{ extra_care?: boolean }>).map((s) => ({
          extra_care: s.extra_care === true,
        }))
      : [],
  });

  const origin = (process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000').replace(/\/$/, '');

  const stripe = getStripe();
  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    line_items: [
      {
        price_data: {
          currency: PRICING.CURRENCY,
          product_data: {
            name: `A book for ${childName}`,
            description: theme.length > 200 ? `${theme.slice(0, 200)}…` : theme,
          },
          unit_amount: price.total,
        },
        quantity: 1,
      },
    ],
    success_url: `${origin}/start/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/start/payment`,
    customer_email: draft.customer_email ?? undefined,
    metadata: {
      draft_id: draft.id,
      cookie_id: draft.cookie_id,
    },
  });

  if (!session.url) {
    throw new CheckoutError('stripe_session_no_url');
  }

  redirect(session.url);
}
