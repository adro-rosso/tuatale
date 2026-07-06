/**
 * Unit tests for the draft -> order snapshot mapping.
 *
 * Doesn't hit the DB — mocks createOrder at the boundary so we can
 * assert the exact OrderInsert payload built from a (draft, stripeSession)
 * pair. Each test pins one mapping rule so regressions are easy to
 * read.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type Stripe from 'stripe';

const { createOrderSpy } = vi.hoisted(() => ({ createOrderSpy: vi.fn() }));

vi.mock('@/db/orders', () => ({
  createOrder: createOrderSpy,
}));

import { createOrderFromDraft } from '@/lib/checkout/create-order';

function fakeDraft(overrides: Record<string, unknown> = {}) {
  return {
    id: 'draft-uuid-1',
    cookie_id: 'cookie-uuid-1',
    status: 'active',
    created_at: '2026-06-01T00:00:00Z',
    updated_at: '2026-06-01T00:00:00Z',
    expires_at: '2026-07-01T00:00:00Z',
    current_step: 'payment',
    child_name: 'Iris',
    age_range: '5-7',
    child_age: null,
    child_gender: 'girl',
    child_appearance: 'curly brown hair, blue eyes',
    secondaries: [],
    theme: 'Iris finds a tiny door at the back of the garden shed.',
    theme_template_id: 'adventure_hidden_world',
    customer_email: null,
    estimated_price_cents: null,
    converted_to_order_id: null,
    photo_urls: [],
    photo_consent_at: null,
    character_generation_mode: 'text_only',
    ...overrides,
  };
}

function fakeStripeSession(
  overrides: Partial<Stripe.Checkout.Session> = {},
): Stripe.Checkout.Session {
  return {
    id: 'cs_test_xyz',
    amount_total: 9400, // base + 1 secondary
    currency: 'aud',
    customer_details: { email: 'parent@example.com' },
    customer_email: null,
    payment_intent: 'pi_test_xyz',
    created: 1717000000,
    metadata: { draft_id: 'draft-uuid-1', cookie_id: 'cookie-uuid-1' },
    ...overrides,
  } as Stripe.Checkout.Session;
}

describe('createOrderFromDraft', () => {
  beforeEach(() => {
    createOrderSpy.mockReset();
    createOrderSpy.mockResolvedValue({ id: 'order-uuid-1' });
  });

  it('snapshots all NOT-NULL order columns from the draft + stripe session', async () => {
    const draft = fakeDraft();
    const session = fakeStripeSession();
    await createOrderFromDraft({ draft: draft as never, stripeSession: session });
    const payload = createOrderSpy.mock.calls[0]![0]!;
    expect(payload.customer_email).toBe('parent@example.com');
    expect(payload.child_name).toBe('Iris');
    expect(payload.age_range).toBe('5-7');
    // Midpoint of the 5-7 bucket.
    expect(payload.child_age).toBe(6);
    expect(payload.child_gender).toBe('girl');
    expect(payload.theme).toBe(draft.theme);
    expect(payload.stripe_session_id).toBe('cs_test_xyz');
    expect(payload.stripe_payment_intent_id).toBe('pi_test_xyz');
    expect(payload.amount_paid_cents).toBe(9400);
    expect(payload.currency).toBe('aud');
    expect(payload.converted_from_draft_id).toBe('draft-uuid-1');
  });

  it('maps age_range -> child_age via the documented midpoints', async () => {
    for (const [range, midpoint] of [
      ['3-5', 4],
      ['5-7', 6],
      ['7-9', 8],
    ] as const) {
      createOrderSpy.mockClear();
      createOrderSpy.mockResolvedValue({ id: 'order' });
      await createOrderFromDraft({
        draft: fakeDraft({ age_range: range }) as never,
        stripeSession: fakeStripeSession(),
      });
      expect(createOrderSpy.mock.calls[0]![0]!.child_age).toBe(midpoint);
    }
  });

  it('prefers stripe customer_details.email over the draft email', async () => {
    await createOrderFromDraft({
      draft: fakeDraft({ customer_email: 'draft-fallback@example.com' }) as never,
      stripeSession: fakeStripeSession({
        customer_details: { email: 'stripe-typed@example.com' } as never,
      }),
    });
    expect(createOrderSpy.mock.calls[0]![0]!.customer_email).toBe('stripe-typed@example.com');
  });

  it('falls back to draft.customer_email when Stripe has neither customer_details nor customer_email', async () => {
    await createOrderFromDraft({
      draft: fakeDraft({ customer_email: 'draft-fallback@example.com' }) as never,
      stripeSession: fakeStripeSession({ customer_details: null, customer_email: null }),
    });
    expect(createOrderSpy.mock.calls[0]![0]!.customer_email).toBe('draft-fallback@example.com');
  });

  it('throws when neither Stripe nor draft has an email', async () => {
    await expect(
      createOrderFromDraft({
        draft: fakeDraft({ customer_email: null }) as never,
        stripeSession: fakeStripeSession({ customer_details: null, customer_email: null }),
      }),
    ).rejects.toThrow(/no customer email/i);
    expect(createOrderSpy).not.toHaveBeenCalled();
  });

  it('throws when the draft is missing required fields', async () => {
    await expect(
      createOrderFromDraft({
        draft: fakeDraft({ theme: null }) as never,
        stripeSession: fakeStripeSession(),
      }),
    ).rejects.toThrow(/missing required fields/i);
    expect(createOrderSpy).not.toHaveBeenCalled();
  });

  it('copies a custom dedication_message into the order payload', async () => {
    await createOrderFromDraft({
      draft: fakeDraft({ dedication_message: 'For Iris, with love from Grandma.' }) as never,
      stripeSession: fakeStripeSession(),
    });
    expect(createOrderSpy.mock.calls[0]![0]!.dedication_message).toBe('For Iris, with love from Grandma.');
  });

  it('dedication_message → null when the draft has none (renders the auto-default)', async () => {
    await createOrderFromDraft({ draft: fakeDraft() as never, stripeSession: fakeStripeSession() });
    expect(createOrderSpy.mock.calls[0]![0]!.dedication_message).toBeNull();
  });

  it('copies the child background/heritage into the order payload', async () => {
    await createOrderFromDraft({
      draft: fakeDraft({ background: 'mixed Korean and Irish' }) as never,
      stripeSession: fakeStripeSession(),
    });
    expect(createOrderSpy.mock.calls[0]![0]!.background).toBe('mixed Korean and Irish');
  });

  it('background → null when the draft has none', async () => {
    await createOrderFromDraft({ draft: fakeDraft() as never, stripeSession: fakeStripeSession() });
    expect(createOrderSpy.mock.calls[0]![0]!.background).toBeNull();
  });

  it('copies an overridden reading_level into the order payload', async () => {
    await createOrderFromDraft({
      draft: fakeDraft({ reading_level: 'advanced' }) as never,
      stripeSession: fakeStripeSession(),
    });
    expect(createOrderSpy.mock.calls[0]![0]!.reading_level).toBe('advanced');
  });

  it('reading_level → null when untouched (worker derives from the age band)', async () => {
    await createOrderFromDraft({ draft: fakeDraft() as never, stripeSession: fakeStripeSession() });
    expect(createOrderSpy.mock.calls[0]![0]!.reading_level).toBeNull();
  });

  it('copies child_features into the order payload', async () => {
    const features = { hair_colour: 'brown', hair_style: 'tousled', skin_tone: 'tan', eye_colour: 'brown' };
    await createOrderFromDraft({
      draft: fakeDraft({ child_features: features }) as never,
      stripeSession: fakeStripeSession(),
    });
    expect(createOrderSpy.mock.calls[0]![0]!.child_features).toEqual(features);
  });

  it('structured-complete draft with NO free-text appearance passes the guard', async () => {
    await createOrderFromDraft({
      draft: fakeDraft({
        child_appearance: null,
        child_features: { hair_colour: 'blonde', hair_style: 'long', skin_tone: 'fair', eye_colour: 'blue' },
      }) as never,
      stripeSession: fakeStripeSession(),
    });
    expect(createOrderSpy).toHaveBeenCalledTimes(1);
    expect(createOrderSpy.mock.calls[0]![0]!.child_appearance).toBeNull();
  });

  it('throws when NEITHER appearance NOR a structured-complete character is present', async () => {
    await expect(
      createOrderFromDraft({
        draft: fakeDraft({ child_appearance: null, child_features: null }) as never,
        stripeSession: fakeStripeSession(),
      }),
    ).rejects.toThrow(/missing required fields/i);
    expect(createOrderSpy).not.toHaveBeenCalled();
  });

  it('handles payment_intent as either a string or an expanded object', async () => {
    await createOrderFromDraft({
      draft: fakeDraft() as never,
      stripeSession: fakeStripeSession({
        payment_intent: { id: 'pi_expanded_123' } as never,
      }),
    });
    expect(createOrderSpy.mock.calls[0]![0]!.stripe_payment_intent_id).toBe('pi_expanded_123');
  });
});
