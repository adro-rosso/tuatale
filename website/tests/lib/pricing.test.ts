/**
 * Pricing calculator tests — verify the placeholder numbers add up.
 *
 * Spec scenarios (Phase 2.C.3):
 *   - base only:                $79.00
 *   - 1 secondary, no extra:    $94.00
 *   - 2 secondaries, 1 extra:   $79 + $30 + $10 = $119
 *   - 3 secondaries, all extra: $79 + $45 + $30 = $154
 */
import { describe, it, expect } from 'vitest';
import { calculatePrice, formatPrice, PRICING } from '@/lib/pricing';

describe('calculatePrice', () => {
  it('returns base price only when draft has no secondaries', () => {
    const result = calculatePrice({});
    expect(result.base).toBe(7900);
    expect(result.secondaries_count).toBe(0);
    expect(result.secondaries_total).toBe(0);
    expect(result.extra_care_count).toBe(0);
    expect(result.extra_care_total).toBe(0);
    expect(result.subtotal).toBe(7900);
    expect(result.shipping).toBe(0);
    expect(result.total).toBe(7900);
    expect(result.line_items).toHaveLength(1);
    expect(result.line_items[0]).toEqual({ label: 'Your book', cents: 7900 });
  });

  it('one secondary, no extra care → $94', () => {
    const result = calculatePrice({
      secondaries: [{ extra_care: false }],
    });
    expect(result.secondaries_count).toBe(1);
    expect(result.secondaries_total).toBe(1500);
    expect(result.extra_care_count).toBe(0);
    expect(result.total).toBe(9400);
    expect(result.line_items).toHaveLength(2);
    expect(result.line_items[1]).toEqual({ label: '1 character', cents: 1500 });
  });

  it('two secondaries, one with extra care → $119', () => {
    const result = calculatePrice({
      secondaries: [{ extra_care: false }, { extra_care: true }],
    });
    expect(result.secondaries_count).toBe(2);
    expect(result.secondaries_total).toBe(3000);
    expect(result.extra_care_count).toBe(1);
    expect(result.extra_care_total).toBe(1000);
    expect(result.total).toBe(11900);
    expect(result.line_items.find((l) => l.label.startsWith('Extra'))).toEqual({
      label: 'Extra care (1)',
      cents: 1000,
    });
  });

  it('three secondaries, all extra care → $154', () => {
    const result = calculatePrice({
      secondaries: [{ extra_care: true }, { extra_care: true }, { extra_care: true }],
    });
    expect(result.secondaries_count).toBe(3);
    expect(result.secondaries_total).toBe(4500);
    expect(result.extra_care_count).toBe(3);
    expect(result.extra_care_total).toBe(3000);
    expect(result.total).toBe(15400);
  });

  it('pluralises label correctly: 2+ characters', () => {
    const result = calculatePrice({
      secondaries: [{ extra_care: false }, { extra_care: false }],
    });
    expect(result.line_items.find((l) => l.label.includes('character'))?.label).toBe(
      '2 characters',
    );
  });

  it('skips extra-care line when no secondaries marked', () => {
    const result = calculatePrice({
      secondaries: [{ extra_care: false }],
    });
    expect(result.line_items.find((l) => l.label.startsWith('Extra'))).toBeUndefined();
  });

  it('skips shipping line when shipping is 0', () => {
    const result = calculatePrice({});
    expect(result.line_items.find((l) => l.label === 'Shipping')).toBeUndefined();
  });
});

describe('formatPrice', () => {
  it('formats whole dollars as $79.00', () => {
    expect(formatPrice(7900)).toBe('$79.00');
  });

  it('formats zero as $0.00', () => {
    expect(formatPrice(0)).toBe('$0.00');
  });

  it('formats cents-fractional amounts', () => {
    expect(formatPrice(11999)).toBe('$119.99');
  });

  it('respects an explicit currency arg', () => {
    expect(formatPrice(10000, PRICING.CURRENCY)).toBe('$100.00');
  });
});
