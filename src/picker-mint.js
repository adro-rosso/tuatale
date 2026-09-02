// src/picker-mint.js — book-faithful character-picker option mint (Slice 2, 2026-07-28).
//
// Generates ONE candidate BOOK view-0 sheet from a customer's photos. The option the
// customer sees IS the sheet that gets LOCKED (Slice 1) and used as the book's character,
// so it must be minted through the BOOK's real path — NOT the loose cream-bg preview.
//
// Faithfulness invariant (what must NOT be relaxed):
//   - buildSubjectViewZeroPrompt — the exact shared book view-0 assembly (REFERENCE IS
//     AUTHORITATIVE + the real art style + photoRef), extracted in book-pipeline.js.
//   - buildSubjectListForSheetGen — the book's own composeAppearance / injectOutfit /
//     shirt-guard transforms, so the subject is built exactly as the book builds it.
//   - the caller runs selectBestPhotos first (good-face inputs).
//
// Decision (B): the DESCRIPTION source is the RAW DRAFT (composed appearance), not the
// yet-ungenerated story.character. Safe because the picked option is locked as PIXELS and
// never re-minted from the description; views 2-3 chain off the locked image. We relax the
// description SOURCE, never the faithfulness of the mint.
import fs from "node:fs";
import { generateImage } from "./gemini.js";
import { buildSubjectViewZeroPrompt, buildSubjectListForSheetGen } from "./book-pipeline.js";
import { resolveStyle, COMPOSITION_RULES, NEGATIVE_PROMPT } from "./art-styles.js";
import { composeAppearance } from "./character-features.js";

/**
 * The EXACT story fields the book's sheet-mint reads: style from the chosen art_style;
 * composition_rules + negative_prompt are the shared brand constants (art-styles.js).
 * Fully reconstructable at wizard time — this is what lets a picker option be a real
 * book view-0 sheet without a generated story.
 */
export function buildFaithfulStory(artStyle) {
  return {
    style: resolveStyle(artStyle).style,
    composition_rules: COMPOSITION_RULES,
    negative_prompt: NEGATIVE_PROMPT,
  };
}

/**
 * Build the picker subject through the BOOK's own buildSubjectListForSheetGen, so the
 * composeAppearance / injectOutfit / shirt-guard transforms are IDENTICAL to the book.
 * role: "protagonist" (child/pet/adult hero) | "secondary".
 * Env (FEATURES_COMPOSE / FEATURES_PET_HERO) is the worker's prod env → same as the book.
 */
export function buildPickerSubject({ role, inputs, story }) {
  const desc = composeAppearance(inputs.features, inputs.appearance, inputs.background) || inputs.appearance || "";
  if (role === "secondary") {
    // A stub protagonist is required (buildSubjectListForSheetGen always builds one); we
    // extract the companion. The stub never mints — it's discarded here.
    const s = { ...story, character: "a child", companion_characters: [{ name: inputs.name, character_description: desc }] };
    const meta = {
      inputs: {
        child: { name: "Hero", age: 8, gender: "boy", subject_type: "human", appearance: "a child" },
        secondaries: [{
          id: inputs.id || "companion-1",
          name: inputs.name,
          age: inputs.age ?? 30,
          subject_type: inputs.subject_type,
          gender: inputs.subject_type === "human" ? inputs.gender : undefined,
          anchor: "tier2",
          appearance_markers: desc,
          is_adult: inputs.is_adult === true,
          photo_paths: inputs.photoPaths,
        }],
      },
    };
    return buildSubjectListForSheetGen(s, meta, "Hero", 8).find((x) => !x.isProtagonist);
  }
  const s = { ...story, character: desc, companion_characters: [] };
  const meta = {
    inputs: {
      child: {
        name: inputs.name,
        age: inputs.age,
        gender: inputs.gender,
        subject_type: inputs.subject_type,
        appearance: inputs.appearance,
        features: inputs.features,
        background: inputs.background,
        animal_kind: inputs.animal_kind,
        is_adult: inputs.is_adult === true,
        photo_paths: inputs.photoPaths,
      },
    },
  };
  return buildSubjectListForSheetGen(s, meta, inputs.name, inputs.age).find((x) => x.isProtagonist);
}

// Per-variant POSE / ANGLE / FRAMING differentiation for the character picker (2026-09-01).
// The N options otherwise differ only by stochastic noise, so options (pets especially) read
// too alike. This appends a pose/angle/framing directive keyed by the variant index. HARD
// CONSTRAINTS honoured here: (a) EXPRESSION STAYS NEUTRAL — the neutral-base-sheet rule is a
// locked product decision (the photo defines features, not mood); every variant reinforces
// neutral and none varies it; (b) LIKENESS IS UNTOUCHABLE — REFERENCE IS AUTHORITATIVE + the
// photo-anchor path are set by buildSubjectViewZeroPrompt and are NOT touched here; this clause
// only changes pose/angle/framing, never the identity/reference wording. The base view-0
// prompt is left byte-identical, so the book render + single preview (which pass no
// variantIndex) are unchanged (golden-master-guarded).
export const PICKER_POSE_VARIANTS = [
  "POSE, ANGLE & FRAMING: a calm front-facing, full-body view, squared to the camera and centred. Do not change the expression — keep it neutral.",
  "POSE, ANGLE & FRAMING: a relaxed three-quarter turn, the subject angled slightly to one side in a natural full-body standing or sitting stance. Do not change the expression — keep it neutral.",
  "POSE, ANGLE & FRAMING: a different natural pose from a slightly lower or higher angle — an animal sitting or lying alert with the head turned, a person with weight shifted — framed a touch closer, from the chest up, with the face clearly visible. Do not change the expression — keep it neutral.",
];

/** The pose/angle/framing clause for a picker variant, or null when no variantIndex is given
 *  (the non-picker paths — book render + single preview — which must stay byte-identical). */
export function pickerPoseVariant(variantIndex) {
  if (variantIndex == null) return null;
  return PICKER_POSE_VARIANTS[((variantIndex % PICKER_POSE_VARIANTS.length) + PICKER_POSE_VARIANTS.length) % PICKER_POSE_VARIANTS.length];
}

/**
 * Generate ONE book-faithful picker option (a view-0 PNG). `photoPaths` are LOCAL files
 * (downloaded + selectBestPhotos-filtered by the caller). callKind "picker_mint" gets the
 * preview resilience profile (fail-fast + hedge) in gemini.js. `variantIndex` (optional)
 * appends a pose/angle/framing clause so the N options are visibly distinct; omitting it
 * yields the exact pre-variant prompt.
 */
export async function generatePickerOption({ role, inputs, artStyle, variantIndex }, photoPaths, callContext = { callKind: "picker_mint" }) {
  const story = buildFaithfulStory(artStyle);
  const subject = buildPickerSubject({ role, inputs, story });
  if (!subject) throw new Error(`picker: could not build subject for role=${role} name=${inputs?.name}`);
  const photoBufs = (photoPaths ?? []).map((p) => fs.readFileSync(p));
  const basePrompt = buildSubjectViewZeroPrompt(subject, story);
  const poseClause = pickerPoseVariant(variantIndex);
  const prompt = poseClause ? `${basePrompt}\n\n${poseClause}` : basePrompt;
  return generateImage(prompt, photoBufs, {}, callContext);
}
