// Customer guidance on a character-picker re-roll (2026-10-28).
//
// Adro: "the user can add worded guidance if they want a re-render". A preview that only
// changes the PREVIEW would mislead (the book makes its own character), so guidance rides
// the character picker, whose pick is LOCKED into the book:
//   1. the picker mints its next options with the guidance clause (pickerGuidanceClause);
//   2. the picked option carries the guidance on its chosen_sheet into the order;
//   3. the book appends it to that character's description (applyPickGuidance), AFTER
//      PHOTO_APPEARANCE replaces the physical text with photo-derived words, so the text
//      agrees with the locked picture instead of pulling pages back toward the photos.
// Absent guidance → every path is byte-identical.

export const PICK_GUIDANCE_MAX = 200;

/** Customer free text → one safe line (no control chars/newlines, collapsed, capped), or null. */
export function cleanPickGuidance(text) {
  if (typeof text !== "string") return null;
  const clean = text
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/["“”]/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, PICK_GUIDANCE_MAX)
    .trim();
  return clean || null;
}

/** The picker-mint clause for a guided re-roll, or null (prompt unchanged). */
export function pickerGuidanceClause(text) {
  const g = cleanPickGuidance(text);
  if (!g) return null;
  return `CUSTOMER'S REQUESTED CHANGE for this character: "${g}". Apply it clearly, while keeping the likeness to the reference photos and the art style above.`;
}

const sentenceFor = (g) => `The family approved this look: ${g.replace(/[.!?]+$/, "")}.`;

function appendOnce(desc, g) {
  const s = sentenceFor(g);
  const base = String(desc ?? "").trim();
  if (base.includes(s)) return base; // idempotent across resume/re-render
  return base ? `${base} ${s}` : s;
}

/**
 * Append each picked character's guidance to its description in the story (in place).
 * meta.inputs.child.pick_guidance → story.character; meta.inputs.secondaries[i].pick_guidance
 * → the companion_characters entry with the same name. Returns the names it changed.
 */
export function applyPickGuidance(story, meta) {
  const applied = [];
  if (!story || !meta?.inputs) return applied;
  const child = meta.inputs.child;
  const cg = cleanPickGuidance(child?.pick_guidance);
  if (cg && typeof story.character === "string") {
    story.character = appendOnce(story.character, cg);
    applied.push(child.name);
  }
  for (const s of meta.inputs.secondaries ?? []) {
    const g = cleanPickGuidance(s?.pick_guidance);
    if (!g) continue;
    const comp = (story.companion_characters ?? []).find((c) => c?.name === s.name);
    if (!comp) continue;
    comp.character_description = appendOnce(comp.character_description, g);
    applied.push(s.name);
  }
  return applied;
}
