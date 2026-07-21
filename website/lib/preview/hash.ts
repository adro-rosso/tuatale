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

// The preview cache-invalidation version. This is the ONLY value that keys the cache
// — the mirror STYLE_VERSION constant in src/character-preview.js is documentation,
// not render-read. Bump when the worker's preview RENDER LOGIC changes, so old-logic
// previews re-mint. v2 (2026-07-21): the photo-path rework (original-illustration-not-
// photo-filter + audience-neutral wording) + isAdult. DEPLOY ORDER: worker (new logic)
// BEFORE website (this bump) — website-first would lock old logic under the new key.
export const PREVIEW_STYLE_VERSION = 2;

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
    // Adult vs child/pet render differently (label + audience-neutral wording), so it
    // keys the cache. Normalised to a bool; absent → false → child/pet unchanged.
    isAdult: inputs.isAdult ?? false,
  };
  return createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
}
