// Adaptive cover title-colour pick (2026-07-07). The integrated cover title reads
// dark (espresso) on a light title-zone and light (cream) on a dark one; cream is
// the safe fallback for dark/ambiguous zones. Tests the pure brightness→colour
// mapping and the end-to-end sampler on synthetic solid heroes.
import { describe, it, expect } from "vitest";
import sharp from "sharp";
import {
  luma,
  pickTitleColorFromLuma,
  sampleTitleZoneLuma,
  pickTitleColor,
  LIGHT_LUMA_THRESHOLD,
} from "../../src/cover-title-color.js";

// A solid HxW image of one colour (title zone is that colour everywhere).
function solid(r, g, b, w = 400, h = 300) {
  return sharp({ create: { width: w, height: h, channels: 3, background: { r, g, b } } })
    .png()
    .toBuffer();
}

describe("cover title-colour pick", () => {
  it("threshold is a sane 0-255 mid value", () => {
    expect(LIGHT_LUMA_THRESHOLD).toBeGreaterThan(0);
    expect(LIGHT_LUMA_THRESHOLD).toBeLessThan(255);
  });

  it("luma uses Rec.709 weights (green dominates, blue least)", () => {
    expect(luma(255, 0, 0)).toBeCloseTo(54.2, 0);
    expect(luma(0, 255, 0)).toBeCloseTo(182.4, 0);
    expect(luma(0, 0, 255)).toBeCloseTo(18.4, 0);
    expect(luma(255, 255, 255)).toBeCloseTo(255, 0);
    expect(luma(0, 0, 0)).toBe(0);
  });

  describe("pickTitleColorFromLuma (zone brightness → colour)", () => {
    it("clearly LIGHT zone → espresso", () => {
      expect(pickTitleColorFromLuma(255)).toBe("espresso"); // white
      expect(pickTitleColorFromLuma(200)).toBe("espresso"); // pale
      expect(pickTitleColorFromLuma(163)).toBe("espresso"); // painterly/cutpaper measured
    });

    it("clearly DARK zone → cream", () => {
      expect(pickTitleColorFromLuma(0)).toBe("cream"); // black
      expect(pickTitleColorFromLuma(40)).toBe("cream"); // night
      expect(pickTitleColorFromLuma(90)).toBe("cream"); // dim
    });

    it("AMBIGUOUS mid-tone below threshold → cream (safe fallback)", () => {
      expect(pickTitleColorFromLuma(LIGHT_LUMA_THRESHOLD - 1)).toBe("cream");
      expect(pickTitleColorFromLuma(120)).toBe("cream");
    });

    it("exactly AT threshold → espresso (inclusive light boundary)", () => {
      expect(pickTitleColorFromLuma(LIGHT_LUMA_THRESHOLD)).toBe("espresso");
    });

    it("invalid input → cream", () => {
      expect(pickTitleColorFromLuma(NaN)).toBe("cream");
      expect(pickTitleColorFromLuma(undefined)).toBe("cream");
      expect(pickTitleColorFromLuma(null)).toBe("cream");
      expect(pickTitleColorFromLuma("163")).toBe("cream");
    });
  });

  describe("sampleTitleZoneLuma + pickTitleColor (end-to-end on synthetic heroes)", () => {
    it("light solid hero → high luma → espresso", async () => {
      const buf = await solid(230, 230, 235); // pale grey
      const zl = await sampleTitleZoneLuma(buf);
      expect(zl).toBeGreaterThanOrEqual(LIGHT_LUMA_THRESHOLD);
      expect(await pickTitleColor(buf)).toBe("espresso");
    });

    it("dark solid hero → low luma → cream", async () => {
      const buf = await solid(30, 28, 34); // near-black
      const zl = await sampleTitleZoneLuma(buf);
      expect(zl).toBeLessThan(LIGHT_LUMA_THRESHOLD);
      expect(await pickTitleColor(buf)).toBe("cream");
    });

    it("invalid image input → null luma → cream fallback", async () => {
      expect(await sampleTitleZoneLuma(Buffer.from("not an image"))).toBeNull();
      expect(await pickTitleColor(Buffer.from("not an image"))).toBe("cream");
    });
  });
});
