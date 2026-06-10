// worker/tests/chained-sheet-mint.test.js — Spec D-M Stage-3 lever 1.
// chainedSheetRefs decides the reference array each sheet-view mint receives.
// view-1 (index 0) is the anchor (no refs); views 2-3 chain to view-1's buffer.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { chainedSheetRefs } from "../../src/book-pipeline.js";

const VIEW1 = Buffer.from("view-1-front-bytes");

describe("chainedSheetRefs — chaining call shape (default ON)", () => {
  beforeEach(() => { delete process.env.CHAINED_SHEET_MINT; });
  afterEach(() => { delete process.env.CHAINED_SHEET_MINT; });

  it("view-1 (anchor) mints reference-less", () => {
    expect(chainedSheetRefs(0, VIEW1)).toEqual([]);
  });
  it("view-2 mints WITH view-1 as the reference", () => {
    expect(chainedSheetRefs(1, VIEW1)).toEqual([VIEW1]);
  });
  it("view-3 mints WITH view-1 as the reference", () => {
    expect(chainedSheetRefs(2, VIEW1)).toEqual([VIEW1]);
  });
  it("no anchor (e.g. view-1 mint failed) → reference-less, never throws", () => {
    expect(chainedSheetRefs(1, null)).toEqual([]);
  });
  it("PARTIAL_RESUME: a REUSED view-1 buffer is accepted as the chain reference", () => {
    const reusedView1 = Buffer.from("view-1-read-from-disk");
    expect(chainedSheetRefs(2, reusedView1)).toEqual([reusedView1]);
  });
});

describe("chainedSheetRefs — CHAINED_SHEET_MINT=off restores independent mints", () => {
  beforeEach(() => { process.env.CHAINED_SHEET_MINT = "off"; });
  afterEach(() => { delete process.env.CHAINED_SHEET_MINT; });

  it("view-2/3 mint reference-less when gated off", () => {
    expect(chainedSheetRefs(1, VIEW1)).toEqual([]);
    expect(chainedSheetRefs(2, VIEW1)).toEqual([]);
  });
});
