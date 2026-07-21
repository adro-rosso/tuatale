// worker/tests/adapter.test.js — pure unit tests (no DB, no network).

import { describe, it, expect } from "vitest";
import {
  adaptOrderToPipelineInput,
  adaptSecondary,
  defaultAgeForSecondary,
  deriveAnchor,
} from "../src/adapter.js";

describe("deriveAnchor", () => {
  it("human → tier2", () => {
    expect(deriveAnchor({ subject_type: "human" })).toBe("tier2");
  });
  it("non_human without extra_care → tier1", () => {
    expect(deriveAnchor({ subject_type: "non_human", extra_care: false })).toBe("tier1");
  });
  it("non_human with extra_care → tier2", () => {
    expect(deriveAnchor({ subject_type: "non_human", extra_care: true })).toBe("tier2");
  });
});

describe("defaultAgeForSecondary", () => {
  it("non_human → 5", () => {
    expect(defaultAgeForSecondary({ subject_type: "non_human" })).toBe(5);
  });
  it("human without explicit age → 30", () => {
    expect(defaultAgeForSecondary({ subject_type: "human" })).toBe(30);
  });
  it("human with explicit age → that age", () => {
    expect(defaultAgeForSecondary({ subject_type: "human", age: 8 })).toBe(8);
  });
});

describe("adaptSecondary", () => {
  it("adult human → tier2, age 30, gender forwarded, appearance→appearance_markers", () => {
    const out = adaptSecondary(
      { name: "Mum", subject_type: "human", gender: "girl", relationship: "parent", appearance: "long dark hair, glasses, green scarf", extra_care: false },
      0,
    );
    expect(out).toMatchObject({
      id: "companion-1",
      name: "Mum",
      age: 30,
      subject_type: "human",
      anchor: "tier2",
      gender: "girl",
      relationship: "parent",
      appearance_markers: "long dark hair, glasses, green scarf",
    });
    expect(out).not.toHaveProperty("appearance");
    expect(out).not.toHaveProperty("extra_care");
  });

  it("child human with explicit age → tier2, age from input", () => {
    const out = adaptSecondary(
      { name: "Theo", subject_type: "human", gender: "boy", relationship: "sibling", appearance: "short curly hair, red tee", age: 7 },
      1,
    );
    expect(out.age).toBe(7);
    expect(out.anchor).toBe("tier2");
    expect(out.id).toBe("companion-2");
  });

  it("pet (non_human) → tier1, age 5, NO gender field", () => {
    const out = adaptSecondary(
      { name: "Pepper", subject_type: "non_human", relationship: "pet", appearance: "small scruffy grey-and-white dog, red collar", extra_care: false },
      0,
    );
    expect(out.anchor).toBe("tier1");
    expect(out.age).toBe(5);
    expect(out.subject_type).toBe("non_human");
    expect(out).not.toHaveProperty("gender");
  });

  it("pet with extra_care → tier2 (still no gender, still age 5)", () => {
    const out = adaptSecondary(
      { name: "Pepper", subject_type: "non_human", relationship: "pet", appearance: "small scruffy grey-and-white dog", extra_care: true },
      0,
    );
    expect(out.anchor).toBe("tier2");
    expect(out.age).toBe(5);
    expect(out).not.toHaveProperty("gender");
  });

  it("toy (non_human) → tier1", () => {
    const out = adaptSecondary(
      { name: "Mr Bear", subject_type: "non_human", relationship: "toy", appearance: "brown teddy, blue ribbon", extra_care: false },
      0,
    );
    expect(out.anchor).toBe("tier1");
  });

  it("uses explicit secondary_id when present, else synthesizes companion-N", () => {
    expect(adaptSecondary({ name: "A", subject_type: "human", gender: "boy", relationship: "friend", appearance: "x", secondary_id: "kept-id" }, 0).id).toBe("kept-id");
    expect(adaptSecondary({ name: "B", subject_type: "human", gender: "girl", relationship: "friend", appearance: "y" }, 2).id).toBe("companion-3");
  });

  it("preserves a photos array if present (forward-compat)", () => {
    const out = adaptSecondary(
      { name: "Mum", subject_type: "human", gender: "girl", relationship: "parent", appearance: "x", photos: ["a.jpg", "b.jpg"] },
      0,
    );
    expect(out.photos).toEqual(["a.jpg", "b.jpg"]);
  });

  it("does NOT default a missing gender on a human (surfaces as undefined)", () => {
    // The wizard's Zod refine enforces gender on humans; absence = data
    // corruption. The adapter must not paper over it — pipeline validator throws.
    const out = adaptSecondary(
      { name: "Ghost", subject_type: "human", relationship: "friend", appearance: "x" },
      0,
    );
    expect("gender" in out).toBe(true);
    expect(out.gender).toBeUndefined();
  });
});

