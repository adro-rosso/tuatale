// worker/tests/chosen-sheet-inject.test.js — character-picker Slice 4 injection ($0).
// Proves: DECISIVE (a pick → LOCKED sheet the book reuses), DEGRADE C (durable PNG gone →
// skip + flag, NO locked meta → the Slice-1 throw stays a corruption guard), BYTE-IDENTICAL
// (no pick → no-op → COLD_START unchanged).
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { injectChosenSheets, collectPicks } from "../src/chosen-sheet-inject.js";
import { resolveSheetState, SheetState } from "../../src/sheet-meta.js";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "chosen-inject-"));
const okDownload = async () => Buffer.from("PNGDATA");
const goneDownload = async (p) => { throw new Error(`404 ${p}`); };
const silent = { log: () => {}, warn: () => {} };

describe("injectChosenSheets", () => {
  it("BYTE-IDENTICAL: no chosen_sheet → NO-OP (no files) → subject resolves COLD_START", async () => {
    const dir = tmp();
    const r = await injectChosenSheets({ id: "o1", chosen_sheet: null, secondaries: [] }, dir, { download: okDownload, log: silent });
    expect(r).toEqual({ injected: [], degraded: [] });
    expect(fs.existsSync(path.join(dir, "character-sheets"))).toBe(false);
    const st = resolveSheetState({ subjectId: "protagonist", sheetPathPrefix: "sheet", expectedViewCount: 3, currentFingerprint: "X", sheetsDir: path.join(dir, "character-sheets") });
    expect(st.state).toBe(SheetState.COLD_START);
  });

  it("DECISIVE: a protagonist pick → LOCKED sheet the book reuses (fingerprint EXEMPT)", async () => {
    const dir = tmp();
    const order = { id: "o1", chosen_sheet: { subjectId: "protagonist", previewId: "p", imagePath: "orders/o1/chosen/protagonist.png" }, secondaries: [] };
    const r = await injectChosenSheets(order, dir, { download: okDownload, log: silent });
    expect(r.injected).toEqual(["protagonist"]);
    const sheetsDir = path.join(dir, "character-sheets");
    expect(fs.existsSync(path.join(sheetsDir, "sheet-01.png"))).toBe(true);      // prefix "sheet"
    expect(fs.existsSync(path.join(sheetsDir, "protagonist-meta.json"))).toBe(true);
    // resolveSheetState with a MISMATCHING fingerprint → still LOCKED (the pick is authoritative).
    const st = resolveSheetState({ subjectId: "protagonist", sheetPathPrefix: "sheet", expectedViewCount: 3, currentFingerprint: "DIFFERENT", sheetsDir });
    expect(st.state).toBe(SheetState.LOCKED);
    expect(st.missingViewIndices).toEqual([2, 3]); // book chains views 2-3 off the locked view-0
  });

  it("secondary pick → companion-N locked sheet", async () => {
    const dir = tmp();
    const order = { id: "o1", chosen_sheet: null, secondaries: [{ id: "companion-1", chosen_sheet: { imagePath: "orders/o1/chosen/companion-1.png" } }] };
    const r = await injectChosenSheets(order, dir, { download: okDownload, log: silent });
    expect(r.injected).toEqual(["companion-1"]);
    const sheetsDir = path.join(dir, "character-sheets");
    expect(fs.existsSync(path.join(sheetsDir, "companion-1-01.png"))).toBe(true);
    const st = resolveSheetState({ subjectId: "companion-1", sheetPathPrefix: "companion-1", expectedViewCount: 2, currentFingerprint: "X", sheetsDir });
    expect(st.state).toBe(SheetState.LOCKED);
  });

  it("DEGRADE C: durable PNG gone → skip (no locked meta written) + reported degraded", async () => {
    const dir = tmp();
    const order = { id: "o1", chosen_sheet: { subjectId: "protagonist", imagePath: "orders/o1/chosen/protagonist.png" }, secondaries: [] };
    const r = await injectChosenSheets(order, dir, { download: goneDownload, log: silent });
    expect(r).toEqual({ injected: [], degraded: ["protagonist"] });
    const sheetsDir = path.join(dir, "character-sheets");
    // No locked meta + no view-0 → the Slice-1 LockedSheetMissingError can NEVER fire here.
    expect(fs.existsSync(path.join(sheetsDir, "protagonist-meta.json"))).toBe(false);
    expect(fs.existsSync(path.join(sheetsDir, "sheet-01.png"))).toBe(false);
  });

  it("collectPicks ignores already-degraded picks and picks with no imagePath", () => {
    const order = {
      chosen_sheet: { subjectId: "protagonist", imagePath: "", degraded: true },
      secondaries: [
        { id: "companion-1", chosen_sheet: { imagePath: "orders/o/chosen/companion-1.png" } },
        { id: "companion-2", chosen_sheet: { previewId: "x" } }, // no imagePath → skipped
      ],
    };
    expect(collectPicks(order).map((p) => p.subjectId)).toEqual(["companion-1"]);
  });
});
