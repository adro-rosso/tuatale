// Art-style source of truth (W-B). Includes the ZERO-BEHAVIOUR-CHANGE guard: the
// default (watercolour) style string must be byte-identical to the pre-W-B constant,
// so the default render path is unchanged.
import { describe, it, expect } from "vitest";
import { ART_STYLES, STYLE_VALUES, DEFAULT_STYLE, resolveStyle, validateArtStyle, COMPOSITION_RULES, NEGATIVE_PROMPT } from "../../src/art-styles.js";

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

  it("ZERO-CHANGE: shared composition + negative are the pre-W-B constants", () => {
    expect(COMPOSITION_RULES).toBe("full body, centered subject, clean uncluttered background, consistent framing, face clearly visible");
    expect(NEGATIVE_PROMPT).toBe("photorealistic, scary, dark, blurry, deformed hands, extra fingers, text, watermark");
  });

  it("resolves a non-default style + unknown → watercolour", () => {
    expect(resolveStyle("flat_modern").style).toBe(ART_STYLES.flat_modern.sheet);
    expect(resolveStyle("nope").style).toBe(WATERCOLOUR);
  });

  it("W-D: the 5 new styles use page === sheet (probe string) until W-E", () => {
    for (const k of ["coloured_pencil", "painterly", "ink_wash", "flat_modern", "cutpaper"]) {
      expect(ART_STYLES[k].page).toBe(ART_STYLES[k].sheet);
    }
  });

  it("validateArtStyle: null/absent → default, known passes, unknown THROWS", () => {
    expect(validateArtStyle(null)).toBe("watercolour");
    expect(validateArtStyle(undefined)).toBe("watercolour");
    expect(validateArtStyle("")).toBe("watercolour");
    expect(validateArtStyle("cutpaper")).toBe("cutpaper");
    expect(() => validateArtStyle("bogus")).toThrow(/not a known style/);
  });
});
