/**
 * checkDraftCompleteness — the payment-gate completeness guard. Appearance is
 * satisfied by EITHER free-text OR a structured-complete character (the twin of
 * the create-order guard + the Zod rule). Spec: structured inputs 2026-06-11.
 */
import { describe, it, expect } from 'vitest';
import { checkDraftCompleteness } from '@/lib/checkout/draft-complete';
import type { Tables } from '@/types/database';

const base = {
  child_name: 'Iris',
  age_range: '5-7',
  child_gender: 'girl',
  theme: 'a tale',
  child_appearance: null,
  child_features: null,
} as unknown as Tables<'drafts'>;

const complete = { hair_colour: 'brown', hair_style: 'tousled', skin_tone: 'tan', eye_colour: 'brown' };

describe('checkDraftCompleteness — appearance OR structured-complete', () => {
  it('free-text appearance → complete', () => {
    expect(checkDraftCompleteness({ ...base, child_appearance: 'curly brown hair, blue eyes' }).complete).toBe(true);
  });
  it('structured-complete + no appearance → complete', () => {
    expect(checkDraftCompleteness({ ...base, child_features: complete as never }).complete).toBe(true);
  });
  it('neither → incomplete, flags child_appearance', () => {
    const r = checkDraftCompleteness(base);
    expect(r.complete).toBe(false);
    expect(r.missing).toContain('child_appearance');
  });
  it('structured-incomplete (3 axes) + no appearance → incomplete', () => {
    const r = checkDraftCompleteness({ ...base, child_features: { hair_colour: 'brown', hair_style: 'tousled', skin_tone: 'tan' } as never });
    expect(r.complete).toBe(false);
  });
  it('missing a core NOT-NULL field → incomplete', () => {
    expect(checkDraftCompleteness({ ...base, child_appearance: 'x'.repeat(50), theme: null as never }).complete).toBe(false);
  });
});

// ---- book_type='adult' (engine-activation wizard, Slice 1) -----------------
const adultBase = {
  book_type: 'adult',
  child_name: 'Marcus',
  child_age: 38,
  child_gender: 'boy',
  child_appearance: 'a man with a short grey beard and tortoiseshell glasses, solid build',
  theme: 'a birthday roast of a man who has a system for everything',
  age_range: null,
  reading_level: null,
} as unknown as Tables<'drafts'>;

describe('checkDraftCompleteness — adult books', () => {
  it('complete adult draft → complete (name/age/gender/appearance/theme, no age_range)', () => {
    expect(checkDraftCompleteness(adultBase).complete).toBe(true);
  });
  it('adult without an explicit age → incomplete, flags child_age', () => {
    const r = checkDraftCompleteness({ ...adultBase, child_age: null as never });
    expect(r.complete).toBe(false);
    expect(r.missing).toContain('child_age');
  });
  it('adult requires gender (unlike a pet)', () => {
    const r = checkDraftCompleteness({ ...adultBase, child_gender: null as never });
    expect(r.complete).toBe(false);
    expect(r.missing).toContain('child_gender');
  });
  it('adult does NOT require age_range (it has no child band)', () => {
    // age_range null on the base, yet complete — proves the adult branch does not gate on it.
    expect(checkDraftCompleteness(adultBase).missing).not.toContain('age_range');
  });
});
