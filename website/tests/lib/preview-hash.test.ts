/**
 * Preview input-hash — the cache key (S-C / S-E cost control). Identical inputs
 * must hash identically (cache hit); trivially-different-but-equivalent inputs too.
 */
import { describe, it, expect } from 'vitest';
import { computeInputHash } from '@/lib/preview/hash';

describe('computeInputHash', () => {
  it('is stable for identical inputs', () => {
    const a = { age: 7, gender: 'girl', features: { hair_colour: 'brown', eye_colour: 'green' }, freeText: 'freckles' };
    expect(computeInputHash(a)).toBe(computeInputHash({ ...a, features: { ...a.features } }));
  });

  it('ignores feature key ORDER (sorted) and empty values', () => {
    const h1 = computeInputHash({ age: 7, features: { hair_colour: 'brown', eye_colour: 'green', skin_tone: '' } });
    const h2 = computeInputHash({ age: 7, features: { eye_colour: 'green', hair_colour: 'brown' } });
    expect(h1).toBe(h2);
  });

  it('trims free text', () => {
    expect(computeInputHash({ age: 7, freeText: '  hi  ' })).toBe(computeInputHash({ age: 7, freeText: 'hi' }));
  });

  it('differs when a real input changes', () => {
    const base = { age: 7, features: { eye_colour: 'green' } };
    expect(computeInputHash(base)).not.toBe(computeInputHash({ ...base, features: { eye_colour: 'blue' } }));
    expect(computeInputHash(base)).not.toBe(computeInputHash({ ...base, age: 8 }));
    expect(computeInputHash(base)).not.toBe(computeInputHash({ ...base, photoHash: 'abc' }));
  });

  it('W-F: style is part of the key — switching style re-mints', () => {
    const base = { age: 7, features: { eye_colour: 'green' } };
    expect(computeInputHash({ ...base, style: 'watercolour' })).not.toBe(
      computeInputHash({ ...base, style: 'cutpaper' }),
    );
  });

  it('W-F: absent style === explicit watercolour (shared default cache slot)', () => {
    const base = { age: 7, features: { eye_colour: 'green' } };
    expect(computeInputHash(base)).toBe(computeInputHash({ ...base, style: 'watercolour' }));
  });

  // Slice 2: adult vs child/pet render differently, so isAdult keys the cache.
  it('isAdult keys the cache (adult vs child differ)', () => {
    const base = { age: 40, style: 'watercolour' };
    expect(computeInputHash(base)).not.toBe(computeInputHash({ ...base, isAdult: true }));
  });
  it('absent isAdult === explicit false (child/pet byte-identical cache slot)', () => {
    const base = { age: 6, style: 'watercolour' };
    expect(computeInputHash(base)).toBe(computeInputHash({ ...base, isAdult: false }));
  });

  // Character-picker (Slice 2): the variant dimension.
  it('BYTE-IDENTICAL: absent variant === the pre-picker key (single-preview path unchanged)', () => {
    const base = { age: 6, style: 'watercolour', features: { eye_colour: 'green' } };
    expect(computeInputHash(base)).toBe(computeInputHash({ ...base, variant: undefined }));
  });
  it('distinct variants → distinct hashes (N options do NOT collapse to one cache slot)', () => {
    const base = { age: 6, style: 'watercolour' };
    const h0 = computeInputHash({ ...base, variant: 'batch-1:0' });
    const h1 = computeInputHash({ ...base, variant: 'batch-1:1' });
    const h2 = computeInputHash({ ...base, variant: 'batch-1:2' });
    expect(new Set([h0, h1, h2]).size).toBe(3);
    // a different batch is a different set of slots (fresh dice on regenerate)
    expect(h0).not.toBe(computeInputHash({ ...base, variant: 'batch-2:0' }));
  });
});
