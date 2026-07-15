// worker/tests/pet-hero.test.js — pet-as-hero pipeline half (FEATURES_PET_HERO,
// 2026-07-09). A non-human protagonist: gender not required, no gender-based compose,
// raw pet description + coat text, multi-photo anchor, "a pet <kind>" sheet label.
// Default off = byte-identical to the human path (gender still required).
import { describe, it, expect, afterEach } from "vitest";
import { buildSubjectListForSheetGen, buildSubjectSheetBasePrompt } from "../../src/book-pipeline.js";
import { formatUserMessage } from "../../src/anthropic.js";
import { adaptOrderToPipelineInput } from "../src/adapter.js";

const PET_STORY = {
  character: "Biscuit is a medium-sized shaggy doodle dog with a wavy chocolate-brown coat, a tan beard, floppy ears, amber eyes, and a curled tail.",
  companion_characters: [{ name: "Owner", character_description: "Owner is a young woman with a warm smile." }],
  style: "soft watercolour",
  composition_rules: "single subject, centred",
  negative_prompt: "no text",
};
const PET_META = {
  inputs: {
    child: {
      name: "Biscuit",
      subject_type: "non_human",
      animal_kind: "dog",
      appearance: "rich warm chocolate/liver-brown coat, tan beard, curled tail",
      photo_paths: ["photos/pet-1.png", "photos/pet-2.png", "photos/pet-3.png"],
      // deliberately NO gender — pets have none
    },
    secondaries: [{ id: "companion-1", name: "Owner", age: 30, subject_type: "human", gender: "girl", anchor: "tier2", appearance_markers: "warm smile" }],
  },
};

describe("pet-hero: FEATURES_PET_HERO gating", () => {
  afterEach(() => { delete process.env.FEATURES_PET_HERO; delete process.env.FEATURES_COMPOSE; });

  it("flag on + non_human child: no gender required; pet protagonist built from raw description + coat text", () => {
    process.env.FEATURES_PET_HERO = "on";
    const subs = buildSubjectListForSheetGen(PET_STORY, PET_META, "Biscuit", 5);
    const p = subs.find((s) => s.isProtagonist);
    expect(p.subject_type).toBe("non_human");
    expect(p.gender).toBeNull();
    expect(p.animalKind).toBe("dog");
    expect(p.character_description).toBe(PET_STORY.character); // raw, no gender compose
    expect(p.markers).toBe("rich warm chocolate/liver-brown coat, tan beard, curled tail");
    expect(p.photoPaths).toEqual(["photos/pet-1.png", "photos/pet-2.png", "photos/pet-3.png"]);
    expect(p.viewCount).toBe(3);
  });

  it("flag on + non_human + FEATURES_COMPOSE on: still raw (no human outfit/marker compose on a pet)", () => {
    process.env.FEATURES_PET_HERO = "on";
    process.env.FEATURES_COMPOSE = "on";
    const p = buildSubjectListForSheetGen(PET_STORY, PET_META, "Biscuit", 5).find((s) => s.isProtagonist);
    expect(p.character_description).toBe(PET_STORY.character);
    expect(p.markers).toBe("rich warm chocolate/liver-brown coat, tan beard, curled tail");
  });

  it("flag OFF (default): a non_human child still hits the human path and THROWS on missing gender (byte-identical)", () => {
    expect(() => buildSubjectListForSheetGen(PET_STORY, PET_META, "Biscuit", 5))
      .toThrow(/gender is required/);
  });

  it("flag on but child stays human/absent subject_type: normal human path (gender still required)", () => {
    process.env.FEATURES_PET_HERO = "on";
    const humanMeta = { inputs: { child: { name: "Kid", age: 8, appearance: "freckly" }, secondaries: [] } };
    expect(() => buildSubjectListForSheetGen({ character: "Kid is a child." }, humanMeta, "Kid", 8))
      .toThrow(/gender is required/);
  });

  it("photoPaths falls back to a single legacy photoPath when photo_paths absent", () => {
    process.env.FEATURES_PET_HERO = "on";
    const meta = { inputs: { child: { name: "Biscuit", subject_type: "non_human", appearance: "brown", photoPath: "photos/only.png" }, secondaries: [] } };
    const p = buildSubjectListForSheetGen(PET_STORY, meta, "Biscuit", 5).find((s) => s.isProtagonist);
    expect(p.photoPaths).toEqual(["photos/only.png"]);
  });
});

describe("pet-hero: buildSubjectSheetBasePrompt label", () => {
  afterEach(() => { delete process.env.FEATURES_PET_HERO; });

  it("non-human protagonist is labelled 'a pet <kind>', not a child", () => {
    process.env.FEATURES_PET_HERO = "on";
    const p = buildSubjectListForSheetGen(PET_STORY, PET_META, "Biscuit", 5).find((s) => s.isProtagonist);
    const prompt = buildSubjectSheetBasePrompt(p, PET_STORY);
    expect(prompt).toContain("Subject: a pet dog.");
    expect(prompt).not.toContain("year-old child");
    expect(prompt).toContain("chocolate-brown coat"); // raw pet appearance flows through
  });

  it("animalKind absent → generic 'a pet animal'", () => {
    process.env.FEATURES_PET_HERO = "on";
    const meta = { inputs: { child: { name: "Biscuit", subject_type: "non_human", appearance: "brown" }, secondaries: [] } };
    const p = buildSubjectListForSheetGen(PET_STORY, meta, "Biscuit", 5).find((s) => s.isProtagonist);
    expect(buildSubjectSheetBasePrompt(p, PET_STORY)).toContain("Subject: a pet animal.");
  });
});

