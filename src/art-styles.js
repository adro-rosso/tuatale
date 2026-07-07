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

// ---- Per-style MEDIUM tokens (W-E, 2026-07-06) -----------------------------
// The page templates' compositionPromptTemplate carried WATERCOLOUR-specific
// medium phrases ("watercolor wash", "pigment granulation", "wet-edge bleeding",
// …) baked into otherwise style-agnostic LAYOUT language — so a non-watercolour
// book's page prompt fought its own chosen style. W-E parameterizes those phrases
// behind `{{MEDIUM:key}}` tokens the templates now carry; each style fills them
// with its own medium vocabulary. WATERCOLOUR's fills are the EXACT original
// substrings, so a watercolour render is BYTE-IDENTICAL after the change (guarded
// by scripts/test-medium-tokens.js). An unfilled/legacy style defaults per-key to
// watercolour (safe: untuned styles stay preview-only anyway).
export const MEDIUM_TOKEN_KEYS = [
  "medium",       // medium noun, American, mid-sentence  ("watercolor")
  "mediumUK",     // medium noun, British spelling         ("watercolour")
  "washWord",     // the soft-fill word                    ("wash")
  "styleTail",    // signature medium + texture clause     ("watercolor with visible pigment granulation and soft organic edges")
  "edgeDissolve", // edge-dissolve behaviour               ("watercolor wash absorbing into paper")
  "wetEdge",      // wet-edge descriptor                   ("wet-edge bleeding")
  "climaxClause", // p6 climax medium clause (capitalised) ("Watercolor wash with rich pigment and atmospheric depth")
];

const WATERCOLOUR_MEDIUM = {
  medium: "watercolor",
  mediumUK: "watercolour",
  washWord: "wash",
  styleTail: "watercolor with visible pigment granulation and soft organic edges",
  edgeDissolve: "watercolor wash absorbing into paper",
  wetEdge: "wet-edge bleeding",
  climaxClause: "Watercolor wash with rich pigment and atmospheric depth",
};

// Coloured pencil (W-E pilot). Soft, textured, painterly cousin of watercolour;
// the soft-edge feather assumption still holds (hard-edge/feather is deferred to
// flat/cut-paper).
const PENCIL_MEDIUM = {
  medium: "coloured-pencil",
  mediumUK: "coloured-pencil",
  washWord: "shading",
  styleTail: "coloured pencil with visible pencil grain and soft layered strokes",
  edgeDissolve: "soft pencil strokes blending into the paper",
  wetEdge: "softly feathered pencil strokes",
  climaxClause: "Rich coloured-pencil shading with layered strokes and atmospheric depth",
};

// Painterly (W-E, 2026-07-06). DISTINCTNESS is the risk: it must NOT read as a
// watercolour twin. The fills push THICK, OPAQUE paint — visible directional
// brushstrokes, impasto texture, rich saturated colour — the opposite of
// watercolour's transparent granular wash.
const PAINTERLY_MEDIUM = {
  medium: "oil painting",
  mediumUK: "oil painting",
  washWord: "brushwork",
  styleTail: "thick opaque oil paint with visible directional brushstrokes, rich saturated colour, and impasto texture",
  edgeDissolve: "loose painterly brushstrokes softening into the paper",
  wetEdge: "soft loose brush edges",
  climaxClause: "Thick, richly painted oil brushwork with deep saturated colour and atmospheric depth",
};

// Ink & wash (W-E, 2026-07-06). Must clear TWO styles: distinct from watercolour
// (transparent wash, NO linework) AND painterly (opaque oil, NO linework). The
// ANCHOR is VISIBLE INK LINEWORK — clean, confident dark pen outlines — over loose
// transparent colour washes. Consistency risk: the medium's looseness can drift
// the face, so the vocab pushes CLEAN, CONTROLLED outlines (NOT scratchy) to hold
// likeness.
const INK_WASH_MEDIUM = {
  medium: "ink-and-wash",
  mediumUK: "ink-and-wash",
  washWord: "wash",
  styleTail: "ink-and-wash illustration with clean, confident dark pen-and-ink outlines and loose transparent colour washes",
  edgeDissolve: "loose colour wash bleeding into the paper",
  wetEdge: "loose wet wash edges",
  climaxClause: "Bold, clean ink linework over rich loose colour washes with atmospheric depth",
};

