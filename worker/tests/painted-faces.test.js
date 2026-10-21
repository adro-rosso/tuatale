// PAINTED_FACES (2026-10-21): flag-gated positive-axis carve-out — references define WHO, the
// medium defines HOW. Off → byte-identical (the golden-master pins that); on → the sheet mint of a
// photo-anchored HUMAN and every page prompt carry the painted-portrait directive.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { buildSheetViewPrompt } from "../../src/book-pipeline.js";
import { buildScenePrompt } from "../../src/page-pipeline.js";
import { resolveStyle } from "../../src/art-styles.js";

const story = () => {
  const s = resolveStyle("painterly");
  return { style: s.style, composition_rules: s.composition_rules, negative_prompt: s.negative_prompt, styleMedium: s.medium };
};
const human = { isProtagonist: false, subject_type: "human", age: 30, name: "Matthew", character_description: "a grown man", markers: "" };
const pet = { isProtagonist: true, subject_type: "non_human", animalKind: "dog", name: "Benji", character_description: "a labradoodle", markers: "" };
const pageArgs = {
  subjects: [{ name: "Matthew", age: 30, description: "a grown man", subjectType: "human", sheetCount: 1 }],
  scene: { page: 7, action: "pointing at the moon" },
  styleLine: resolveStyle("painterly").page,
  compositionLine: "natural candid posing",
  templateComposition: "wide band",
  negativePrompt: "photorealistic, scary",
};

beforeEach(() => { delete process.env.PAINTED_FACES; });
afterEach(() => { delete process.env.PAINTED_FACES; });

describe("PAINTED_FACES", () => {
  it("off → neither prompt mentions the painted-portrait directive", () => {
    expect(buildSheetViewPrompt(human, story(), { viewIndex: 0, subjectHasPhoto: true, usePhoto: true, hasChainRef: false })).not.toMatch(/PAINTED, NOT PHOTOGRAPHIC/);
    expect(buildScenePrompt(pageArgs)).not.toMatch(/references define WHO/);
  });

  it("on → photo-anchored human sheet mint (view-0 AND chained views) carries the directive", () => {
    process.env.PAINTED_FACES = "on";
    const v0 = buildSheetViewPrompt(human, story(), { viewIndex: 0, subjectHasPhoto: true, usePhoto: true, hasChainRef: false });
    const v1 = buildSheetViewPrompt(human, story(), { viewIndex: 1, subjectHasPhoto: true, usePhoto: false, hasChainRef: true });
    expect(v0).toMatch(/RENDERING - PAINTED, NOT PHOTOGRAPHIC/);
    expect(v1).toMatch(/RENDERING - PAINTED, NOT PHOTOGRAPHIC/);
    expect(v0.endsWith("the whole figure is one painting.")).toBe(true);
  });

  it("on → pets and non-photo subjects are untouched", () => {
    process.env.PAINTED_FACES = "on";
    expect(buildSheetViewPrompt(pet, story(), { viewIndex: 0, subjectHasPhoto: true, usePhoto: true, hasChainRef: false })).not.toMatch(/PAINTED, NOT PHOTOGRAPHIC/);
    expect(buildSheetViewPrompt(human, story(), { viewIndex: 0, subjectHasPhoto: false, usePhoto: false, hasChainRef: false })).not.toMatch(/PAINTED, NOT PHOTOGRAPHIC/);
  });

  it("on → every page prompt carries the WHO/HOW carve-out right after reference authority", () => {
    process.env.PAINTED_FACES = "on";
    const p = buildScenePrompt(pageArgs);
    expect(p).toMatch(/REFERENCE IS AUTHORITATIVE/);
    expect(p).toMatch(/The references define WHO each character is; the medium above defines HOW they are painted/);
    expect(p.indexOf("REFERENCE IS AUTHORITATIVE")).toBeLessThan(p.indexOf("references define WHO"));
  });
});
