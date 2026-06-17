/**
 * Deterministic input hash for the preview cache (S-C / S-E cost control).
 * Identical inputs → identical hash → cache hit → no regen, no spend.
 *
 * Normalization rules (so trivially-different inputs still hit):
 *   - features: drop empty values, sort keys
 *   - freeText: trimmed
 *   - style: the chosen art_style (absent → watercolour) — re-mints on style switch
 *   - STYLE_VERSION baked in so a gen-logic change invalidates old cached previews
 */
import { createHash } from 'node:crypto';
import type { PreviewInputs } from './types';

// Mirrors STYLE_VERSION in src/character-preview.js — bump both together.
export const PREVIEW_STYLE_VERSION = 1;

export function computeInputHash(inputs: PreviewInputs): string {
  const f = inputs.features ?? {};
  const features: Record<string, string> = {};
  for (const k of Object.keys(f).sort()) {
    if (f[k]) features[k] = f[k]!;
  }
  const normalized = {
    v: PREVIEW_STYLE_VERSION,
    age: inputs.age,
    gender: inputs.gender ?? '',
    features,
    freeText: (inputs.freeText ?? '').trim(),
    // Art style is part of the key: switching style must re-mint, not return a
    // wrong-style cached image. Absent → watercolour (the default), so an old
    // style-less request and an explicit watercolour request share one cache slot.
    style: inputs.style ?? 'watercolour',
    photo: inputs.photoHash ?? null,
  };
  return createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
}
