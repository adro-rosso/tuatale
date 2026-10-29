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

/**
 * Guidance may steer visible appearance only (hair, glasses, clothing colours…). Refused:
 * nudity / sexual content, violence, weapons, substances and explicit ages. A real person's
 * photo anchors the picture, so this is a hard line, checked here AND re-checked by the worker
 * (src/pick-guidance.js uses the same pattern). Keep the two patterns identical.
 */
const BLOCKED =
  /\b(naked|nude|nudity|topless|shirtless|undress\w*|underwear|lingerie|bikini|swimsuit|swimwear|bras?|panties|knickers|sexy|sexual\w*|seductive|sensual|erotic|cleavage|kiss\w*|blood\w*|gore|gory|wound\w*|weapons?|guns?|knife|knives|cigarettes?|vap(e|ing)|alcohol|beer|wine|drunk|drugs?)\b|\b\d{1,2}\s*(years?|yrs?|y\/?o)\b/i;

export function isGuidanceAllowed(text: string): boolean {
  return !BLOCKED.test(text);
}