describe("pet-hero: formatUserMessage (story-gen input)", () => {
  afterEach(() => { delete process.env.FEATURES_PET_HERO; });

  const petInput = {
    child: { name: "Biscuit", age: 5, subject_type: "non_human", animal_kind: "dog", appearance: "chocolate doodle, tan beard, curled tail" },
    secondaries: [{ name: "Sam", age: 30, subject_type: "human", gender: "girl", anchor: "tier2", relationship: "owner", appearance_markers: "young woman, warm smile" }],
    theme: "a lost ball adventure in the park",
  };

  it("flag on: builds a Pet block (Name + Kind + Appearance, NO Gender) and does not throw", () => {
    process.env.FEATURES_PET_HERO = "on";
    const msg = formatUserMessage(petInput);
    expect(msg).toContain("Pet (the protagonist — a real animal, not a child):");
    expect(msg).toContain("Name: Biscuit");
    expect(msg).toContain("Kind: dog");
    expect(msg).toContain("Appearance: chocolate doodle, tan beard, curled tail");
    expect(msg).not.toMatch(/^\s*Gender:/m);
    expect(msg).toContain("for this pet based on the theme");
    // The human owner is still a REF-ANCHORED companion.
    expect(msg).toContain("[REF-ANCHORED] Sam");
  });

  it("flag OFF (default): pet input still requires gender and THROWS (byte-identical human path)", () => {
    expect(() => formatUserMessage(petInput)).toThrow(/gender.*is required/i);
  });
});

describe("scene-wardrobe is INERT when FEATURES_WARDROBE off (ship guard, 2026-07-09)", () => {
  afterEach(() => { delete process.env.FEATURES_WARDROBE; delete process.env.FEATURES_PET_HERO; });

  // Byte-identical proof: with the flag off, the presence/absence of a wardrobe map
  // in meta produces the SAME subject list → the wardrobe scaffolding does nothing.
  it("child path: subject list identical with vs without a wardrobe map (flag off)", () => {
    const story = { character: "Kid is a boy.", companion_characters: [] };
    const base = { inputs: { child: { name: "Kid", age: 8, gender: "boy", appearance: "freckly" }, secondaries: [] } };
    const withWd = { inputs: { child: { ...base.inputs.child, wardrobe: { keeper: "a goalkeeper kit" } }, secondaries: [] } };
    const a = buildSubjectListForSheetGen(story, withWd, "Kid", 8);
    const b = buildSubjectListForSheetGen(story, base, "Kid", 8);
    expect(a).toEqual(b);
    expect(a.find((s) => s.isProtagonist).wardrobe).toBeNull();
  });

  it("pet path: subject list identical with vs without a wardrobe map (flag off)", () => {
    process.env.FEATURES_PET_HERO = "on";
    const story = { character: "Biscuit is a dog.", companion_characters: [] };
    const base = { inputs: { child: { name: "Biscuit", subject_type: "non_human", animal_kind: "dog", appearance: "brown" }, secondaries: [] } };
    const withWd = { inputs: { child: { ...base.inputs.child, wardrobe: { keeper: "a raincoat" } }, secondaries: [] } };
    const a = buildSubjectListForSheetGen(story, withWd, "Biscuit", 5);
    const b = buildSubjectListForSheetGen(story, base, "Biscuit", 5);
    expect(a).toEqual(b);
    expect(a.find((s) => s.isProtagonist).wardrobe).toBeNull();
  });
});

describe("pet-hero: adaptOrderToPipelineInput (order → pipeline input)", () => {
  const petOrder = {
    book_type: "pet",
    child_name: "Biscuit",
    child_age: 5,
    child_gender: null,
    child_appearance: "chocolate doodle, tan beard, curled tail",
    animal_kind: "dog",
    photo_urls: { pet: ["uploads/a.png", "uploads/b.png", "uploads/c.png"] },
    secondaries: [{ name: "Sam", subject_type: "human", gender: "boy", anchor: "tier2", relationship: "owner", appearance: "young man, green jacket", age: 30 }],
    theme: "park adventure",
    art_style: "watercolour",
    age_range: "5-7",
  };

  it("pet order → non_human child with animal_kind + photo_paths, no gender, no features", () => {
    const input = adaptOrderToPipelineInput(petOrder);
    expect(input.child.subject_type).toBe("non_human");
    expect(input.child.animal_kind).toBe("dog");
    expect(input.child.gender).toBeUndefined();
    expect(input.child.photo_paths).toEqual(["uploads/a.png", "uploads/b.png", "uploads/c.png"]);
    expect(input.child.features).toBeUndefined();
    expect(input.child.appearance).toBe("chocolate doodle, tan beard, curled tail");
    // Owner is still adapted as a human secondary.
    expect(input.secondaries[0].name).toBe("Sam");
  });

  it("child order (book_type absent/child) → unchanged: gender forwarded, no subject_type/animal_kind", () => {
    const childOrder = { book_type: "child", child_name: "Mia", child_age: 6, child_gender: "girl", child_appearance: "brown hair, green eyes, freckles, red dress", age_range: "5-7", theme: "t", art_style: "watercolour", secondaries: [] };
    const input = adaptOrderToPipelineInput(childOrder);
    expect(input.child.gender).toBe("girl");
    expect(input.child.subject_type).toBeUndefined();
    expect(input.child.animal_kind).toBeUndefined();
    expect(input.child.photo_paths).toBeUndefined();
  });
});
