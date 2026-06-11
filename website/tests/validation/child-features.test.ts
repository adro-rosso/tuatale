/**
 * Structured character features — Zod (Spec: structured inputs, 2026-06-11).
 * childFeaturesSchema enums, the structured-complete-OR-freetext requirement,
 * and the gender-gated hair_style rule.
 */
import { describe, it, expect } from 'vitest';
import { childSchema, childFeaturesSchema, VALIDATION_COPY } from '@/lib/validation/schemas';

const base = { name: 'Iris', age_range: '5-7' as const, gender: 'girl' as const };
const complete = { hair_colour: 'brown', hair_style: 'tousled', skin_tone: 'tan', eye_colour: 'brown' } as const;

describe('childFeaturesSchema', () => {
  it('accepts valid features incl outfit + marks (region defaulted)', () => {
    const r = childFeaturesSchema.safeParse({
      ...complete, glasses: 'yes', build: 'sturdy',
      outfit: { tee: 'green', shorts: 'khaki', shoes: 'brown-boots' },
      marks: [{ type: 'mole', side: 'left' }],
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.marks?.[0]?.region).toBe('cheek');
  });
  it('rejects out-of-contract enum values', () => {
    expect(childFeaturesSchema.safeParse({ hair_colour: 'rainbow' }).success).toBe(false);
    expect(childFeaturesSchema.safeParse({ skin_tone: 'lilac' }).success).toBe(false);
    expect(childFeaturesSchema.safeParse({ outfit: { tee: 'plaid' } }).success).toBe(false);
    expect(childFeaturesSchema.safeParse({ marks: [{ type: 'tattoo', side: 'left' }] }).success).toBe(false);
  });
  it('all axes optional (empty object valid)', () => {
    expect(childFeaturesSchema.safeParse({}).success).toBe(true);
  });
});

describe('childSchema — structured/free-text requirement', () => {
  it('structured-complete + empty appearance → valid', () => {
    expect(childSchema.safeParse({ ...base, appearance: '', features: complete }).success).toBe(true);
  });
  it('structured-complete + no appearance field → valid', () => {
    expect(childSchema.safeParse({ ...base, features: complete }).success).toBe(true);
  });
  it('structured-incomplete (3 axes) + short appearance → invalid (APPEARANCE_OR_BUILD)', () => {
    const r = childSchema.safeParse({
      ...base, appearance: 'x'.repeat(10),
      features: { hair_colour: 'brown', hair_style: 'tousled', skin_tone: 'tan' },
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.some((i) => i.message === VALIDATION_COPY.APPEARANCE_OR_BUILD)).toBe(true);
    }
  });
  it('free-text >=50 + no features → valid (legacy path preserved)', () => {
    expect(childSchema.safeParse({ ...base, appearance: 'x'.repeat(50) }).success).toBe(true);
  });
});

describe('childSchema — gender-gated hair_style', () => {
  it('boy + long → invalid at features.hair_style', () => {
    const r = childSchema.safeParse({ name: 'Sam', age_range: '5-7', gender: 'boy', features: { ...complete, hair_style: 'long' } });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(
        r.error.issues.some(
          (i) => i.path.join('.') === 'features.hair_style' && i.message === VALIDATION_COPY.HAIR_STYLE_NOT_FOR_BOYS,
        ),
      ).toBe(true);
    }
  });
  it('boy + buzzed → valid', () => {
    expect(childSchema.safeParse({ name: 'Sam', age_range: '5-7', gender: 'boy', features: { ...complete, hair_style: 'buzzed' } }).success).toBe(true);
  });
  it('girl + long → valid', () => {
    expect(childSchema.safeParse({ ...base, features: { ...complete, hair_style: 'long' } }).success).toBe(true);
  });
});
