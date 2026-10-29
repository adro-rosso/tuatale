// Customer guidance on a character-picker re-roll (2026-10-28, revised 2026-10-29).
//
// Adro: "the user can add worded guidance if they want a re-render". A preview that only
// changes the PREVIEW would mislead (the book makes its own character), so guidance rides
// the character picker, whose pick is LOCKED into the book:
//   1. the picker mints its next options with the guidance clause (pickerGuidanceClause);
//   2. an option picked from a guided batch is flagged `guided` on its chosen_sheet;
//   3. the book then describes that character FROM THE PICKED PICTURE (applyPhotoAppearance),
//      not the photos, so the text agrees with the approved look. The guidance TEXT never
//      reaches the book: pasting "shorter hair" next to a photo-derived "long wavy hair"
//      contradicted itself, and free text in book prompts re-opened what PHOTO_APPEARANCE closed.
// Absent guidance → every path is byte-identical.

export const PICK_GUIDANCE_MAX = 200;

// Visible appearance only. Refused: nudity / sexual content, violence, weapons, substances and
// explicit ages (a real person's photo anchors the picture). Same pattern as the website's
// website/lib/preview/guidance.ts, which refuses first; this is the worker's own backstop.
const BLOCKED =
  /\b(naked|nude|nudity|topless|shirtless|bare[\s-]*(chest(ed)?|skin(ned)?|body|bottom)|undress\w*|underwear|lingerie|bikini|swim\s*suit|swimwear|swimming\s*costume|bathing\s*suit|bras?|panties|knickers|sexy|sexual\w*|seductive|sensual|erotic|cleavage|kissing|kisses|blood(?![\s-]*(orange|red))|bloody|bleeding|gory|wounded|injur(y|ies|ed)|weapons?|guns?|knife|knives|cigarettes?|vap(e|ing)|alcohol|beer|drunk|drugs?)\b|\b\d{1,2}\s*(years?|yrs?|y\/?o)\b/i;

/** Customer free text → one safe line (no control chars/newlines, collapsed, capped), or null. */
export function cleanPickGuidance(text) {
  if (typeof text !== "string") return null;
  const clean = text
    .replace(/[\u200b-\u200d\u2060\ufeff]/g, "") // zero-width chars can hide a blocked word
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/["“”]/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, PICK_GUIDANCE_MAX)
    .trim();
  return clean || null;
}

export function isPickGuidanceAllowed(text) {
  return !BLOCKED.test(String(text ?? ""));
}

/** The picker-mint clause for a guided re-roll, or null (prompt unchanged; refused text too). */
export function pickerGuidanceClause(text) {
  const g = cleanPickGuidance(text);
  if (!g || !isPickGuidanceAllowed(g)) return null;
  return `CUSTOMER'S REQUESTED CHANGE for this character: "${g}". Apply it only to visible details such as hair, facial hair, glasses, expression, or clothing colours and style. Keep their age, body shape and full everyday clothing exactly as described above, never add written words, and keep the likeness to the reference photos and the art style above.`;
}
