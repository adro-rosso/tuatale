// A child reference photo satisfies the appearance requirement at checkout (2026-10-20) —
// the same contract the child-step validator (has_photo) and the post-payment guard use.
import { describe, it, expect } from 'vitest';
import { checkDraftCompleteness } from '@/lib/checkout/draft-complete';

const base = {
  book_type: 'child',
  child_name: 'Mia',
  age_range: '5-7',
  child_gender: 'girl',
  child_appearance: '',
  child_features: null,
  theme: 'A rainy-day adventure',
} as Record<string, unknown>;

describe('checkDraftCompleteness — child photos vs appearance', () => {
  it('no appearance, no features, no photo → child_appearance missing (unchanged)', () => {
    const r = checkDraftCompleteness({ ...base, photo_urls: {} } as never);
    expect(r.complete).toBe(false);
    expect(r.missing).toContain('child_appearance');
  });
  it('≥1 child photo → complete with nothing written', () => {
    const r = checkDraftCompleteness({ ...base, photo_urls: { child: ['uploads/d/a.png'] } } as never);
    expect(r.missing).not.toContain('child_appearance');
    expect(r.complete).toBe(true);
  });
  it('empty child photo array does NOT count', () => {
    const r = checkDraftCompleteness({ ...base, photo_urls: { child: [] } } as never);
    expect(r.missing).toContain('child_appearance');
  });
});
