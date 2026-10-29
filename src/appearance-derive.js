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

// physicalOnly (a customer's PICKED picture describing the book's look): never clothing, which
// the book carries in its own outfit sentence; a "wearing…" clause would also make the caller's
// outfit filter drop the whole sentence.
const SYSTEM_PHYSICAL = SYSTEM.replace(
  "NO clothing unless clearly worn in the image",
  "NO clothing at all (glasses and facial hair are physical features: include them)",
);

function mediaType(buf) {
  return buf[0] === 0xff && buf[1] === 0xd8 ? "image/jpeg" : "image/png";
}

/**
 * Derive a one-sentence sheet-neutral appearance from a minted character-sheet image.
 * @param {Buffer} sheetBuffer - PNG/JPEG bytes of the (view-0) character sheet.
 * @param {object} [opts] - { subjectType: "human"|"non_human", animalKind, timeoutMs }
 * @returns {Promise<string|null>} the derived sentence, or null on any failure (soft-fail).
 */
export async function deriveSheetAppearance(sheetBuffer, { subjectType, animalKind, timeoutMs = 20000, physicalOnly = false } = {}) {
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
        system: physicalOnly ? SYSTEM_PHYSICAL : SYSTEM,
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

// Photo-derived appearance (probe 2026-10-21). For a photo-anchored HUMAN the customer's free text
// ("tall, lean frame, strong square jaw") is drawn literally and FIGHTS the photographs: the Eddie
// book's uncle came out as a slim, chiselled catalogue model while his photos show a full rounded
// face, heavy brows and a sturdy build. Reference authority covers face/hair at render, but build
// and jaw WORDS still pull. This derives the physical descriptor FROM THE PHOTOS (all kept photos
// in one vision call) so the Appearance line agrees with the references. Sheet-neutral: facts
// only, no expression, no clothing. Soft-fail → null (caller keeps the original text).
const PHOTO_SYSTEM =
  "You describe a real person's PHYSICAL appearance for a portrait painter, from their photographs, " +
  "so the painter can tell THIS person from a generic good-looking one. Lead with the 4 to 6 features " +
  "that most set them apart, stated as clear comparatives against an average adult of their sex: face " +
  "fullness (fuller/narrower), cheeks, chin and jaw shape (rounded/pointed/broad/heavy), brow weight " +
  "(heavy/light), eye depth and shape, nose width/length, mouth width, hair colour, texture, LENGTH " +
  "(cropped / ear-length / collar-length / shoulder-length), VOLUME and how it sits (height on top, " +
  "parting, swept, fringe), skin tone, neck thickness and overall build " +
  "(sturdy/slim/broad/heavy-set). NEVER use hedge words: no 'medium', 'moderate', 'average', 'defined', " +
  "'well-proportioned'. NO expression or mood, NO pose, NO clothing, NO background, NO age guess, NO " +
  "flattering adjectives (no 'handsome', 'athletic', 'chiselled'). Two or three short sentences, present " +
  "tense, starting with 'A person with'.";

/**
 * Derive a sheet-neutral physical descriptor from one or more PHOTOGRAPHS of the same person.
 * @param {Buffer[]} photoBuffers - PNG/JPEG bytes (all kept photos of the subject).
 * @param {object} [opts] - { timeoutMs }
 * @returns {Promise<string|null>} descriptor, or null on any failure (soft-fail).
 */
export const PHOTO_DERIVE_MODEL = process.env.PHOTO_APPEARANCE_MODEL || "claude-sonnet-4-6";

export async function derivePhotoAppearance(photoBuffers, { timeoutMs = 30000, model = PHOTO_DERIVE_MODEL } = {}) {
  const client = getClient();
  const bufs = (photoBuffers || []).filter((b) => b && b.length);
  if (!client) { console.warn("[derivePhotoAppearance] no ANTHROPIC_API_KEY — skipping (story text kept)"); return null; }
  if (!bufs.length) return null;
  try {
    const resp = await client.messages.create(
      {
        model,
        max_tokens: 300,
        system: PHOTO_SYSTEM,
        messages: [{
          role: "user",
          content: [
            ...bufs.map((b) => ({ type: "image", source: { type: "base64", media_type: mediaType(b), data: b.toString("base64") } })),
            { type: "text", text: `These ${bufs.length} photo(s) show the SAME person. Describe their physical appearance as instructed.` },
          ],
        }],
      },
      { timeout: timeoutMs },
    );
    const text = (resp?.content ?? []).map((b) => b?.text ?? "").join("").trim();
    return text || null;
  } catch (err) {
    console.warn('[derivePhotoAppearance] soft-fail:', err?.status ?? '', err?.message ?? String(err));
    return null;
  }
}
