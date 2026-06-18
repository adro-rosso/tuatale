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
export const STYLE_VERSION = 1;
export const PREVIEW_STORY = {
  style: resolveStyle("watercolour").style,
  composition_rules: "full body, centered subject, clean uncluttered cream background, consistent framing, face clearly visible",
  negative_prompt: "photorealistic, scary, dark, blurry, deformed hands, extra fingers, text, watermark",
};
export const PREVIEW_VIEW = "front-facing portrait, neutral expression, plain cream background";

const PHOTO_COND =
  "\n\nThe reference image is a PHOTOGRAPH of the person to depict. Translate them into the illustration " +
  "style above — same face shape, features, and hair as the photo, recognisably the same person; do NOT " +
  "reproduce photographic detail, lighting, or background.";

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
export async function generateCharacterPreview(
  { age, name, features, freeText, background, photoBuf, style },
  callContext = { callKind: "preview_mint" },
) {
  // Chosen art style (undefined → watercolour). composition_rules + negative_prompt
  // stay preview-local; only the style string is style-dependent.
  const styleStr = resolveStyle(style).style;
  const previewStory = { ...PREVIEW_STORY, style: styleStr };
  let prompt;
  let refs = [];
  if (photoBuf) {
    refs = [photoBuf];
    const base = [
      `Subject: a ${age}-year-old child (the person shown in the reference photograph). Reference sheet.`,
      `Appearance: render this person as a storybook character in the style above, keeping their face, facial features, and hair from the reference photo.`,
      `Style: ${styleStr}.`,
      `Composition: ${previewStory.composition_rules}.`,
      `Avoid: ${previewStory.negative_prompt}.`,
    ].join("\n");
    prompt = `${base}\n\nView for this image: ${PREVIEW_VIEW}.${PHOTO_COND}`;
  } else {
    const subject = {
      age,
      name,
      isProtagonist: true,
      character_description: composeAppearance(features, freeText, background),
      markers: "",
    };
    const base = buildSubjectSheetBasePrompt(subject, previewStory);
    prompt = `${base}\n\nView for this image: ${PREVIEW_VIEW}.`;
  }
  return generateImage(prompt, refs, {}, callContext);
}
