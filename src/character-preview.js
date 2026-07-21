// Whole-character PREVIEW generation (S-C). One sheet-mint from the SAME inputs the
// book uses — composeAppearance (structured + free text) and/or the photo view-0
// path. Bounded slice of the pipeline: NO multi-view loop, chaining, or PDF.
// Proven in S-B (docs/whole-character-gen-design-2026-06-16.md).
import { generateImage } from "./gemini.js";
import { buildSubjectSheetBasePrompt } from "./book-pipeline.js";
import { composeAppearance } from "./character-features.js";
import { resolveStyle } from "./art-styles.js";

// STYLE_VERSION is part of the website cache key (bump to invalidate old previews).
// The STYLE STRING now comes from the chosen art_style via resolveStyle(inputs.style)
// — undefined → watercolour, byte-identical to before. composition_rules (note the
// preview-specific "cream" background) + negative_prompt stay preview-local.
export const STYLE_VERSION = 2;
export const PREVIEW_STORY = {
  style: resolveStyle("watercolour").style,
  composition_rules: "full body, centered subject, clean uncluttered cream background, consistent framing, face clearly visible",
  negative_prompt: "photorealistic, scary, dark, blurry, deformed hands, extra fingers, text, watermark",
};
export const PREVIEW_VIEW = "front-facing portrait, neutral expression, plain cream background";

// "storybook character", NOT "children's-book character": on an ADULT reference the
// word "children's-book" youthifies the face — the same failure family as the
// pipeline's invented-words-beating-the-reference-image (fixed at the sheet-mint and
// render stages). Audience-neutral wording lets the photo drive apparent age.
const PHOTO_COND =
  "\n\nThe reference image is a PHOTOGRAPH — use it ONLY as a likeness guide for the CHARACTER'S features " +
  "(face shape, hair shape and colour, skin tone, eye colour). DRAW AN ORIGINAL storybook character in the " +
  "illustration style above that clearly RESEMBLES this person — recognisably them — but is FRESHLY ILLUSTRATED " +
  "from scratch, not the photo restyled. Do NOT trace, filter, cut out, or collage the photograph itself, and do " +
  "NOT copy its exact pose, expression, lighting, crop, or background. The result must read as a hand-made " +
  "storybook illustration, NEVER a filtered or photographic image of the person.";

/**
 * Generate ONE whole-character preview image.
 * @param {object} inputs
 * @param {number} inputs.age
 * @param {string} [inputs.name]      child name (masked inside the appearance block)
 * @param {object} [inputs.features]  structured features (composeAppearance input)
 * @param {string} [inputs.freeText]  "anything else" free text
 * @param {Buffer} [inputs.photoBuf]  PNG buffer — when present, the photo view-0 path
 * @param {object} [callContext]      forwarded to generateImage (wall-ceiling/status)
 * @returns {Promise<Buffer>} PNG bytes
 */
/**
 * Pure prompt builder — extracted so the wording can be verified at $0 (no Gemini),
 * mirroring book-pipeline's buildSubjectSheetBasePrompt. `hasPhoto` is a boolean (the
 * bytes ride separately as refs). Returns the full prompt string.
 */
export function buildPreviewPrompt({ age, name, features, freeText, background, hasPhoto, style, isAdult = false }) {
  const styleStr = resolveStyle(style).style;
  const previewStory = { ...PREVIEW_STORY, style: styleStr };
  if (hasPhoto) {
    const base = [
      `Subject: an original ${age}-year-old storybook CHARACTER, illustrated to resemble the person in the reference photograph. Reference sheet.`,
      `Appearance: draw a NEW hand-illustrated character in the style above who looks like that person — same face shape, hair, and colouring — depicted as a ${age}-year-old. This is an ORIGINAL illustration, NOT a copy, filter, tracing, or cut-out of the photo.`,
      `Style: ${styleStr}.`,
      `Composition: ${previewStory.composition_rules}.`,
      `Avoid: ${previewStory.negative_prompt}.`,
    ].join("\n");
    return `${base}\n\nView for this image: ${PREVIEW_VIEW}.${PHOTO_COND}`;
  }
  const subject = {
    age,
    name,
    isProtagonist: true,
    // Adult → labelled "an adult" (not "a {age}-year-old child") at mint, mirroring the
    // book-pipeline fix. Default false → child/pet byte-identical.
    isAdult,
    character_description: composeAppearance(features, freeText, background),
    markers: "",
  };
  const base = buildSubjectSheetBasePrompt(subject, previewStory);
  return `${base}\n\nView for this image: ${PREVIEW_VIEW}.`;
}

export async function generateCharacterPreview(
  { age, name, features, freeText, background, photoBuf, style, isAdult = false },
  callContext = { callKind: "preview_mint" },
) {
  const prompt = buildPreviewPrompt({ age, name, features, freeText, background, hasPhoto: Boolean(photoBuf), style, isAdult });
  const refs = photoBuf ? [photoBuf] : [];
  return generateImage(prompt, refs, {}, callContext);
}
