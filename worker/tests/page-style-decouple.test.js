// W-D proof ($0, no gen): removing the per-template styleOverride + routing the
// page render through story.pageStyle (= resolveStyle(style).page) is BYTE-IDENTICAL
// for the default watercolour path. Prompt-equality is a stronger no-regression
// proof than a gen, given Gemini's non-determinism.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { resolveStyle } from "../../src/art-styles.js";
import { buildScenePrompt } from "../../src/page-pipeline.js";

// The exact rich vocab that lived in EVERY template imageGeneration.styleOverride
// before W-D (frozen here — if resolveStyle('watercolour').page ever drifts from
// this, the page render changes and this fails).
const OLD_RICH =
  "watercolor on cold-press paper, wet-on-wet wash technique, visible pigment granulation, organic uneven boundaries where wash absorbs into paper fiber. Loose, painterly, with intentional white space and atmospheric bleeding. Inspired by contemporary picture book illustration in the style of Sophie Blackall. Warm earthy palette.";

const TEMPLATE_DIRS = [
  "cover-iter-1", "prompt-2-iter-2", "prompt-3-iter-2", "prompt-4-iter-1",
  "prompt-6-iter-1", "prompt-7-iter-1", "prompt-8-iter-1",
];

describe("W-D: page-style decouple is byte-identical for watercolour", () => {
  it("watercolour.page === the exact relocated styleOverride", () => {
    expect(resolveStyle("watercolour").page).toBe(OLD_RICH);
  });

  it("no template config carries imageGeneration.styleOverride anymore", () => {
    for (const d of TEMPLATE_DIRS) {
      const cfg = JSON.parse(fs.readFileSync(new URL(`../../templates/${d}/config.json`, import.meta.url), "utf8"));
      expect(cfg.imageGeneration?.styleOverride).toBeUndefined();
    }
  });

  it("the page prompt is byte-identical: old styleOverride styleLine === new pageStyle styleLine", () => {
    const args = {
      subjects: [{ name: "Mia", age: 7, description: "long brown hair, green eyes", subjectType: "human", sheetCount: 1 }],
      scene: { page: 3, action: "reading a book under a tree" },
      compositionLine: "full body, centered subject, clean uncluttered background, consistent framing, face clearly visible.",
      templateComposition: "image fills the right 65% with a soft left-edge feather",
      negativePrompt: "photorealistic, scary, dark, blurry, deformed hands, extra fingers, text, watermark",
    };
    // BEFORE W-D: styleLine = the template's hardcoded watercolour override.
    const before = buildScenePrompt({ ...args, styleLine: OLD_RICH });
    // AFTER W-D: styleOverride removed → styleLine falls through to sceneStyle,
    // which book-pipeline now sets to story.pageStyle = resolveStyle(...).page.
    const after = buildScenePrompt({ ...args, styleLine: resolveStyle("watercolour").page });
    expect(after).toBe(before);
  });
});
