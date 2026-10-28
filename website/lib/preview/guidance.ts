/**
 * Customer guidance on a character-picker re-roll ("shorter hair, rounder glasses"). Mirrors
 * src/pick-guidance.js cleanPickGuidance (the worker re-cleans it before any prompt): one safe
 * line, no control characters, double quotes softened, capped. Plain module, not 'use server'.
 */
export const PICK_GUIDANCE_MAX = 200;

export function cleanGuidance(text: unknown): string | undefined {
  if (typeof text !== 'string') return undefined;
  const clean = text
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/["“”]/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, PICK_GUIDANCE_MAX)
    .trim();
  return clean || undefined;
}
