/**
 * The substance bar that decides whether a draft is parked/listed or silently discarded:
 * past the character step (secondaries+) OR any main photo uploaded.
 */
import { describe, it, expect } from 'vitest';
import {
  draftHasSubstance,
  isPastCharacterStep,
  hasAnyMainPhoto,
} from '@/lib/draft-substance';

describe('isPastCharacterStep', () => {
  it('steps at/before the character step (child) are NOT past it', () => {
    expect(isPastCharacterStep('hero')).toBe(false);
    expect(isPastCharacterStep('style')).toBe(false);
    expect(isPastCharacterStep('child')).toBe(false); // on the character step, not past it
  });
  it('secondaries and later ARE past the character step', () => {
    expect(isPastCharacterStep('secondaries')).toBe(true);
    expect(isPastCharacterStep('theme')).toBe(true);
    expect(isPastCharacterStep('preview')).toBe(true);
    expect(isPastCharacterStep('review')).toBe(true);
    expect(isPastCharacterStep('payment')).toBe(true);
  });
  it('null / unknown steps are not past it', () => {
    expect(isPastCharacterStep(null)).toBe(false);
    expect(isPastCharacterStep(undefined)).toBe(false);
    expect(isPastCharacterStep('bogus')).toBe(false);
  });
});

describe('hasAnyMainPhoto', () => {
  it('true when a role holds a non-empty array', () => {
    expect(hasAnyMainPhoto({ child: ['uploads/x.png'] })).toBe(true);
    expect(hasAnyMainPhoto({ pet: ['uploads/p.png'] })).toBe(true);
    expect(hasAnyMainPhoto({ adult: ['uploads/a.png'] })).toBe(true);
  });
  it('false for the empty/absent shapes', () => {
    expect(hasAnyMainPhoto({})).toBe(false); // photos removed → {}
    expect(hasAnyMainPhoto({ child: [] })).toBe(false); // empty role array
    expect(hasAnyMainPhoto(null)).toBe(false);
    expect(hasAnyMainPhoto(undefined)).toBe(false);
    expect(hasAnyMainPhoto('nope')).toBe(false);
    expect(hasAnyMainPhoto(['x'])).toBe(false); // array, not a role object
  });
});

describe('draftHasSubstance — either clause is enough', () => {
  it('past the character step alone qualifies (no photos)', () => {
    expect(draftHasSubstance({ current_step: 'secondaries', photo_urls: {} })).toBe(true);
  });
  it('a main photo alone qualifies even on the character step', () => {
    // pet book: still on the character step, but a pet photo is already in → effort worth keeping
    expect(draftHasSubstance({ current_step: 'child', photo_urls: { pet: ['uploads/p.png'] } })).toBe(true);
  });
  it('barely-touched draft (early step, no photos) is below the bar → discardable', () => {
    expect(draftHasSubstance({ current_step: 'style', photo_urls: {} })).toBe(false);
    expect(draftHasSubstance({ current_step: 'child', photo_urls: {} })).toBe(false);
    expect(draftHasSubstance({ current_step: null, photo_urls: {} })).toBe(false);
  });
});
