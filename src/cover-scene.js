// Pre-purchase COVER-SCENE prompt builder (Phase 2). Reuses the LIVE cover-iter-1 scaffold
// (customCompositionRules + compositionPromptTemplate + aspectRatio) so it can't drift from
// the post-purchase cover, but (a) swaps the scaffold's hard-coded watercolour medium sentence
// for the chosen style's (COVER_SCENE_MEDIUM), (b) adds a POSITIVE empty-panel instruction
// (negatives saturate — see project_prompt-negative-saturation), and (c) selects the anchor
// directive: a rendered sheet is "kept consistent", a raw photo is a LIKENESS GUIDE only.
//
// It deliberately does NOT touch generateCoverHero or templates/cover-iter-1/config.json, so
// the live post-purchase cover render is byte-identical.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveStyle, COVER_SCENE_MEDIUM } from "./art-styles.js";

const __dir = path.dirname(fileURLToPath(import.meta.url));
const COVER_IG = JSON.parse(
  fs.readFileSync(path.join(__dir, "../templates/cover-iter-1/config.json"), "utf8"),
).imageGeneration;

// A raw photo is a likeness GUIDE only — never traced/collaged (mirrors the worker's
// character-preview PHOTO_COND, the proven photo path).
const PHOTO_COND =
  "The reference image is a PHOTOGRAPH — use it ONLY as a likeness guide for the character's " +
  "features (face shape, hair shape and colour, skin tone, eye colour, facial hair). DRAW AN " +
  "ORIGINAL storybook character in the specified style; do NOT trace, filter, cut out, or collage " +
  "the photograph, and do NOT reproduce its lighting or background.";
// A rendered sheet / picked option is already the on-model, in-style character.
const SHEET_COND =
  "Use the provided reference image of the character to keep their appearance, clothing, and proportions consistent.";
// POSITIVE empty-panel instruction — the lower band is the client title overlay's clearance.
const EMPTY_PANEL =
  "The lower third of the frame is reserved for a title panel added AFTERWARD: keep that band " +
  "calm and completely EMPTY of any title, text, lettering, words, numbers, or signage. Do NOT " +
  "paint a title or any words anywhere in the image.";

/**
 * Build the cover-scene prompt.
 * @param {{subject:string, appearance:string, styleKey:string, coverConcept:string,
 *          anchorKind:'sheet'|'photo'|'none'}} args
 * @returns {{prompt:string, aspectRatio:string}}
 */
export function buildCoverScenePrompt({ subject, appearance, styleKey, coverConcept, anchorKind }) {
  const ig = COVER_IG;
  const styleLine = resolveStyle(styleKey).page;
  const mediumSentence = COVER_SCENE_MEDIUM[styleKey] || COVER_SCENE_MEDIUM.watercolour;
  // Reuse the live scaffold; swap ONLY its watercolour medium sentence for the chosen style's.
  const composition = ig.compositionPromptTemplate.replace(COVER_SCENE_MEDIUM.watercolour, mediumSentence);
  const anchorLine = anchorKind === "photo" ? PHOTO_COND : anchorKind === "sheet" ? SHEET_COND : "";
  const prompt =
    [
      `Subject: ${subject}.`,
      `Appearance: ${appearance}.`,
      `Style: ${styleLine}.`,
      `Composition: ${ig.customCompositionRules}`,
      `Template composition: ${composition}`,
      "Avoid: photorealism, text, lettering, watermarks, extra limbs, distorted faces.",
    ].join("\n") +
    `\n\n${EMPTY_PANEL}\n\nScene: ${coverConcept}` +
    (anchorLine ? `\n\n${anchorLine}` : "");
  return { prompt, aspectRatio: ig.aspectRatio };
}