describe("adaptOrderToPipelineInput", () => {
  const baseOrder = {
    child_name: "Elena",
    child_age: 5,
    child_gender: "girl",
    child_appearance: "wavy auburn hair, freckles, yellow rain boots",
    theme: "lost in the park",
    age_range: "5-7",
  };

  it("maps child + theme + ageRange, empty secondaries → []", () => {
    const input = adaptOrderToPipelineInput({ ...baseOrder, secondaries: [] });
    expect(input).toEqual({
      // background absent on this legacy order → null (heritage clause omitted).
      child: { name: "Elena", age: 5, gender: "girl", appearance: "wavy auburn hair, freckles, yellow rain boots", background: null },
      secondaries: [],
      theme: "lost in the park",
      // art_style absent on this legacy order → defaults to watercolour (W-C).
      style: "watercolour",
      // dedication_message absent → null (auto-default renders).
      dedicationMessage: null,
      ageRange: "5-7",
      // reading_level absent on this order → undefined (generateStory defaults
      // from ageRange). toEqual ignores undefined, listed here for documentation.
      reading_level: undefined,
    });
  });

  it("handles a null/absent secondaries field", () => {
    const input = adaptOrderToPipelineInput({ ...baseOrder });
    expect(input.secondaries).toEqual([]);
  });

  it("adapts a mixed secondaries array with correct indices", () => {
    const input = adaptOrderToPipelineInput({
      ...baseOrder,
      secondaries: [
        { name: "Theo", subject_type: "human", gender: "boy", relationship: "sibling", appearance: "curly hair, red tee" },
        { name: "Pepper", subject_type: "non_human", relationship: "pet", appearance: "scruffy grey dog", extra_care: false },
      ],
    });
    expect(input.secondaries).toHaveLength(2);
    expect(input.secondaries[0]).toMatchObject({ id: "companion-1", anchor: "tier2", subject_type: "human", gender: "boy" });
    expect(input.secondaries[1]).toMatchObject({ id: "companion-2", anchor: "tier1", subject_type: "non_human" });
  });

  // ---- book_type='adult' (engine-activation slice, 2026-07-21) ---------------
  describe("book_type='adult'", () => {
    const adultOrder = {
      ...baseOrder,
      book_type: "adult",
      child_name: "Marcus",
      child_age: 38,
      child_gender: "boy",
      child_appearance: "a man with a short grey beard and tortoiseshell glasses",
      vibe: "roast",
    };

    it("sets audience='adult' — the one field that activates the engine", () => {
      expect(adaptOrderToPipelineInput({ ...adultOrder, secondaries: [] }).audience).toBe("adult");
    });

    it("marks the protagonist is_adult (so the sheet mint labels 'an adult', not a child)", () => {
      expect(adaptOrderToPipelineInput({ ...adultOrder, secondaries: [] }).child.is_adult).toBe(true);
    });

    it("carries the EXPLICIT age (narrated age + milestone number), not a default", () => {
      expect(adaptOrderToPipelineInput({ ...adultOrder, secondaries: [] }).child.age).toBe(38);
    });

    it("threads the adult vibe for story register + the dedication default", () => {
      expect(adaptOrderToPipelineInput({ ...adultOrder, secondaries: [] }).vibe).toBe("roast");
    });

    it("does NOT run structured child features on an adult (free-text appearance)", () => {
      const input = adaptOrderToPipelineInput({ ...adultOrder, child_features: { hair_colour: "brown" }, secondaries: [] });
      expect(input.child.features).toBeUndefined();
    });
  });

  // ---- BYTE-IDENTICAL: child + pet never get the adult signal ----------------
  // The whole slice hinges on audience staying undefined for non-adult books — that
  // is what keeps isAdultAudience(input) false and every adult branch collapsed.
  describe("child/pet never receive audience='adult'", () => {
    it("a child order has audience undefined and no is_adult", () => {
      const input = adaptOrderToPipelineInput({ ...baseOrder, secondaries: [] });
      expect(input.audience).toBeUndefined();
      expect(input.child.is_adult).toBeUndefined();
    });

    // A PET book can carry vibe='adventure' (its own enum). audience MUST stay
    // undefined so the shared-'adventure' value can never reach the adult path —
    // the same collision the front-matter gate guards, checked here at the source.
    it("a pet order with vibe='adventure' still has audience undefined", () => {
      const input = adaptOrderToPipelineInput({
        ...baseOrder, book_type: "pet", child_gender: undefined,
        animal_kind: "dog", vibe: "adventure",
        photo_urls: { pet: ["uploads/x.png"] }, secondaries: [],
      });
      expect(input.audience).toBeUndefined();
      expect(input.child.is_adult).toBeUndefined();
      expect(input.vibe).toBe("adventure"); // vibe flows for the pet story, audience does not
    });
  });
});
