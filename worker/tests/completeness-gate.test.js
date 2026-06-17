// worker/tests/completeness-gate.test.js — R1 strict completeness gate.
// Pure unit tests on assertBookComplete (no DB/network/$). Proves a complete
// book passes and every incompleteness mode throws the TYPED IncompletePipelineError
// with the contract R2/R3 consume.
import { describe, it, expect } from "vitest";
import { assertBookComplete } from "../src/run-pipeline.js";
import { IncompletePipelineError } from "../src/incomplete-pipeline-error.js";

const PDF = Buffer.from("%PDF-1.4 ...complete book...");

// A complete 1-protagonist + 1-secondary result.
function completeResult(overrides = {}) {
  return {
    bookPdfBytes: PDF,
    counts: { success: 12, success_after_retry: 0, escalated: 0, failed: 0 },
    subjectList: [
      { id: "protagonist", name: "Leo", viewCount: 3 },
      { id: "companion-1", name: "Dad", viewCount: 2 },
    ],
    subjectSheetStatus: {
      protagonist: { sheetFiles: ["sheet-01.png", "sheet-02.png", "sheet-03.png"], skipped: false },
      "companion-1": { sheetFiles: ["companion-1-01.png", "companion-1-02.png"], skipped: false },
    },
    ...overrides,
  };
}

describe("assertBookComplete — R1 gate", () => {
  it("PASSES a complete book (failed===0, all sheets present)", () => {
    expect(() => assertBookComplete(completeResult())).not.toThrow();
  });

  it("CATCHES a failed page (counts.failed > 0)", () => {
    const r = completeResult({ counts: { success: 11, success_after_retry: 0, escalated: 0, failed: 1 } });
    expect(() => assertBookComplete(r)).toThrow(IncompletePipelineError);
    try {
      assertBookComplete(r);
    } catch (e) {
      expect(e.failedPages).toBe(1);
      expect(e.missingSheets).toEqual([]);
      expect(e.reason).toMatch(/1 page\(s\) failed/);
    }
  });

  it("CATCHES a missing required sheet (protagonist 2 of 3)", () => {
    const r = completeResult();
    r.subjectSheetStatus.protagonist = { sheetFiles: ["sheet-01.png", "sheet-02.png"], skipped: false };
    expect(() => assertBookComplete(r)).toThrow(IncompletePipelineError);
    try {
      assertBookComplete(r);
    } catch (e) {
      expect(e.missingSheets).toContainEqual({ subjectId: "protagonist", name: "Leo", expected: 3, actual: 2, skipped: false });
      expect(e.failedPages).toBe(0);
    }
  });

  it("CATCHES a skipped required secondary", () => {
    const r = completeResult();
    r.subjectSheetStatus["companion-1"] = { sheetFiles: ["companion-1-01.png"], skipped: true };
    expect(() => assertBookComplete(r)).toThrow(IncompletePipelineError);
    try {
      assertBookComplete(r);
    } catch (e) {
      expect(e.missingSheets).toContainEqual({ subjectId: "companion-1", name: "Dad", expected: 2, actual: 1, skipped: true });
    }
  });

  it("CATCHES null PDF bytes", () => {
    const r = completeResult({ bookPdfBytes: null });
    expect(() => assertBookComplete(r)).toThrow(IncompletePipelineError);
    try {
      assertBookComplete(r);
    } catch (e) {
      expect(e.reason).toMatch(/no PDF bytes/);
    }
  });

  it("CATCHES 0-length PDF bytes (empty book)", () => {
    const r = completeResult({ bookPdfBytes: Buffer.alloc(0) });
    expect(() => assertBookComplete(r)).toThrow(IncompletePipelineError);
  });

  it("typed-error shape: instanceof + fields + toJSON kind", () => {
    const r = completeResult({ counts: { success: 0, success_after_retry: 0, escalated: 0, failed: 12 } });
    r.subjectSheetStatus.protagonist = { sheetFiles: ["sheet-01.png"], skipped: false };
    try {
      assertBookComplete(r);
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(IncompletePipelineError);
      expect(e.name).toBe("IncompletePipelineError");
      expect(typeof e.reason).toBe("string");
      expect(e.failedPages).toBe(12);
      expect(Array.isArray(e.missingSheets)).toBe(true);
      expect(e.missingSheets[0]).toMatchObject({ subjectId: "protagonist", expected: 3, actual: 1 });
      const json = e.toJSON();
      expect(json.kind).toBe("incomplete_pipeline");
      expect(json.failed_pages).toBe(12);
      expect(json.missing_sheets).toHaveLength(1);
      expect(json.message).toMatch(/Incomplete book/);
    }
  });
});
