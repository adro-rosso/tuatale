/**
 * Unit tests for the createCheckoutSession Server Action.
 *
 * Mocks `getStripe()` at the module boundary so no live Stripe API call
 * is made. Each test asserts a single concern: which CheckoutError
 * subreason fires for each guard, which fields land in the Stripe
 * session payload, and which URL the action redirects to.
 *
 * The action redirects via next/navigation.redirect — we stub that to
 * throw a sentinel so we can capture the URL without exercising
 * Next.js's redirect machinery.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { redirectSpy, cookieValue, draftStore, stripeSessionsCreate } = vi.hoisted(() => ({
  redirectSpy: vi.fn(),
  cookieValue: { current: null as string | null },
  draftStore: { current: null as Record<string, unknown> | null },
  stripeSessionsCreate: vi.fn(),
}));

class RedirectSentinel extends Error {
  constructor(public readonly url: string) {
    super(`REDIRECT:${url}`);
    this.name = 'RedirectSentinel';
  }
}

vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    redirectSpy(url);
    throw new RedirectSentinel(url);
  },
}));

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({
    get: (name: string) =>
      name === 'tuatale_draft_id' && cookieValue.current
        ? { name, value: cookieValue.current }
        : undefined,
  })),
}));

vi.mock('@/db/drafts', () => ({
  getDraftByCookieId: vi.fn(async () => draftStore.current),
}));

vi.mock('@/lib/stripe', () => ({
  getStripe: () => ({
    checkout: { sessions: { create: stripeSessionsCreate } },
  }),
}));

import { createCheckoutSession } from '@/app/start/_actions/create-checkout-session';
import { CheckoutError } from '@/app/start/_actions/errors';

function completeDraft(overrides: Record<string, unknown> = {}) {
  return {
    id: 'draft-uuid-1',
    cookie_id: 'cookie-uuid-1',
    child_name: 'Iris',
    age_range: '5-7',
    child_gender: 'girl',
    child_appearance:
      'Iris has curly brown hair just past her shoulders, brown eyes, and a small gap between her two front teeth.',
    theme: 'Iris discovers a tiny door at the back of the garden shed.',
    customer_email: null,
    secondaries: [],
    status: 'active',
    current_step: 'payment',
    ...overrides,
  };
}

describe('createCheckoutSession', () => {
  beforeEach(() => {
    redirectSpy.mockClear();
    stripeSessionsCreate.mockReset();
    cookieValue.current = null;
    draftStore.current = null;
    process.env.NEXT_PUBLIC_SITE_URL = 'https://tuatale.vercel.app';
  });

  it('throws CheckoutError(no_cookie) when the request has no draft cookie', async () => {
    cookieValue.current = null;
    await expect(createCheckoutSession()).rejects.toBeInstanceOf(CheckoutError);
    await expect(createCheckoutSession()).rejects.toMatchObject({ reason: 'no_cookie' });
    expect(stripeSessionsCreate).not.toHaveBeenCalled();
  });

  it('throws CheckoutError(no_draft) when cookie is present but no active draft', async () => {
    cookieValue.current = 'cookie-uuid-1';
    draftStore.current = null;
    await expect(createCheckoutSession()).rejects.toMatchObject({
      name: 'CheckoutError',
      reason: 'no_draft',
    });
    expect(stripeSessionsCreate).not.toHaveBeenCalled();
  });

  it('throws CheckoutError(draft_incomplete) when required fields are missing', async () => {
    cookieValue.current = 'cookie-uuid-1';
    draftStore.current = completeDraft({ theme: null });
    await expect(createCheckoutSession()).rejects.toMatchObject({
      name: 'CheckoutError',
      reason: 'draft_incomplete',
    });
    expect(stripeSessionsCreate).not.toHaveBeenCalled();
  });

  it('throws CheckoutError(style_not_purchasable) for a preview-only style — BEFORE creating the session (no charge)', async () => {
    cookieValue.current = 'cookie-uuid-1';
    draftStore.current = completeDraft({ art_style: 'painterly' }); // preview-only until W-E
    await expect(createCheckoutSession()).rejects.toMatchObject({
      name: 'CheckoutError',
      reason: 'style_not_purchasable',
    });
    expect(stripeSessionsCreate).not.toHaveBeenCalled(); // gated pre-payment
  });

  it('allows checkout for the purchasable watercolour style', async () => {
    cookieValue.current = 'cookie-uuid-1';
    draftStore.current = completeDraft({ art_style: 'watercolour' });
    stripeSessionsCreate.mockResolvedValue({ id: 'cs_wc', url: 'https://checkout.stripe.com/c/pay/cs_wc' });
    await expect(createCheckoutSession()).rejects.toBeInstanceOf(RedirectSentinel);
    expect(stripeSessionsCreate).toHaveBeenCalledTimes(1);
  });

  it('creates a Stripe session with correct line items and metadata, then redirects', async () => {
    cookieValue.current = 'cookie-uuid-1';
    draftStore.current = completeDraft();
    stripeSessionsCreate.mockResolvedValue({
      id: 'cs_test_abc',
      url: 'https://checkout.stripe.com/c/pay/cs_test_abc',
    });

    await expect(createCheckoutSession()).rejects.toBeInstanceOf(RedirectSentinel);

    expect(stripeSessionsCreate).toHaveBeenCalledTimes(1);
    const payload = stripeSessionsCreate.mock.calls[0]![0]!;
    expect(payload.mode).toBe('payment');
    expect(payload.line_items).toHaveLength(1);
    expect(payload.line_items[0].price_data.currency).toBe('aud');
    expect(payload.line_items[0].price_data.unit_amount).toBe(7900); // $79 base, no secondaries
    expect(payload.line_items[0].price_data.product_data.name).toBe('A book for Iris');
    expect(payload.metadata).toEqual({
      draft_id: 'draft-uuid-1',
      cookie_id: 'cookie-uuid-1',
    });
    expect(payload.success_url).toBe(
      'https://tuatale.vercel.app/start/success?session_id={CHECKOUT_SESSION_ID}',
    );
    expect(payload.cancel_url).toBe('https://tuatale.vercel.app/start/payment');

    expect(redirectSpy).toHaveBeenCalledWith('https://checkout.stripe.com/c/pay/cs_test_abc');
  });

  it('passes customer_email when the draft has one', async () => {
    cookieValue.current = 'cookie-uuid-1';
    draftStore.current = completeDraft({ customer_email: 'parent@example.com' });
    stripeSessionsCreate.mockResolvedValue({
      id: 'cs_test_def',
      url: 'https://checkout.stripe.com/c/pay/cs_test_def',
    });
    await expect(createCheckoutSession()).rejects.toBeInstanceOf(RedirectSentinel);
    expect(stripeSessionsCreate.mock.calls[0]![0]!.customer_email).toBe('parent@example.com');
  });

  it('passes customer_email undefined (not null) when the draft has none — Stripe will collect it', async () => {
    cookieValue.current = 'cookie-uuid-1';
    draftStore.current = completeDraft({ customer_email: null });
    stripeSessionsCreate.mockResolvedValue({
      id: 'cs_test_ghi',
      url: 'https://checkout.stripe.com/c/pay/cs_test_ghi',
    });
    await expect(createCheckoutSession()).rejects.toBeInstanceOf(RedirectSentinel);
    expect(stripeSessionsCreate.mock.calls[0]![0]!.customer_email).toBeUndefined();
  });

  it('truncates the theme description at 200 chars with an ellipsis', async () => {
    cookieValue.current = 'cookie-uuid-1';
    const longTheme = 'A'.repeat(300);
    draftStore.current = completeDraft({ theme: longTheme });
    stripeSessionsCreate.mockResolvedValue({
      id: 'cs_test_jkl',
      url: 'https://checkout.stripe.com/c/pay/cs_test_jkl',
    });
    await expect(createCheckoutSession()).rejects.toBeInstanceOf(RedirectSentinel);
    const description = stripeSessionsCreate.mock.calls[0]![0]!.line_items[0].price_data
      .product_data.description as string;
    expect(description.length).toBe(201); // 200 chars + ellipsis
    expect(description.endsWith('…')).toBe(true);
  });

  it('factors in secondaries when computing the line item total', async () => {
    cookieValue.current = 'cookie-uuid-1';
    draftStore.current = completeDraft({
      secondaries: [{ extra_care: false }, { extra_care: true }],
    });
    stripeSessionsCreate.mockResolvedValue({
      id: 'cs_test_mno',
      url: 'https://checkout.stripe.com/c/pay/cs_test_mno',
    });
    await expect(createCheckoutSession()).rejects.toBeInstanceOf(RedirectSentinel);
    // 7900 base + 2*1500 secondaries + 1*1000 extra_care = 11900
    expect(stripeSessionsCreate.mock.calls[0]![0]!.line_items[0].price_data.unit_amount).toBe(
      11900,
    );
  });

  it('throws CheckoutError(stripe_session_no_url) when Stripe returns a session without a url', async () => {
    cookieValue.current = 'cookie-uuid-1';
    draftStore.current = completeDraft();
    stripeSessionsCreate.mockResolvedValue({ id: 'cs_test_pqr', url: null });
    await expect(createCheckoutSession()).rejects.toMatchObject({
      name: 'CheckoutError',
      reason: 'stripe_session_no_url',
    });
    expect(redirectSpy).not.toHaveBeenCalled();
  });
});
