// Auto-derived appearance anchor (ART_NATURAL_ENABLED, 2026-10). For a photo-anchored subject
// whose customer-written appearance is thin, the page-time text anchor ("a labradoodle") gives
// the image model too little to hold, so it drifts to a breed prior (the labradoodle→golden-
// retriever flip, see project_book-art-regression-diagnosis). This derives a rich, SHEET-NEUTRAL
// physical description from the already-minted character sheet (the canonical, customer-anchored
// likeness) via a cheap vision pass, to SUPPLEMENT the page anchor. Soft-fail by contract: any
// error returns null and the caller keeps the original anchor — this never breaks a book.
import Anthropic from "@anthropic-ai/sdk";

// Cheap vision model; overridable without a deploy. Haiku is enough for a physical description.
export const DERIVE_MODEL = process.env.APPEARANCE_DERIVE_MODEL || "claude-haiku-4-5";

let _client = null;
function getClient() {
  if (_client) return _client;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null; // no key → soft-fail (same key story-gen uses)
  _client = new Anthropic({ apiKey });
  return _client;
}

const SYSTEM =
  "You describe a character's PHYSICAL appearance for an illustrator, SHEET-NEUTRAL: plain " +
  "physical facts only — species/breed, coat or hair type and texture, colour(s) and any " +
  "markings, muzzle/face, eyes, nose, ears, and build. NO pose, NO mood or expression, NO " +
  "background, NO camera direction, NO clothing unless clearly worn in the image. One sentence, " +
  "present tense, starting with the subject.";

function mediaType(buf) {
  return buf[0] === 0xff && buf[1] === 0xd8 ? "image/jpeg" : "image/png";
}

/**
 * Derive a one-sentence sheet-neutral appearance from a minted character-sheet image.
 * @param {Buffer} sheetBuffer - PNG/JPEG bytes of the (view-0) character sheet.
 * @param {object} [opts] - { subjectType: "human"|"non_human", animalKind, timeoutMs }
 * @returns {Promise<string|null>} the derived sentence, or null on any failure (soft-fail).
 */
export async function deriveSheetAppearance(sheetBuffer, { subjectType, animalKind, timeoutMs = 20000 } = {}) {
  const client = getClient();
  if (!client || !sheetBuffer || !sheetBuffer.length) return null;
  const hint = subjectType === "non_human"
    ? `This is a ${animalKind || "pet"}. Describe its breed, coat type and texture, colours and any markings, face, eyes, ears, and build.`
    : "Describe this person's hair colour and style, face, eyes, skin tone, and build.";
  try {
    const resp = await client.messages.create(
      {
        model: DERIVE_MODEL,
        max_tokens: 200,
        system: SYSTEM,
        messages: [{
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mediaType(sheetBuffer), data: sheetBuffer.toString("base64") } },
            { type: "text", text: `${hint} One sheet-neutral sentence.` },
          ],
        }],
      },
      { timeout: timeoutMs },
    );
    const text = (resp?.content ?? []).map((b) => b?.text ?? "").join("").trim();
    return text || null;
  } catch {
    return null; // soft-fail: caller keeps the existing anchor
  }
}
