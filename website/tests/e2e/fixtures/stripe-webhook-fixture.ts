/**
 * Builds a signed checkout.session.completed event for the e2e test
 * to POST at /api/stripe/webhook. Same pattern as Phase 2.E's
 * tests/api/stripe-webhook.test.ts — Stripe's webhook signature is
 * pure HMAC, so we forge a valid signature against the dev server's
 * configured STRIPE_WEBHOOK_SECRET without going through real
 * Stripe Checkout.
 *
 * The dev server's env (set by playwright.config.ts:webServer.env)
 * uses sk_test_dummy + whsec_test_dummy_secret — same dummies the
 * existing Stripe webhook unit test uses.
 */
import Stripe from 'stripe';
import { randomUUID } from 'node:crypto';

export const E2E_STRIPE_SECRET_KEY = 'sk_test_dummy';
export const E2E_STRIPE_WEBHOOK_SECRET = 'whsec_test_dummy_secret';

export interface CheckoutCompletedFixtureInput {
  draftId: string;
  cookieId: string;
  amountCents: number;
  customerEmail: string;
  sessionId?: string;
}

export interface CheckoutCompletedFixture {
  sessionId: string;
  paymentIntentId: string;
  payload: string;
  signature: string;
}

export function buildCheckoutCompletedEvent(
  input: CheckoutCompletedFixtureInput,
): CheckoutCompletedFixture {
  const sessionId = input.sessionId ?? `cs_test_${randomUUID().replace(/-/g, '').slice(0, 24)}`;
  const paymentIntentId = `pi_test_${randomUUID().replace(/-/g, '').slice(0, 24)}`;
  const createdAt = Math.floor(Date.now() / 1000);

  const event = {
    id: `evt_test_${randomUUID().replace(/-/g, '').slice(0, 24)}`,
    object: 'event',
    type: 'checkout.session.completed',
    api_version: '2026-05-27.dahlia',
    created: createdAt,
    data: {
      object: {
        id: sessionId,
        object: 'checkout.session',
        amount_total: input.amountCents,
        currency: 'aud',
        customer_email: null,
        customer_details: { email: input.customerEmail },
        payment_intent: paymentIntentId,
        payment_status: 'paid',
        status: 'complete',
        created: createdAt,
        metadata: {
          draft_id: input.draftId,
          cookie_id: input.cookieId,
        },
      },
    },
  };

  const payload = JSON.stringify(event);
  const stripe = new Stripe(E2E_STRIPE_SECRET_KEY, {
    apiVersion: '2026-05-27.dahlia',
    typescript: true,
  });
  const signature = stripe.webhooks.generateTestHeaderString({
    payload,
    secret: E2E_STRIPE_WEBHOOK_SECRET,
  });

  return { sessionId, paymentIntentId, payload, signature };
}
