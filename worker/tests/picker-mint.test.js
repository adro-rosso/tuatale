// worker/tests/picker-mint.test.js — book-faithful picker option mint (Slice 2, $0).
// Proves the ONE invariant that must hold under decision (B): a picker option is minted
// through the BOOK's real view-0 path — REFERENCE-IS-AUTHORITATIVE + the real art style +
// the brand composition — NOT the loose cream-bg PHOTO_COND preview. (B) relaxes the
// description SOURCE, never the faithfulness of the mint.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildPickerSubject, buildFaithfulStory } from "../../src/picker-mint.js";
import { buildSubjectViewZeroPrompt } from "../../src/book-pipeline.js";
import { resolveStyle, COMPOSITION_RULES, NEGATIVE_PROMPT } from "../../src/art-styles.js";

const prev = {};
beforeAll(() => {
  for (const k of ["FEATURES_COMPOSE", "FEATURES_PET_HERO"]) { prev[k] = process.env[k]; process.env[k] = "on"; }
});
afterAll(() => {
  for (const k of Object.keys(prev)) { if (prev[k] === undefined) delete process.env[k]; else process.env[k] = prev[k]; }
});

const promptFor = (role, inputs, artStyle) => {
  const story = buildFaithfulStory(artStyle);
  return buildSubjectViewZeroPrompt(buildPickerSubject({ role, inputs, story }), story);
};
const CHILD = { name: "Kid", age: 6, gender: "boy", subject_type: "human", appearance: "a cheerful child with brown hair", photoPaths: [] };
const ADULT = { name: "Marcus", age: 40, gender: "boy", subject_type: "human", is_adult: true, appearance: "a grown man with a beard", photoPaths: [] };
const PET = { name: "Benji", subject_type: "non_human", animal_kind: "dog", appearance: "a chocolate labradoodle with a tan beard", photoPaths: [] };
const SECONDARY = { id: "companion-1", name: "Nicki", subject_type: "human", gender: "girl", is_adult: true, appearance: "a grown woman with bangs", photoPaths: [] };

describe("picker-mint — book-faithful (not the loose preview)", () => {
  it("buildFaithfulStory uses the BRAND composition + negative + real art style (NOT preview cream-bg)", () => {
    const s = buildFaithfulStory("coloured_pencil");
    expect(s.style).toBe(resolveStyle("coloured_pencil").style);
    expect(s.composition_rules).toBe(COMPOSITION_RULES);
    expect(s.negative_prompt).toBe(NEGATIVE_PROMPT);
    expect(s.composition_rules).not.toContain("cream"); // preview-local marker must be absent
  });

  it("protagonist child: REFERENCE-IS-AUTHORITATIVE + real style, NOT PHOTO_COND", () => {
    const p = promptFor("protagonist", CHILD, "watercolour");
    expect(p).toContain("REFERENCE IS AUTHORITATIVE");
    expect(p).toContain(`Style: ${resolveStyle("watercolour").style}`);
    expect(p).toContain(`Composition: ${COMPOSITION_RULES}`);
    expect(p).not.toContain("DRAW AN ORIGINAL"); // the loose preview PHOTO_COND
  });

  it("adult protagonist → 'an adult' label, human REF-AUTH, real style", () => {
    const p = promptFor("protagonist", ADULT, "ink_wash");
    expect(p).toContain("an adult");
    expect(p).toContain("person's face, hair, skin tone, and build"); // human REF-AUTH variant
    expect(p).toContain(resolveStyle("ink_wash").style);
    expect(p).not.toContain("DRAW AN ORIGINAL");
  });

  it("pet protagonist → pet REF-AUTH variant + real style", () => {
    const p = promptFor("protagonist", PET, "painterly");
    expect(p).toContain("animal's coat colour, markings, and shape"); // pet REF-AUTH variant
    expect(p).toContain(resolveStyle("painterly").style);
    expect(p).not.toContain("DRAW AN ORIGINAL");
  });

  it("human secondary: built via the companion path, REFERENCE-IS-AUTHORITATIVE present", () => {
    const p = promptFor("secondary", SECONDARY, "watercolour");
    expect(p).toContain("Nicki");
    expect(p).toContain("REFERENCE IS AUTHORITATIVE");
    expect(p).not.toContain("DRAW AN ORIGINAL");
  });
});
