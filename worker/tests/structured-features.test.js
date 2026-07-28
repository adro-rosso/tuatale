// worker/tests/structured-features.test.js — Spec structured-inputs (2026-06-11).
// injectOutfit (protagonist, value-driven) + the buildSubjectListForSheetGen wiring
// (FEATURES_COMPOSE gate) + a D-R regression (secondaries keep the id-derived
// shirt-colour palette, untouched by the new protagonist path).
import { describe, it, expect, afterEach } from "vitest";
import { injectOutfit, buildSubjectListForSheetGen } from "../../src/book-pipeline.js";

describe("injectOutfit — protagonist, value-driven, pure", () => {
  it("boy: tee + shorts + shoes appended", () => {
    expect(injectOutfit("Base.", { gender: "boy" }, { outfit: { tee: "green", shorts: "khaki", shoes: "brown-boots" } }))
      .toBe("Base. His t-shirt is a solid green. His shorts are khaki. His shoes are brown boots.");
  });
  it("girl / non_binary pronouns", () => {
    expect(injectOutfit("B.", { gender: "girl" }, { outfit: { tee: "red" } })).toBe("B. Her t-shirt is a solid red.");
    expect(injectOutfit("B.", { gender: "non_binary" }, { outfit: { shoes: "black" } })).toBe("B. Their shoes are black.");
  });
  it("partial outfit only appends what's set", () => {
    expect(injectOutfit("B.", { gender: "boy" }, { outfit: { shorts: "navy" } })).toBe("B. His shorts are navy.");
  });
  it("no outfit / empty outfit → description unchanged", () => {
    expect(injectOutfit("B.", { gender: "boy" }, {})).toBe("B.");
    expect(injectOutfit("B.", { gender: "boy" }, { outfit: {} })).toBe("B.");
    expect(injectOutfit("B.", { gender: "boy" }, null)).toBe("B.");
  });
});

const STORY = {
  character: "Kid is a boy with a mole on his left cheek. He wears a t-shirt.",
  companion_characters: [{ name: "Dad", character_description: "Dad is a tall man." }],
};
const META = {
  inputs: {
    child: {
      name: "Kid", age: 8, gender: "boy", appearance: "freckly",
      features: {
        hair_colour: "brown", hair_style: "tousled", skin_tone: "tan", build: "sturdy",
        outfit: { tee: "green", shorts: "khaki", shoes: "brown-boots" },
        marks: [{ type: "mole", side: "left", region: "cheek" }],
      },
    },
    secondaries: [{ id: "companion-1", name: "Dad", age: 40, subject_type: "human", gender: "boy", anchor: "tier2", appearance_markers: "tall" }],
  },
};

describe("buildSubjectListForSheetGen wiring", () => {
  afterEach(() => { delete process.env.FEATURES_COMPOSE; });

  it("FEATURES_COMPOSE=on: protagonist gets composed markers + injected outfit + bared mole", () => {
    process.env.FEATURES_COMPOSE = "on";
    const subs = buildSubjectListForSheetGen(STORY, META, "Kid", 8);
    const p = subs.find((s) => s.isProtagonist);
    expect(p.markers).toBe("tousled brown hair; tan skin; sturdy build; also: freckly");
    expect(p.character_description).toContain("His t-shirt is a solid green.");
    expect(p.character_description).toContain("His shorts are khaki.");
    expect(p.character_description).toContain("His shoes are brown boots.");
    expect(p.character_description).toContain("a small faint mole on his left cheek"); // de-emphasis (default-on)
  });

  it("FEATURES_COMPOSE off (default): legacy — markers = raw appearance, no outfit injection", () => {
    const subs = buildSubjectListForSheetGen(STORY, META, "Kid", 8);
    const p = subs.find((s) => s.isProtagonist);
    expect(p.markers).toBe("freckly");
    expect(p.character_description).not.toContain("solid green");
    expect(p.character_description).toContain("a small faint mole on his left cheek"); // de-emphasis still default-on
  });

  it("D-R regression: secondary keeps id-derived shirt palette regardless of FEATURES_COMPOSE", () => {
    process.env.FEATURES_COMPOSE = "on";
    const subs = buildSubjectListForSheetGen(STORY, META, "Kid", 8);
    const dad = subs.find((s) => !s.isProtagonist);
    expect(dad.character_description).toContain("His t-shirt is a solid denim blue."); // companion-1 → palette[0]
    expect(dad.markers).toBe("tall");
  });
});

// Secondary multi-photo anchoring + shirt-lock photo-guard (2026-07-24). Levers:
//   1. secondaries get ALL their photos as photoPaths (was: only photos[0] singular);
//   2. the invented shirt-colour is SUPPRESSED for a photo-anchored secondary.
// The byte-identical guard: single-protagonist, text-only, and no-photo secondaries
// are unchanged — incl. a stable fingerprint (only photo-anchored secondaries change).
describe("secondary photo-anchor plumbing + shirt-lock guard", () => {
  const secWith = (extra) => ({
    inputs: {
      child: { name: "Kid", age: 8, gender: "boy", appearance: "freckly" },
      secondaries: [{ id: "companion-1", name: "Dad", age: 40, subject_type: "human", gender: "boy", anchor: "tier2", appearance_markers: "tall", ...extra }],
    },
  });

  it("photo-anchored secondary: photoPaths = ALL photos, shirt clause SUPPRESSED", () => {
    const subs = buildSubjectListForSheetGen(STORY, secWith({ photo_paths: ["p1.png", "p2.png", "p3.png"] }), "Kid", 8);
    const dad = subs.find((s) => !s.isProtagonist);
    expect(dad.photoPaths).toEqual(["p1.png", "p2.png", "p3.png"]); // all photos, not just [0]
    expect(dad.character_description).not.toMatch(/t-shirt is a solid/i); // invented outfit gone
    expect(dad.character_description).toBe("Dad is a tall man."); // exactly the raw description
  });

  it("legacy singular photoPath still anchors (fallback → photoPaths=[photoPath], shirt suppressed)", () => {
    const subs = buildSubjectListForSheetGen(STORY, secWith({ photoPath: "solo.png" }), "Kid", 8);
    const dad = subs.find((s) => !s.isProtagonist);
    expect(dad.photoPaths).toEqual(["solo.png"]);
    expect(dad.character_description).not.toMatch(/t-shirt is a solid/i);
  });

  it("BYTE-IDENTICAL — no-photo secondary: photoPaths=null, shirt clause PRESENT (fingerprint stable)", () => {
    const subs = buildSubjectListForSheetGen(STORY, secWith({}), "Kid", 8);
    const dad = subs.find((s) => !s.isProtagonist);
    expect(dad.photoPaths).toBeNull();
    // character_description is the fingerprint input (buildAppearanceForFingerprint =
    // maskName(character_description)). Unchanged string → unchanged fingerprint → no
    // spurious re-mint of an existing no-photo secondary's sheet.
    expect(dad.character_description).toBe("Dad is a tall man. His t-shirt is a solid denim blue.");
  });

  it("BYTE-IDENTICAL — single-protagonist / text-only book: only the protagonist, unchanged", () => {
    const soloStory = { character: STORY.character, companion_characters: [] };
    const soloMeta = { inputs: { child: { name: "Kid", age: 8, gender: "boy", appearance: "freckly" }, secondaries: [] } };
    const subs = buildSubjectListForSheetGen(soloStory, soloMeta, "Kid", 8);
    expect(subs).toHaveLength(1);
    expect(subs[0].isProtagonist).toBe(true);
    expect(subs[0].photoPaths ?? null).toBeNull();
  });
});
