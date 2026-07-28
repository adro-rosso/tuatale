// worker/tests/locked-sheet.test.js — character-picker Slice 1 (THE LOCK), 2026-07-28.
// A LOCKED sheet-reuse state reuses an injected customer-chosen view-0 UNCONDITIONALLY
// (marker-fingerprint EXEMPT), so no drift can discard the pick. Pure logic — $0, no Gemini.
// (The chained views 2-3 are the only Gemini cost; validated separately, not needed here.)
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  resolveSheetState,
  SheetState,
  LockedSheetMissingError,
  buildSheetMeta,
} from "../../src/sheet-meta.js";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "locked-sheet-"));
const writeView = (dir, prefix, n) =>
  fs.writeFileSync(path.join(dir, `${prefix}-${String(n).padStart(2, "0")}.png`), Buffer.from("PNGDATA"));
const writeMeta = (dir, subjectId, obj) =>
  fs.writeFileSync(path.join(dir, `${subjectId}-meta.json`), JSON.stringify(obj));
const resolve = (dir, over = {}) =>
  resolveSheetState({ subjectId: "protagonist", sheetPathPrefix: "sheet", expectedViewCount: 3, currentFingerprint: "NEW", sheetsDir: dir, ...over });

describe("LOCKED sheet-reuse state", () => {
  // THE DECISIVE TEST — paired with its control on the SAME fingerprint mismatch. Only
  // the `locked` flag differs, so the divergent outcome proves the lock is the CAUSAL
  // difference (not merely "locked → LOCKED"): it defeats the exact drift it exists for.
  it("DECISIVE + CONTROL: identical fingerprint mismatch — locked→LOCKED, no-lock→MISMATCH_REMINT", () => {
    const build = (locked) => {
      const dir = tmp();
      writeView(dir, "sheet", 1); // the chosen view-0 is on disk; views 2-3 absent
      writeMeta(dir, "protagonist", { marker_fingerprint: "OLD", ...(locked ? { locked: true } : {}) });
      return resolve(dir, { currentFingerprint: "NEW" }); // deliberate mismatch vs "OLD"
    };
    const locked = build(true);
    const control = build(false);

    expect(locked.state).toBe(SheetState.LOCKED);            // the fix: fingerprint EXEMPT
    expect(control.state).toBe(SheetState.MISMATCH_REMINT);  // the control: same mismatch discards
    // Same inputs, same mismatch — the lock flag is the only variable that changed the outcome.
    expect(locked.missingViewIndices).toEqual([2, 3]);       // chain plan: mint views 2-3
    expect(locked.presentFiles).toEqual(["sheet-01.png"]);   // reuse the chosen view-0
  });

  // FAIL LOUD — a locked subject whose chosen view-0 is gone must NEVER resolve to a
  // mintable state (that would silently paint a different face). It throws, distinctly.
  it("FAIL-LOUD: locked meta but view-0 missing → throws LockedSheetMissingError", () => {
    const dir = tmp(); // NO view-0 png on disk
    writeMeta(dir, "companion-1", { marker_fingerprint: "X", locked: true });
    let err;
    try {
      resolveSheetState({ subjectId: "companion-1", sheetPathPrefix: "companion-1", expectedViewCount: 2, currentFingerprint: "Y", sheetsDir: dir });
    } catch (e) { err = e; }
    expect(err).toBeInstanceOf(LockedSheetMissingError);
    expect(err.code).toBe("LOCKED_SHEET_MISSING");
    expect(err.subjectId).toBe("companion-1");
  });

  // BYTE-IDENTICAL (resolution) — with no `locked` field the LOCKED branch never fires;
  // every existing book resolves exactly as before.
  it("BYTE-IDENTICAL: no locked field — match→FULL_SKIP, mismatch→MISMATCH_REMINT (today's behaviour)", () => {
    const dir = tmp();
    [1, 2, 3].forEach((n) => writeView(dir, "sheet", n)); // all views present
    writeMeta(dir, "protagonist", { marker_fingerprint: "FP" });
    expect(resolve(dir, { currentFingerprint: "FP" }).state).toBe(SheetState.FULL_SKIP);
    expect(resolve(dir, { currentFingerprint: "OTHER" }).state).toBe(SheetState.MISMATCH_REMINT);
  });

  // BYTE-IDENTICAL (meta) — the key is ABSENT unless locked===true; locked:false ≡ absent.
  it("BYTE-IDENTICAL: buildSheetMeta omits `locked` unless true", () => {
    const base = {
      subjectName: "N", subjectType: "human", gender: "girl", appearanceDescription: "a",
      markers: "m", fingerprint: "fp", sheetPathPrefix: "companion-1", presentViews: [],
      mintedAt: "2026-01-01T00:00:00.000Z", mintedForBook: "b",
    };
    const plain = buildSheetMeta(base);
    expect("locked" in plain).toBe(false);
    expect(JSON.stringify(plain)).not.toContain('"locked"');

    expect(buildSheetMeta({ ...base, locked: true }).locked).toBe(true);
    // locked:false must serialise byte-identically to no locked field at all.
    expect(JSON.stringify(buildSheetMeta({ ...base, locked: false }))).toBe(JSON.stringify(plain));
  });
});
