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
