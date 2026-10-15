// Art-style source of truth (W-B). Includes the ZERO-BEHAVIOUR-CHANGE guard: the
// default (watercolour) style string must be byte-identical to the pre-W-B constant,
// so the default render path is unchanged.
import { describe, it, expect, afterEach } from "vitest";
import { ART_STYLES, STYLE_VALUES, DEFAULT_STYLE, resolveStyle, validateArtStyle, COMPOSITION_RULES, COMPOSITION_RULES_NATURAL, NEGATIVE_PROMPT, NEGATIVE_BORDER_TERMS, pageCompositionRules, pageNegativePrompt } from "../../src/art-styles.js";

// The exact watercolour string that lived in anthropic.js / character-preview.js
// before W-B. If this ever drifts, the default book + preview change — fail loudly.
const WATERCOLOUR = "soft watercolor children's book illustration, warm lighting, gentle shadows, storybook style, muted earthy palette";

describe("art-styles source of truth", () => {
  it("has the 6 committed styles, default = watercolour", () => {
    expect(STYLE_VALUES).toEqual(["watercolour", "coloured_pencil", "painterly", "ink_wash", "flat_modern", "cutpaper"]);
    expect(DEFAULT_STYLE).toBe("watercolour");
  });

  it("ZERO-CHANGE: default + watercolour SHEET resolve to the exact pre-W-B string", () => {
    expect(resolveStyle(undefined).style).toBe(WATERCOLOUR);
    expect(resolveStyle("watercolour").style).toBe(WATERCOLOUR);
    expect(ART_STYLES.watercolour.sheet).toBe(WATERCOLOUR);
  });

  it("shared composition + hardened negative prompt", () => {
    expect(COMPOSITION_RULES).toBe("full body, centered subject, clean uncluttered background, consistent framing, face clearly visible");
    // NEGATIVE_PROMPT hardened 2026-07-06 (reading-level Step 2): the bare "text"
    // let Gemini paint garbled lettering into a page; expanded to explicit
    // letters/words/captions/lettering/numbers/signage so no book gets painted text.
    expect(NEGATIVE_PROMPT).toBe("photorealistic, scary, dark, blurry, deformed hands, extra fingers, text, letters, words, captions, lettering, numbers, signage, watermark");
  });

  it("resolves a non-default style + unknown → watercolour", () => {
    expect(resolveStyle("flat_modern").style).toBe(ART_STYLES.flat_modern.sheet);
    expect(resolveStyle("nope").style).toBe(WATERCOLOUR);
  });

  it("W-E: tuned styles extend the sheet with page-vocab clauses; flat_modern (sole preview-only) stays page === sheet", () => {
    // W-E (2026-07-06/07) gave the 4 purchasable non-watercolour styles a `.page`
    // = `.sheet` + EDGE_FILL_EMPHASIS (and NO_FRAME_EMPHASIS for the graphic media),
    // so page must EXTEND the sheet: start with it, but differ.
    for (const k of ["coloured_pencil", "painterly", "ink_wash", "cutpaper"]) {
      expect(ART_STYLES[k].page).not.toBe(ART_STYLES[k].sheet);
      expect(ART_STYLES[k].page.startsWith(ART_STYLES[k].sheet)).toBe(true);
    }
    // flat_modern is the only remaining preview-only style — untuned, page === sheet.
    expect(ART_STYLES.flat_modern.page).toBe(ART_STYLES.flat_modern.sheet);
  });

  it("validateArtStyle: null/absent → default, known passes, unknown THROWS", () => {
    expect(validateArtStyle(null)).toBe("watercolour");
    expect(validateArtStyle(undefined)).toBe("watercolour");
    expect(validateArtStyle("")).toBe("watercolour");
    expect(validateArtStyle("cutpaper")).toBe("cutpaper");
    expect(() => validateArtStyle("bogus")).toThrow(/not a known style/);
  });
});

describe("pageCompositionRules — ART_NATURAL_ENABLED page-composition gate", () => {
  afterEach(() => { delete process.env.ART_NATURAL_ENABLED; });

  it("flag OFF: returns the template's own customCompositionRules unchanged (byte-identical)", () => {
    delete process.env.ART_NATURAL_ENABLED;
    expect(pageCompositionRules("full body, clean uncluttered background, consistent framing, face clearly visible."))
      .toBe("full body, clean uncluttered background, consistent framing, face clearly visible.");
  });

  it("flag OFF + no template rule: falls back to the stiff default", () => {
    delete process.env.ART_NATURAL_ENABLED;
    expect(pageCompositionRules(undefined))
      .toBe("full body, centered subject, clean uncluttered background, consistent framing, face clearly visible.");
  });

  it("flag ON: returns the natural rule, overriding any template rule", () => {
    process.env.ART_NATURAL_ENABLED = "on";
    expect(pageCompositionRules("full body, centered subject, face clearly visible.")).toBe(COMPOSITION_RULES_NATURAL);
    expect(pageCompositionRules(undefined)).toBe(COMPOSITION_RULES_NATURAL);
    expect(COMPOSITION_RULES_NATURAL).not.toBe(COMPOSITION_RULES); // genuinely different direction
  });

  it("flag must be exactly 'on' (fail-closed)", () => {
    for (const v of ["", "true", "ON", "1", "yes"]) {
      process.env.ART_NATURAL_ENABLED = v;
      expect(pageCompositionRules("x")).toBe("x");
    }
  });
});

describe("pageNegativePrompt — ART_NATURAL_ENABLED page-negative border gate", () => {
  afterEach(() => { delete process.env.ART_NATURAL_ENABLED; });

  it("flag OFF: returns the base negative unchanged (byte-identical)", () => {
    delete process.env.ART_NATURAL_ENABLED;
    expect(pageNegativePrompt(NEGATIVE_PROMPT)).toBe(NEGATIVE_PROMPT);
    expect(pageNegativePrompt(undefined)).toBe(NEGATIVE_PROMPT); // falls back to the brand constant
  });

  it("flag ON: appends the border terms to the base negative", () => {
    process.env.ART_NATURAL_ENABLED = "on";
    const out = pageNegativePrompt(NEGATIVE_PROMPT);
    expect(out.startsWith(NEGATIVE_PROMPT)).toBe(true);
    expect(out).toContain("border");
    expect(out).toContain("ruled line");
    expect(out).toBe(`${NEGATIVE_PROMPT}, ${NEGATIVE_BORDER_TERMS}`);
  });

  it("never touches NEGATIVE_PROMPT itself (sheet mint + golden unchanged)", () => {
    process.env.ART_NATURAL_ENABLED = "on";
    pageNegativePrompt(NEGATIVE_PROMPT);
    expect(NEGATIVE_PROMPT).toBe("photorealistic, scary, dark, blurry, deformed hands, extra fingers, text, letters, words, captions, lettering, numbers, signage, watermark");
  });
});
