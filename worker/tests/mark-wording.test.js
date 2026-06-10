// worker/tests/mark-wording.test.js — Spec D-M Stage-3 lever 2 (amended).
// deemphasiseMarkWording rewrites a mole/birthmark/scar clause to a BARE form
// ("a small faint <mark> on <pronoun> <side> cheek") — pure subtraction: no "low",
// no "just beneath the eye", no anatomical/camera gloss (placement language
// backfired twice). Gated: only active under MOLE_WORDING_FIX=on.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { deemphasiseMarkWording } from "../../src/book-pipeline.js";

describe("deemphasiseMarkWording — gated off (production default)", () => {
  beforeEach(() => { delete process.env.MOLE_WORDING_FIX; });
  it("returns the text unchanged when the flag is unset", () => {
    const t = "He has a faint small mole low on his left cheek.";
    expect(deemphasiseMarkWording(t)).toBe(t);
  });
});

describe("deemphasiseMarkWording — MOLE_WORDING_FIX=on (bare, subtraction only)", () => {
  beforeEach(() => { process.env.MOLE_WORDING_FIX = "on"; });
  afterEach(() => { delete process.env.MOLE_WORDING_FIX; });

  it("drops 'low' and adds NO gloss — bare left-cheek clause", () => {
    const out = deemphasiseMarkWording("expressions vivid, with a faint small mole low on his left cheek.");
    expect(out).toContain("a small faint mole on his left cheek");
    expect(out).not.toMatch(/\blow\b/);
    expect(out).not.toContain("("); // no parenthetical / anatomical gloss
    expect(out).not.toMatch(/camera|child's own/i);
  });
  it("preserves the stated side (right) without any gloss", () => {
    const out = deemphasiseMarkWording("She has a small mole on her right cheek.");
    expect(out).toContain("a small faint mole on her right cheek");
    expect(out).not.toContain("(");
  });
  it("strips a trailing 'just beneath the eye' placement phrase", () => {
    const out = deemphasiseMarkWording("A small mole on his left cheek, just beneath the eye.");
    expect(out).toContain("a small faint mole on his left cheek");
    expect(out).not.toMatch(/beneath the eye/);
  });
  it("leaves text without a mark clause untouched", () => {
    const t = "Brown wavy hair, olive skin, sturdy build.";
    expect(deemphasiseMarkWording(t)).toBe(t);
  });
});
