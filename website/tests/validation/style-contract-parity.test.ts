/**
 * DRIFT GUARD — the website Zod STYLE_VALUES MUST exactly mirror the canonical
 * src/art-styles.js STYLE_VALUES (consumed by the worker adapter validateArtStyle
 * + the pipeline). Same pattern as feature-contract-parity: the production Zod
 * mirrors the values; this test imports the canonical list at runtime and asserts
 * EXACT equality + order. Any drift fails here.
 */
import { describe, it, expect } from 'vitest';
import { STYLE_VALUES as CANONICAL, DEFAULT_STYLE } from '../../../src/art-styles.js';
import { STYLE_VALUES, artStyleSchema } from '@/lib/validation/schemas';
import { STYLE_OPTIONS } from '@/lib/art-style-options';

describe('art-style contract parity: Zod STYLE_VALUES === src/art-styles.js', () => {
  it('matches the canonical list verbatim (values + order)', () => {
    expect([...STYLE_VALUES]).toEqual(CANONICAL);
  });

  it('the Zod default is the canonical DEFAULT_STYLE', () => {
    expect(artStyleSchema.parse(undefined)).toBe(DEFAULT_STYLE);
  });

  it('rejects an unknown style', () => {
    expect(artStyleSchema.safeParse('crayon').success).toBe(false);
  });

  it('W-F: the picker options cover exactly the validated styles (values + order)', () => {
    expect(STYLE_OPTIONS.map((o) => o.value)).toEqual([...STYLE_VALUES]);
  });
});
