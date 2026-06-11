// worker/tests/character-features.test.js — Spec structured inputs (2026-06-11).
// The canonical contract module: validateChildFeatures (the hard boundary) +
// the hair_style ↔ compose-phrase parity guard + isStructuredComplete.
import { describe, it, expect } from "vitest";
import {
  validateChildFeatures, FEATURE_VALUES, isStructuredComplete, composeAppearance,
} from "../../src/character-features.js";

describe("validateChildFeatures — hard boundary", () => {
  it("null / undefined → undefined (free-text path, no change)", () => {
    expect(validateChildFeatures(null, "boy")).toBeUndefined();
    expect(validateChildFeatures(undefined, "boy")).toBeUndefined();
  });
  it("valid features pass through (region defaulted on marks)", () => {
    const f = { hair_colour: "brown", hair_style: "tousled", skin_tone: "tan", eye_colour: "brown",
      outfit: { tee: "green", shorts: "khaki", shoes: "brown-boots" }, marks: [{ type: "mole", side: "left" }] };
    const out = validateChildFeatures(f, "boy");
    expect(out.hair_style).toBe("tousled");
    expect(out.outfit).toEqual({ tee: "green", shorts: "khaki", shoes: "brown-boots" });
    expect(out.marks).toEqual([{ type: "mole", side: "left", region: "cheek" }]);
  });
  it("out-of-contract value THROWS (loud)", () => {
    expect(() => validateChildFeatures({ hair_colour: "rainbow" }, "girl")).toThrow(/hair_colour/);
    expect(() => validateChildFeatures({ skin_tone: "purple" }, "girl")).toThrow(/skin_tone/);
    expect(() => validateChildFeatures({ outfit: { tee: "plaid" } }, "girl")).toThrow(/outfit\.tee/);
  });
  it("unknown axis THROWS", () => {
    expect(() => validateChildFeatures({ height: "tall" }, "girl")).toThrow(/unknown axis/);
  });
  it("gender-gate: boy + non-boy hair_style THROWS; girl OK", () => {
    expect(() => validateChildFeatures({ hair_style: "long" }, "boy")).toThrow(/not allowed for gender/);
    expect(() => validateChildFeatures({ hair_style: "pigtails" }, "boy")).toThrow(/not allowed for gender/);
    expect(validateChildFeatures({ hair_style: "long" }, "girl").hair_style).toBe("long");
    expect(validateChildFeatures({ hair_style: "buzzed" }, "boy").hair_style).toBe("buzzed");
  });
  it("marks require valid type + side", () => {
    expect(() => validateChildFeatures({ marks: [{ type: "tattoo", side: "left" }] }, "boy")).toThrow();
    expect(() => validateChildFeatures({ marks: [{ type: "mole" }] }, "boy")).toThrow();
  });
  it("empty / all-absent features → undefined", () => {
    expect(validateChildFeatures({}, "boy")).toBeUndefined();
    expect(validateChildFeatures({ outfit: {} }, "boy")).toBeUndefined();
  });
});

describe("hair_style parity — every contract value has a compose phrase (no silent fallback)", () => {
  for (const style of FEATURE_VALUES.hair_style) {
    it(`"${style}" composes to a style-specific phrase`, () => {
      const out = composeAppearance({ hair_style: style, hair_colour: "brown" }, "");
      // The bare fallback (a value missing from HAIR_STYLE_PHRASE) would yield
      // exactly "brown hair". Every contract value must do better than that.
      expect(out).not.toBe("brown hair");
      expect(out.length).toBeGreaterThan(0);
    });
  }
});

describe("isStructuredComplete", () => {
  it("true only with all 4 identity axes", () => {
    expect(isStructuredComplete({ hair_colour: "brown", hair_style: "tousled", skin_tone: "tan", eye_colour: "brown" })).toBe(true);
    expect(isStructuredComplete({ hair_colour: "brown", hair_style: "tousled", skin_tone: "tan" })).toBe(false);
    expect(isStructuredComplete(null)).toBe(false);
    expect(isStructuredComplete(undefined)).toBe(false);
  });
});
