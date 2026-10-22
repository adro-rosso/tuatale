// Baked fade (2026-10-22): the band templates' CSS mask-image became a PDF soft mask + shading
// that Edge's Adobe engine dropped (blank illustrations). The fade is now blended into the
// raster; the template gets an opaque image. These pin the geometry mapping and the blend.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { computeFadeSpan, bakeFade } from "../../src/page-pipeline.js";

const PAGE = { pageWidthIn: 11, pageHeightIn: 8.5 };

describe("computeFadeSpan", () => {
  it("prompt-7: 16:9 image into a 100%×70% band anchored top → fade starts at 82% of the BAND, mapped into image px", () => {
    const span = computeFadeSpan({ ...PAGE, imageWidth: 1600, imageHeight: 900,
      fade: { box: { width: 1, height: 0.7 }, objectPosition: "center top", direction: "bottom", start: 0.82 } });
    // cover: scale = max(11/1600, 5.95/900) = 0.006875 (width-bound); visible height = 5.95/0.006875 = 865.45px
    expect(span.axis).toBe("y");
    expect(span.opaqueUntil).toBeCloseTo(865.45 * 0.82, 0);
    expect(span.transparentAt).toBeCloseTo(865.45, 0);
    expect(span.transparentAt).toBeLessThan(900); // the cropped strip below is irrelevant
  });

  it("prompt-2: right-anchored 65% column, transparent at the LEFT edge up to 18%", () => {
    const span = computeFadeSpan({ ...PAGE, imageWidth: 1600, imageHeight: 900,
      fade: { box: { left: 0.35, width: 0.65, height: 1 }, objectPosition: "right center", direction: "left", end: 0.18 } });
    expect(span.axis).toBe("x");
    expect(span.side).toBe("start");
    expect(span.transparentAt).toBeGreaterThan(0);       // visible rect starts inside the image (right-anchored crop)
    expect(span.opaqueUntil).toBeGreaterThan(span.transparentAt);
  });

  it("unknown direction throws", () => {
    expect(() => computeFadeSpan({ ...PAGE, imageWidth: 10, imageHeight: 10, fade: { direction: "up" } })).toThrow(/unknown direction/);
  });
});

describe("bakeFade", () => {
  it("no fade in config → returns the raw path untouched", async () => {
    const out = await bakeFade({ imagePath: "x.png", outDir: "/nope", pageNumStr: "01", config: { rendering: {} } });
    expect(out).toBe("x.png");
  });

  it("writes an OPAQUE jpeg whose faded edge is page cream and whose body is the image", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bake-fade-"));
    const raw = path.join(dir, "page-01.png");
    await sharp({ create: { width: 320, height: 180, channels: 3, background: "#2040c0" } }).png().toFile(raw); // solid blue
    const config = { rendering: { pageSize: { width: "11in", height: "8.5in" },
      fade: { box: { width: 1, height: 0.7 }, objectPosition: "center top", direction: "bottom", start: 0.6, background: "#FAF9F0" } } };
    const out = await bakeFade({ imagePath: raw, outDir: dir, pageNumStr: "01", config });
    expect(out).toBe(path.join(dir, "page-01-faded.jpg"));
    const meta = await sharp(out).metadata();
    expect(meta.channels).toBe(3); // flattened: no alpha → no PDF soft mask
    const { data, info } = await sharp(out).raw().toBuffer({ resolveWithObject: true });
    const px = (x, y) => { const i = (y * info.width + x) * info.channels; return [data[i], data[i + 1], data[i + 2]]; };
    const top = px(160, 10); expect(Math.abs(top[0] - 0x20)).toBeLessThan(6); expect(Math.abs(top[2] - 0xc0)).toBeLessThan(6); // top: image (JPEG-tolerant)
    const bottom = px(160, 178);                              // below the visible band: page cream
    expect(bottom[0]).toBeGreaterThan(240); expect(bottom[2]).toBeGreaterThan(230);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
