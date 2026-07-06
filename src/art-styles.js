// Art-style source of truth (W-B / W-D). The 6 committed styles + shared brand
// constants, consumed by the book pipeline (anthropic.js → story.style [sheet] +
// story.pageStyle [page] → sheet-mint + page render) and the instant preview.
//
// W-D decouple: each style carries a `sheet` string (character sheets + preview)
// and a `page` string (full-page scene render). watercolour keeps its two distinct
// strings exactly as before — sheet = the short string (sheets + preview), page =
// the rich Sophie-Blackall vocab RELOCATED out of the template styleOverrides.
// So removing the template overrides is a byte-identical no-op for watercolour.
// The 5 new styles use page = sheet (their probe string) until W-E tunes `page`.

export const COMPOSITION_RULES =
  "full body, centered subject, clean uncluttered background, consistent framing, face clearly visible";
export const NEGATIVE_PROMPT =
  "photorealistic, scary, dark, blurry, deformed hands, extra fingers, text, letters, words, captions, lettering, numbers, signage, watermark";

// Probe-validated strings for the 5 new styles (sheet === page for now).
const PENCIL = "soft children's-book COLOURED PENCIL illustration — gentle hand-drawn pencil-crayon textures, warm layered strokes, soft shading, cosy and tender, visible pencil grain";
const PAINTERLY = "classic GOLDEN-AGE STORYBOOK PAINTING — rich painterly gouache/oil illustration in the warm tradition of vintage children's books, soft brushwork, gentle light, timeless and premium";
const INK_WASH = "loose INK-LINE-AND-WATERCOLOUR-WASH illustration — energetic scratchy pen line with light loose colour washes, whimsical and characterful in the spirit of Quentin Blake, expressive linework";
const FLAT = "warm modern FLAT illustration — clean flat colour fills with soft cel-shading, gentle linework, cosy palette, premium picture-book, clean defined edges";
const CUTPAPER = "CUT-PAPER COLLAGE illustration — layered hand-painted textured paper shapes assembled into the figure, bold and tactile in the spirit of Eric Carle, visible paper texture and torn/cut edges";

export const ART_STYLES = {
  watercolour: {
    sheet: "soft watercolor children's book illustration, warm lighting, gentle shadows, storybook style, muted earthy palette",
    // Relocated verbatim from the template imageGeneration.styleOverride (W-D).
    page: "watercolor on cold-press paper, wet-on-wet wash technique, visible pigment granulation, organic uneven boundaries where wash absorbs into paper fiber. Loose, painterly, with intentional white space and atmospheric bleeding. Inspired by contemporary picture book illustration in the style of Sophie Blackall. Warm earthy palette.",
  },
  coloured_pencil: { sheet: PENCIL, page: PENCIL },
  painterly: { sheet: PAINTERLY, page: PAINTERLY },
  ink_wash: { sheet: INK_WASH, page: INK_WASH },
  flat_modern: { sheet: FLAT, page: FLAT },
  cutpaper: { sheet: CUTPAPER, page: CUTPAPER },
};

export const DEFAULT_STYLE = "watercolour";
export const STYLE_VALUES = Object.keys(ART_STYLES); // wizard options + Zod enum + DB-validation list

/** Resolve a style key → { style (=sheet), page, composition_rules, negative_prompt }.
 * `.style` is the SHEET vocab (sheets + preview); `.page` is the page-render vocab.
 * Unknown / absent → DEFAULT_STYLE (watercolour). Pure; never throws. */
export function resolveStyle(key) {
  const s = ART_STYLES[key] ?? ART_STYLES[DEFAULT_STYLE];
  return { style: s.sheet, page: s.page, composition_rules: COMPOSITION_RULES, negative_prompt: NEGATIVE_PROMPT };
}

/** Adapter hard boundary (mirrors validateChildFeatures): null/absent → DEFAULT_STYLE
 * (legacy orders); a present-but-unknown value THROWS so bad data fails loud rather
 * than silently rendering the wrong style. */
export function validateArtStyle(value) {
  if (value === null || value === undefined || value === "") return DEFAULT_STYLE;
  if (!STYLE_VALUES.includes(value)) {
    throw new Error(`art_style: "${value}" is not a known style (${STYLE_VALUES.join(", ")})`);
  }
  return value;
}