// Cut-paper (W-E, 2026-07-06). Expected HARDEST on likeness: torn-paper collage
// reassembles the face from paper shapes per render, so a specific child may not
// survive. Fills push the collage look; the page/sheet vocab carries the
// keep-her-specific-features lever (as flat modern did — which failed the bar).
const CUTPAPER_MEDIUM = {
  medium: "cut-paper collage",
  mediumUK: "cut-paper collage",
  washWord: "paper texture",
  styleTail: "cut-paper collage of layered torn and cut textured paper shapes with visible paper grain and hand-cut edges, in the tactile spirit of Eric Carle",
  edgeDissolve: "a soft torn-paper edge fading at the border",
  wetEdge: "a soft torn-paper edge",
  climaxClause: "Bold layered cut-paper shapes with rich collage texture and strong graphic depth",
};

// Anti-vignette / edge-fill emphasis (W-E, 2026-07-06). WATERCOLOUR fills its
// frame naturally via wet bleed; every OTHER medium (pencil, painterly, ink,
// flat, cut-paper) tends to render a CONTAINED SPOT with bare paper around it, so
// banded/feathered templates come out sparse/vignetted (observed on the pencil
// pilot: prompt-3/7/8 pages sat in cream). Each non-watercolour style APPENDS this
// to its page-render vocab (the `Style:` line, applied to every page) to push a
// full edge-to-edge fill. Reusable across styles by design — NOT a pencil one-off.
// Watercolour's `page` deliberately omits it (it already bleeds), so watercolour
// page prompts are unchanged.
export const EDGE_FILL_EMPHASIS =
  "Render the illustration richly and fully to all four edges of the frame, covering the whole surface, with no bare white paper and no floating vignette.";

// Anti-frame clause (W-E, 2026-07-06). Ink / graphic media tend to draw a
// RECTANGULAR BORDER or framed panel around the illustration (observed on ink &
// wash p4 — a boxed pond vignette). Appended to the page vocab of ONLY the styles
// that show that tendency (ink & wash now; likely flat_modern + cut-paper when
// they're tuned). Deliberately NOT part of EDGE_FILL_EMPHASIS and NOT applied to
// pencil/painterly (live + validated, no border tendency) — their prompts are
// unperturbed. Reusable pattern, same as EDGE_FILL_EMPHASIS.
export const NO_FRAME_EMPHASIS =
  "Do not draw a frame, border, box, or ruled line around the image; the painting bleeds off every edge of the frame.";

// Probe-validated strings for the 5 new styles.
const PENCIL = "soft children's-book COLOURED PENCIL illustration — gentle hand-drawn pencil-crayon textures, warm layered strokes, soft shading, cosy and tender, visible pencil grain";
// Page-render vocab for pencil (W-E tuned): the medium description + the shared
// anti-vignette fill emphasis. The SHEET vocab stays bare PENCIL (a reference
// sheet is a single figure on cream — it SHOULD have paper around it).
const PENCIL_PAGE = `${PENCIL}. ${EDGE_FILL_EMPHASIS}`;
// Painterly (W-E tuned for DISTINCTNESS vs watercolour): thick opaque oil/gouache
// paint, visible directional brushstrokes + impasto, deep saturated colour — NOT a
// transparent wash. Page vocab = the medium description + the shared fill emphasis.
const PAINTERLY = "classic GOLDEN-AGE STORYBOOK OIL PAINTING — rich, painterly illustration in THICK, OPAQUE oil and gouache paint with visible directional brushstrokes and impasto texture, deep saturated colour, warm gentle light, in the timeless tradition of vintage children's-book paintings. This is opaque painted colour, NOT a transparent watercolour wash";
const PAINTERLY_PAGE = `${PAINTERLY}. ${EDGE_FILL_EMPHASIS}`;
// Ink & wash (W-E tuned): the VISIBLE INK OUTLINE is the signature (distinct from
// watercolour's line-free wash AND painterly's line-free opaque oil). Linework is
// CLEAN + CONTROLLED (not scratchy/energetic-Quentin-Blake) so the face holds
// consistent across pages — the key risk for this looser medium.
const INK_WASH = "INK-LINE-AND-WATERCOLOUR-WASH children's illustration — clean, confident dark pen-and-ink OUTLINES drawn with a controlled hand, filled with light, loose, transparent watercolour washes that bleed softly around the linework; the visible ink outline is the signature. Characterful but CONTROLLED, NOT scratchy or messy; keep the face and features clean, defined, and consistent";
// Ink & wash also gets the NO_FRAME clause (its medium tendency to draw a bordered
// panel — pencil/painterly don't, so they omit it).
const INK_WASH_PAGE = `${INK_WASH}. ${EDGE_FILL_EMPHASIS} ${NO_FRAME_EMPHASIS}`;
const FLAT = "warm modern FLAT illustration — clean flat colour fills with soft cel-shading, gentle linework, cosy palette, premium picture-book, clean defined edges";
// Cut-paper (W-E). Distinct by default; the decisive risk is LIKENESS SURVIVAL —
// the likeness lever lives in BOTH sheet + page vocab. Gets BOTH clauses (graphic
// medium: anti-vignette + anti-drawn-border).
const CUTPAPER = "CUT-PAPER COLLAGE children's illustration — the whole scene built from layered, torn and cut pieces of textured painted paper (in the tactile spirit of Eric Carle), with visible paper grain and hand-cut/torn edges. Keep the child's SPECIFIC features and likeness clearly recognizable and consistent — the exact hair shape and colour, face, skin tone, and outfit — a specific, individual child, NOT a generic paper-craft figure";
const CUTPAPER_PAGE = `${CUTPAPER}. ${EDGE_FILL_EMPHASIS} ${NO_FRAME_EMPHASIS}`;

