// worker/tests/compose-appearance.test.js — Spec structured-inputs (2026-06-11).
// composeAppearance merges structured descriptive axes with optional free text into
// the identity-marker spine. composeMarkClause builds the bare mark clause for the
// Sonnet seed (de-emphasis renders it subtle; scars carried, never stamped). Pure.
import { describe, it, expect } from "vitest";
import { composeAppearance, composeMarkClause } from "../../src/book-pipeline.js";

describe("composeAppearance — four cases", () => {
  it("free-text-only: returns the text verbatim", () => {
    expect(composeAppearance({}, "Brown wavy hair, thick eyebrows")).toBe("Brown wavy hair, thick eyebrows");
    expect(composeAppearance(null, "X")).toBe("X");
  });
  it("structured-only: ;-joined spine", () => {
    expect(composeAppearance(
      { hair_colour: "brown", hair_style: "tousled", skin_tone: "tan", build: "sturdy" }, "",
    )).toBe("tousled brown hair; tan skin; sturdy build");
  });
  it("both: structured spine + 'also:' free text", () => {
    expect(composeAppearance({ skin_tone: "tan" }, "freckly")).toBe("tan skin; also: freckly");
  });
  it("neither: empty string", () => {
    expect(composeAppearance({}, "")).toBe("");
    expect(composeAppearance(undefined, undefined)).toBe("");
  });
});

describe("composeAppearance — per-axis prose", () => {
  it("hair colour + adjective style", () => {
    expect(composeAppearance({ hair_colour: "light-brown", hair_style: "short" }, "")).toBe("short light brown hair");
  });
  it("hair arrangement style reads naturally", () => {
    expect(composeAppearance({ hair_colour: "black", hair_style: "pigtails" }, "")).toBe("black hair in pigtails");
  });
  it("bald ignores colour", () => {
    expect(composeAppearance({ hair_colour: "brown", hair_style: "bald" }, "")).toBe("bald");
  });
  it("hair colour without style", () => {
    expect(composeAppearance({ hair_colour: "auburn" }, "")).toBe("auburn hair");
  });
  it("eye colour (kebab → words)", () => {
    expect(composeAppearance({ eye_colour: "dark-brown" }, "")).toBe("dark brown eyes");
  });
  it("glasses: yes emits, no/absent omits", () => {
    expect(composeAppearance({ glasses: "yes" }, "")).toBe("glasses");
    expect(composeAppearance({ glasses: "no" }, "")).toBe("");
    expect(composeAppearance({ glasses: true }, "")).toBe("glasses");
  });
  it("skin tone + build kebab labels", () => {
    expect(composeAppearance({ skin_tone: "deep-brown", build: "slight" }, "")).toBe("deep brown skin; slight build");
  });
  it("full descriptive set joins in axis order", () => {
    expect(composeAppearance(
      { hair_colour: "blonde", hair_style: "shoulder-length", skin_tone: "fair", eye_colour: "blue", glasses: "yes", build: "average" }, "",
    )).toBe("shoulder-length blonde hair; fair skin; blue eyes; glasses; average build");
  });
});

describe("composeMarkClause — bare clause, type guard", () => {
  it("mole → bare left-cheek clause", () => {
    expect(composeMarkClause([{ type: "mole", side: "left", region: "cheek" }])).toBe("a mole on the left cheek");
  });
  it("defaults region to cheek", () => {
    expect(composeMarkClause([{ type: "birthmark", side: "right" }])).toBe("a birthmark on the right cheek");
  });
  it("scar is carried (clause built) — stamping is shelved elsewhere", () => {
    expect(composeMarkClause([{ type: "scar", side: "left", region: "cheek" }])).toBe("a scar on the left cheek");
  });
  it("empty / missing side / unknown type → empty", () => {
    expect(composeMarkClause([])).toBe("");
    expect(composeMarkClause(null)).toBe("");
    expect(composeMarkClause([{ type: "mole" }])).toBe("");
    expect(composeMarkClause([{ type: "freckles", side: "left" }])).toBe("");
  });
});
