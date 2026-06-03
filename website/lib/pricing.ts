/**
 * Phase 2.C placeholder pricing.
 *
 * Numbers chosen to feel reasonable for an AU consumer book at launch:
 * $79 base, $15 per added character, $10 per character marked
 * "extra care" (covers pets/toys with unusual markings that need an
 * actual sheet mint at tier-2 rather than the cheaper tier-1 soft
 * anchor). Shipping is 0 for now — vendor research will set this in a
 * later phase.
 *
 * The breakdown returned by `calculatePrice` is in CENTS to avoid float
 * arithmetic; the UI formats via `formatPrice` for display.
 */

export const PRICING = {
  BASE_BOOK_CENTS: 7900, // $79.00 AUD
  SECONDARY_CHARACTER_CENTS: 1500, // +$15.00 per added character
  EXTRA_CARE_PER_SECONDARY_CENTS: 1000, // +$10.00 per "render with extra care"
  SHIPPING_CENTS: 0, // placeholder, vendor research will fill
  CURRENCY: 'aud' as const,
};

export type Currency = typeof PRICING.CURRENCY;

interface PriceableSecondary {
  extra_care?: boolean;
}

export interface PriceableDraft {
  secondaries?: ReadonlyArray<PriceableSecondary>;
}

export interface PriceLineItem {
  label: string;
  cents: number;
}

export interface PriceBreakdown {
  base: number;
  secondaries_count: number;
  secondaries_total: number;
  extra_care_count: number;
  extra_care_total: number;
  subtotal: number;
  shipping: number;
  total: number;
  line_items: ReadonlyArray<PriceLineItem>;
}

export function calculatePrice(draft: PriceableDraft): PriceBreakdown {
  const secondaries = draft.secondaries ?? [];
  const secondariesCount = secondaries.length;
  const extraCareCount = secondaries.filter((s) => s.extra_care === true).length;

  const base = PRICING.BASE_BOOK_CENTS;
  const secondariesTotal = secondariesCount * PRICING.SECONDARY_CHARACTER_CENTS;
  const extraCareTotal = extraCareCount * PRICING.EXTRA_CARE_PER_SECONDARY_CENTS;
  const subtotal = base + secondariesTotal + extraCareTotal;
  const shipping = PRICING.SHIPPING_CENTS;
  const total = subtotal + shipping;

  // line_items drives the UI line list. Only include non-zero entries.
  const lineItems: PriceLineItem[] = [{ label: 'Your book', cents: base }];
  if (secondariesCount > 0) {
    lineItems.push({
      label: `${secondariesCount} ${secondariesCount === 1 ? 'character' : 'characters'}`,
      cents: secondariesTotal,
    });
  }
  if (extraCareCount > 0) {
    lineItems.push({
      label: `Extra care (${extraCareCount})`,
      cents: extraCareTotal,
    });
  }
  if (shipping > 0) {
    lineItems.push({ label: 'Shipping', cents: shipping });
  }

  return {
    base,
    secondaries_count: secondariesCount,
    secondaries_total: secondariesTotal,
    extra_care_count: extraCareCount,
    extra_care_total: extraCareTotal,
    subtotal,
    shipping,
    total,
    line_items: lineItems,
  };
}

/**
 * Format a cents value as a localised currency string.
 *
 * AU formatting: `$79.00`. Non-AU currencies will get whatever Intl
 * chooses for the locale (en-AU default). Cents are halved for negative
 * values via Math.abs since pricing is always >= 0 by design.
 */
export function formatPrice(cents: number, currency: Currency = PRICING.CURRENCY): string {
  const amount = cents / 100;
  return new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: currency.toUpperCase(),
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}