export const ART_STYLES = {
  watercolour: {
    sheet: "soft watercolor children's book illustration, warm lighting, gentle shadows, storybook style, muted earthy palette",
    // Relocated verbatim from the template imageGeneration.styleOverride (W-D).
    page: "watercolor on cold-press paper, wet-on-wet wash technique, visible pigment granulation, organic uneven boundaries where wash absorbs into paper fiber. Loose, painterly, with intentional white space and atmospheric bleeding. Inspired by contemporary picture book illustration in the style of Sophie Blackall. Warm earthy palette.",
    medium: WATERCOLOUR_MEDIUM,
  },
  coloured_pencil: { sheet: PENCIL, page: PENCIL_PAGE, medium: PENCIL_MEDIUM },
  painterly: { sheet: PAINTERLY, page: PAINTERLY_PAGE, medium: PAINTERLY_MEDIUM },
  ink_wash: { sheet: INK_WASH, page: INK_WASH_PAGE, medium: INK_WASH_MEDIUM },
  flat_modern: { sheet: FLAT, page: FLAT },
  cutpaper: { sheet: CUTPAPER, page: CUTPAPER_PAGE, medium: CUTPAPER_MEDIUM },
};

export const DEFAULT_STYLE = "watercolour";
export const STYLE_VALUES = Object.keys(ART_STYLES); // wizard options + Zod enum + DB-validation list

/** Resolve a style key → { style (=sheet), page, medium, composition_rules, negative_prompt }.
 * `.style` is the SHEET vocab (sheets + preview); `.page` is the page-render vocab;
 * `.medium` is the per-style MEDIUM-token fill map for template compositions.
 * Unknown / absent → DEFAULT_STYLE (watercolour). Pure; never throws. */
export function resolveStyle(key) {
  const s = ART_STYLES[key] ?? ART_STYLES[DEFAULT_STYLE];
  return {
    style: s.sheet,
    page: s.page,
    medium: s.medium ?? WATERCOLOUR_MEDIUM,
    composition_rules: COMPOSITION_RULES,
    negative_prompt: NEGATIVE_PROMPT,
  };
}

/** Fill a template's {{MEDIUM:key}} tokens with a style's medium vocabulary.
 * Any key the style omits defaults to WATERCOLOUR_MEDIUM (so an untuned/legacy
 * style renders the watercolour medium — safe, since untuned styles are not
 * purchasable). Throws on an UNKNOWN token key (catches a template typo). A
 * template with no tokens (or a null/empty medium) passes through unchanged, so
 * watercolour with its exact fills is byte-identical to the pre-W-E template. */
export function fillMediumTokens(text, medium = WATERCOLOUR_MEDIUM) {
  return String(text ?? "").replace(/\{\{MEDIUM:(\w+)\}\}/g, (_full, key) => {
    if (!MEDIUM_TOKEN_KEYS.includes(key)) {
      throw new Error(`fillMediumTokens: unknown MEDIUM token "${key}" (valid: ${MEDIUM_TOKEN_KEYS.join(", ")})`);
    }
    return (medium && medium[key] != null) ? medium[key] : WATERCOLOUR_MEDIUM[key];
  });
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
