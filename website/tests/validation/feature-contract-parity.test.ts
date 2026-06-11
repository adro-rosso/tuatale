/**
 * DRIFT GUARD — the website Zod enums MUST exactly mirror the canonical contract
 * in src/character-features.js (consumed by the worker adapter + pipeline). The
 * production Zod can't import the root src module without breaking the website
 * build (cross-rootDir), so it mirrors the values; this vitest test imports the
 * canonical constants at runtime and asserts EXACT equality. Any drift fails here.
 */
import { describe, it, expect } from 'vitest';
import {
  FEATURE_VALUES,
  OUTFIT_VALUES,
  MARK_VALUES,
  HAIR_STYLE_BY_GENDER,
} from '../../../src/character-features.js';
import {
  HAIR_COLOURS, HAIR_STYLES, BOY_HAIR_STYLES, SKIN_TONES, EYE_COLOURS, BUILDS,
  GLASSES_VALUES, TEE_COLOURS, SHORTS_COLOURS, SHOES, MARK_TYPES, MARK_SIDES,
} from '@/lib/validation/schemas';

describe('feature contract parity: Zod enums === src/character-features.js', () => {
  it('descriptive axes match verbatim', () => {
    expect([...HAIR_COLOURS]).toEqual(FEATURE_VALUES.hair_colour);
    expect([...HAIR_STYLES]).toEqual(FEATURE_VALUES.hair_style);
    expect([...SKIN_TONES]).toEqual(FEATURE_VALUES.skin_tone);
    expect([...EYE_COLOURS]).toEqual(FEATURE_VALUES.eye_colour);
    expect([...BUILDS]).toEqual(FEATURE_VALUES.build);
    expect([...GLASSES_VALUES]).toEqual(FEATURE_VALUES.glasses);
  });
  it('outfit + marks match verbatim', () => {
    expect([...TEE_COLOURS]).toEqual(OUTFIT_VALUES.tee);
    expect([...SHORTS_COLOURS]).toEqual(OUTFIT_VALUES.shorts);
    expect([...SHOES]).toEqual(OUTFIT_VALUES.shoes);
    expect([...MARK_TYPES]).toEqual(MARK_VALUES.type);
    expect([...MARK_SIDES]).toEqual(MARK_VALUES.side);
  });
  it('gender-gated boy hair set matches', () => {
    expect([...BOY_HAIR_STYLES]).toEqual(HAIR_STYLE_BY_GENDER.boy);
  });
});
