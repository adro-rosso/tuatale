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

// The preview cache-invalidation version. Bump ONLY when the render logic changes the
// OUTPUT of an EXISTING audience — forcing those previews to re-mint at real Gemini
// cost. NOT bumped for the adult rework (2026-07-21), and that is deliberate + proven:
//   - A NON-PHOTO child preview's prompt is BYTE-IDENTICAL under the rework (a photo-
//     anchored child preview, now possible under CHILD_PHOTO_ENABLED, keys distinctly via
//     `photo: photoHash` below and shares no slot with it) (isAdult defaults
//     false → same "a N-year-old child" label).
//   - PET books generate NO previews at all (PetForm renders no preview component), so
//     the PHOTO_COND rework — which only touches the photo path — can't reach them.
//   - ADULT previews are NEW and keyed distinctly by isAdult (below), so they need no
//     version bump to avoid colliding with child.
// Bumping would invalidate every existing child preview for ZERO output change — the
// wasted-mint-spend the original design warned about. Left at 1.
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
    // Adult renders differently (label + audience-neutral wording), so it keys the
    // cache. Included ONLY when true — a child/pet input omits it entirely, so its
    // normalized object (and therefore its hash) is BYTE-IDENTICAL to the pre-adult
    // key. That is what lets us NOT bump PREVIEW_STYLE_VERSION: existing child previews
    // keep their cache slot, only adult gets a new one.
    ...(inputs.isAdult ? { isAdult: true } : {}),
    // Character-picker (Slice 2): the N options of a batch share every OTHER input, so
    // without a per-variant key findCachedPreview would collapse them to ONE image. The
    // variant (`${batchId}:${index}`) gives each dice roll its own cache slot. Included
    // ONLY when present → the single-preview key is BYTE-IDENTICAL to before.
    ...(inputs.variant ? { variant: inputs.variant } : {}),
    // Phase-2 cover scene: a distinct cache slot from the portrait preview for the SAME
    // character (different output — a full scene). Value = `${style}:${theme}:${anchor}`.
    // Included ONLY for a cover request, so the portrait key stays BYTE-IDENTICAL.
    ...(inputs.cover ? { cover: inputs.cover } : {}),
  };
  return createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
}
