// scripts/test-sheet-reuse.js
// No-API-cost unit tests for the Item 3 sheet-reuse state machine in
// src/sheet-meta.js. Exercises resolveSheetState() against synthetic tmp
// directories populated with various combinations of sheet PNGs +
// metadata files.

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  computeMarkerFingerprint,
  resolveSheetState,
  writeSheetMeta,
  readSheetMeta,
  buildSheetMeta,
  snapshotPreviousMeta,
  SheetState,
} from "../src/sheet-meta.js";

function assert(condition, message) {
  if (!condition) {
    console.error(`FAIL: ${message}`);
    process.exit(1);
  }
}
function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "daboo-sheet-reuse-test-"));
}
function fakeSheet(sheetsDir, filename, sizeBytes = 1024) {
  // Drop a non-zero-size placeholder PNG. resolveSheetState only checks
  // existence + non-zero size, not actual PNG validity.
  fs.writeFileSync(path.join(sheetsDir, filename), Buffer.alloc(sizeBytes, 0xff));
}

const PROTAG_FP_INPUTS = {
  subjectName: "Iris",
  subjectType: "human",
  gender: "girl",
  appearanceDescription: "Iris is a five-year-old girl with dark brown hair and pajamas with stars on them",
  markers: "dark brown bob; pajamas with stars",
};
const PROTAG_FP = computeMarkerFingerprint(PROTAG_FP_INPUTS);

console.log();
console.log("=".repeat(72));
console.log("sheet-reuse state-machine unit test (no API cost)");
console.log("=".repeat(72));

// ---- Test 1 — State A (FULL_SKIP): all expected sheets + matching meta ----
console.log();
console.log("Test 1 — State A: 3 sheets + matching meta → FULL_SKIP");
{
  const dir = tempDir();
  fakeSheet(dir, "sheet-01.png");
  fakeSheet(dir, "sheet-02.png");
  fakeSheet(dir, "sheet-03.png");
  writeSheetMeta(dir, "protagonist", buildSheetMeta({
    ...PROTAG_FP_INPUTS,
    fingerprint: PROTAG_FP,
    sheetPathPrefix: "sheet",
    presentViews: [
      { view_index: 1, filename: "sheet-01.png" },
      { view_index: 2, filename: "sheet-02.png" },
      { view_index: 3, filename: "sheet-03.png" },
    ],
    mintedForBook: "test-book",
  }));
  const r = resolveSheetState({
    subjectId: "protagonist",
    sheetPathPrefix: "sheet",
    expectedViewCount: 3,
    currentFingerprint: PROTAG_FP,
    sheetsDir: dir,
  });
  assert(r.state === SheetState.FULL_SKIP, `state: ${r.state}`);
  assert(r.presentFiles.length === 3, `presentFiles count: ${r.presentFiles.length}`);
  assert(r.missingViewIndices.length === 0, `missingViewIndices: ${r.missingViewIndices}`);
  assert(r.excessFiles.length === 0, `excessFiles: ${r.excessFiles}`);
  assert(r.fingerprintMatch === true, `fingerprintMatch: ${r.fingerprintMatch}`);
  console.log(`  PASS`);
}

// ---- Test 2 — State B (COLD_START): empty dir ----
console.log();
console.log("Test 2 — State B: empty dir → COLD_START");
{
  const dir = tempDir();
  const r = resolveSheetState({
    subjectId: "protagonist",
    sheetPathPrefix: "sheet",
    expectedViewCount: 3,
    currentFingerprint: PROTAG_FP,
    sheetsDir: dir,
  });
  assert(r.state === SheetState.COLD_START, `state: ${r.state}`);
  assert(r.presentFiles.length === 0, `presentFiles: ${r.presentFiles.length}`);
  assert(r.missingViewIndices.length === 3, `missingViewIndices: ${r.missingViewIndices}`);
  assert(r.excessFiles.length === 0, `excessFiles: ${r.excessFiles}`);
  assert(r.existingMeta === null, `existingMeta should be null`);
  assert(r.fingerprintMatch === null, `fingerprintMatch should be null (no meta to compare)`);
  console.log(`  PASS`);
}

// ---- Test 3 — State C (PARTIAL_RESUME): 1 of 3 sheets + matching meta ----
console.log();
console.log("Test 3 — State C: only sheet-01 + matching meta → PARTIAL_RESUME, missing [2, 3]");
{
  const dir = tempDir();
  fakeSheet(dir, "sheet-01.png");
  writeSheetMeta(dir, "protagonist", buildSheetMeta({
    ...PROTAG_FP_INPUTS,
    fingerprint: PROTAG_FP,
    sheetPathPrefix: "sheet",
    presentViews: [{ view_index: 1, filename: "sheet-01.png" }],
    mintedForBook: "test-book-partial",
  }));
  const r = resolveSheetState({
    subjectId: "protagonist",
    sheetPathPrefix: "sheet",
    expectedViewCount: 3,
    currentFingerprint: PROTAG_FP,
    sheetsDir: dir,
  });
  assert(r.state === SheetState.PARTIAL_RESUME, `state: ${r.state}`);
  assert(r.presentFiles.length === 1, `presentFiles: ${r.presentFiles.length}`);
  assert(r.presentFiles[0] === "sheet-01.png", `presentFiles[0]: ${r.presentFiles[0]}`);
  assert(r.missingViewIndices.length === 2, `missingViewIndices count: ${r.missingViewIndices.length}`);
  assert(r.missingViewIndices[0] === 2 && r.missingViewIndices[1] === 3, `missingViewIndices: [${r.missingViewIndices}]`);
  assert(r.fingerprintMatch === true, `fingerprintMatch: ${r.fingerprintMatch}`);
  console.log(`  PASS (will mint views ${r.missingViewIndices.join(", ")}, reuse view 1)`);
}

// ---- Test 4 — State D (VIEW_EXCESS): 3 sheets present but allocator wants 2 ----
console.log();
console.log("Test 4 — State D: 3 sheets + matching meta but expectedViewCount=2 → VIEW_EXCESS");
{
  const dir = tempDir();
  fakeSheet(dir, "sheet-01.png");
  fakeSheet(dir, "sheet-02.png");
  fakeSheet(dir, "sheet-03.png");
  writeSheetMeta(dir, "protagonist", buildSheetMeta({
    ...PROTAG_FP_INPUTS,
    fingerprint: PROTAG_FP,
    sheetPathPrefix: "sheet",
    presentViews: [
      { view_index: 1, filename: "sheet-01.png" },
      { view_index: 2, filename: "sheet-02.png" },
      { view_index: 3, filename: "sheet-03.png" },
    ],
    mintedForBook: "test-book-original",
  }));
  const r = resolveSheetState({
    subjectId: "protagonist",
    sheetPathPrefix: "sheet",
    expectedViewCount: 2,    // current design wants only 2
    currentFingerprint: PROTAG_FP,
    sheetsDir: dir,
  });
  assert(r.state === SheetState.VIEW_EXCESS, `state: ${r.state}`);
  assert(r.presentFiles.length === 2, `presentFiles count: ${r.presentFiles.length}`);
  assert(r.excessFiles.length === 1, `excessFiles count: ${r.excessFiles.length}`);
  assert(r.excessFiles[0] === "sheet-03.png", `excessFiles[0]: ${r.excessFiles[0]}`);
  console.log(`  PASS (use sheet-01 + sheet-02, ignore sheet-03)`);
}

// ---- Test 5 — State E (MISMATCH_REMINT): sheets + meta with stale fingerprint ----
console.log();
console.log("Test 5 — State E: sheets + meta with stale fingerprint → MISMATCH_REMINT");
{
  const dir = tempDir();
  fakeSheet(dir, "sheet-01.png");
  fakeSheet(dir, "sheet-02.png");
  fakeSheet(dir, "sheet-03.png");
  writeSheetMeta(dir, "protagonist", buildSheetMeta({
    ...PROTAG_FP_INPUTS,
    fingerprint: "deadbeefcafebabe",  // intentionally different from PROTAG_FP
    sheetPathPrefix: "sheet",
    presentViews: [
      { view_index: 1, filename: "sheet-01.png" },
      { view_index: 2, filename: "sheet-02.png" },
      { view_index: 3, filename: "sheet-03.png" },
    ],
    mintedForBook: "test-book-old",
  }));
  const r = resolveSheetState({
    subjectId: "protagonist",
    sheetPathPrefix: "sheet",
    expectedViewCount: 3,
    currentFingerprint: PROTAG_FP,
    sheetsDir: dir,
  });
  assert(r.state === SheetState.MISMATCH_REMINT, `state: ${r.state}`);
  assert(r.fingerprintMatch === false, `fingerprintMatch should be false`);
  assert(r.existingMeta !== null, `existingMeta should be present`);
  assert(r.existingMeta.marker_fingerprint === "deadbeefcafebabe", `stale fingerprint preserved`);
  console.log(`  PASS (full re-mint signaled, stale fingerprint preserved for logging)`);
}

// ---- Test 6 — State A-Legacy (LEGACY_SKIP): sheets but no meta file ----
console.log();
console.log("Test 6 — State A-Legacy: 3 sheets + NO meta (pre-Item-3 book) → LEGACY_SKIP");
{
  const dir = tempDir();
  fakeSheet(dir, "sheet-01.png");
  fakeSheet(dir, "sheet-02.png");
  fakeSheet(dir, "sheet-03.png");
  // Intentionally NO writeSheetMeta call — simulating a pre-Item-3 book
  const r = resolveSheetState({
    subjectId: "protagonist",
    sheetPathPrefix: "sheet",
    expectedViewCount: 3,
    currentFingerprint: PROTAG_FP,
    sheetsDir: dir,
  });
  assert(r.state === SheetState.LEGACY_SKIP, `state: ${r.state} (expected LEGACY_SKIP for backward compat)`);
  assert(r.existingMeta === null, `existingMeta: ${r.existingMeta}`);
  assert(r.fingerprintMatch === null, `fingerprintMatch should be null (no meta to compare)`);
  assert(r.presentFiles.length === 3, `presentFiles count: ${r.presentFiles.length}`);
  console.log(`  PASS (reuse on filename match only — caller emits warning event)`);
}

// ---- Test 7 — Fingerprint stability across trivial whitespace differences ----
console.log();
console.log("Test 7 — Fingerprint stability: trivial whitespace doesn't trigger mismatch");
{
  const baseline = computeMarkerFingerprint({
    subjectName: "Søren",
    subjectType: "human",
    gender: "boy",
    appearanceDescription: "short tousled brown hair, freckles, rocket tee",
    markers: "short tousled brown; rocket tee",
  });
  // Variant 1: extra trailing whitespace
  const withTrailing = computeMarkerFingerprint({
    subjectName: "Søren",
    subjectType: "human",
    gender: "boy",
    appearanceDescription: "short tousled brown hair, freckles, rocket tee   ",
    markers: "short tousled brown; rocket tee   ",
  });
  // Variant 2: double-spaces
  const withDoubleSpaces = computeMarkerFingerprint({
    subjectName: "Søren",
    subjectType: "human",
    gender: "boy",
    appearanceDescription: "short  tousled brown  hair, freckles,  rocket tee",
    markers: "short  tousled brown; rocket tee",
  });
  // Variant 3: tab characters
  const withTabs = computeMarkerFingerprint({
    subjectName: "Søren",
    subjectType: "human",
    gender: "boy",
    appearanceDescription: "short\ttousled brown hair, freckles, rocket tee",
    markers: "short tousled brown; rocket tee",
  });
  // Variant 4: leading whitespace
  const withLeading = computeMarkerFingerprint({
    subjectName: "  Søren",
    subjectType: "human",
    gender: "boy",
    appearanceDescription: " short tousled brown hair, freckles, rocket tee",
    markers: "  short tousled brown; rocket tee",
  });
  assert(baseline === withTrailing, `trailing whitespace changed fingerprint: ${baseline} vs ${withTrailing}`);
  assert(baseline === withDoubleSpaces, `double-spaces changed fingerprint: ${baseline} vs ${withDoubleSpaces}`);
  assert(baseline === withTabs, `tabs changed fingerprint: ${baseline} vs ${withTabs}`);
  assert(baseline === withLeading, `leading whitespace changed fingerprint: ${baseline} vs ${withLeading}`);

  // Sanity: a MATERIAL change DOES produce a different fingerprint
  const materialChange = computeMarkerFingerprint({
    subjectName: "Søren",
    subjectType: "human",
    gender: "girl",  // changed
    appearanceDescription: "short tousled brown hair, freckles, rocket tee",
    markers: "short tousled brown; rocket tee",
  });
  assert(baseline !== materialChange, `material gender change should change fingerprint`);
  console.log(`  PASS (whitespace normalized; material changes still detected)`);
}

// ---- Test 8 — Atomic meta write: no .tmp file lingers ----
console.log();
console.log("Test 8 — Atomic meta write: no .tmp file lingers after writes");
{
  const dir = tempDir();
  for (let i = 0; i < 5; i++) {
    writeSheetMeta(dir, "protagonist", buildSheetMeta({
      ...PROTAG_FP_INPUTS,
      fingerprint: PROTAG_FP,
      sheetPathPrefix: "sheet",
      presentViews: [{ view_index: 1, filename: "sheet-01.png" }],
      mintedForBook: `book-${i}`,
    }));
  }
  const allFiles = fs.readdirSync(dir);
  const tmpFiles = allFiles.filter((f) => f.endsWith(".tmp"));
  assert(tmpFiles.length === 0, `lingering .tmp files: ${tmpFiles.join(", ")}`);
  // Read back: should be valid JSON with the LAST mintedForBook (since each
  // write overwrote the previous via atomic rename).
  const finalMeta = readSheetMeta(dir, "protagonist");
  assert(finalMeta !== null, `meta should be readable`);
  assert(finalMeta.minted_for_book === "book-4", `last write should win: ${finalMeta.minted_for_book}`);
  assert(finalMeta.marker_fingerprint === PROTAG_FP, `fingerprint preserved`);
  console.log(`  PASS (atomic write, last-writer-wins, no tmp leak)`);
}

// ---- Bonus — readSheetMeta returns null for absent file ----
console.log();
console.log("Test 9 (bonus) — readSheetMeta returns null for missing file");
{
  const dir = tempDir();
  const meta = readSheetMeta(dir, "protagonist");
  assert(meta === null, `meta should be null for absent file, got ${meta}`);
  console.log(`  PASS`);
}

// ---- Test 10 (Item 5 F1) — State LEGACY_PARTIAL ----
console.log();
console.log("Test 10 (Item 5 F1) — partial sheets + no meta → LEGACY_PARTIAL");
{
  // Simulates: prior run crashed during view 2 mint. sheet-01 written to disk
  // but no meta (the meta-write only fires after the subject loop completes).
  // Pre-F1 this resolved to LEGACY_SKIP and downstream readFileSync crashed
  // on the missing sheet-02. After F1: explicit LEGACY_PARTIAL state, mint
  // path treats it as full re-mint.
  const dir = tempDir();
  fakeSheet(dir, "sheet-01.png");
  // Intentionally NO sheet-02.png and NO meta — the partial-crash state
  const r = resolveSheetState({
    subjectId: "protagonist",
    sheetPathPrefix: "sheet",
    expectedViewCount: 3,
    currentFingerprint: PROTAG_FP,
    sheetsDir: dir,
  });
  assert(r.state === SheetState.LEGACY_PARTIAL, `state: ${r.state} (expected LEGACY_PARTIAL)`);
  assert(r.existingMeta === null, `existingMeta should be null`);
  assert(r.presentFiles.length === 1, `presentFiles count: ${r.presentFiles.length}`);
  assert(r.presentFiles[0] === "sheet-01.png", `presentFiles[0]: ${r.presentFiles[0]}`);
  assert(r.missingViewIndices.length === 2, `missingViewIndices count: ${r.missingViewIndices.length}`);
  assert(r.missingViewIndices[0] === 2 && r.missingViewIndices[1] === 3, `missingViewIndices: [${r.missingViewIndices}]`);
  console.log(`  PASS (recovery state; will full-remint and overwrite the partial leftover)`);
}

// ---- Test 12 (Item 5 F4) — snapshotPreviousMeta archives the prior meta ----
console.log();
console.log("Test 12 (Item 5 F4) — snapshotPreviousMeta writes <id>-meta.previous.json + rotates older snapshots");
{
  const dir = tempDir();
  const meta1 = buildSheetMeta({
    ...PROTAG_FP_INPUTS,
    fingerprint: "first0000fingerprint",
    sheetPathPrefix: "sheet",
    presentViews: [{ view_index: 1, filename: "sheet-01.png" }],
    mintedForBook: "book-1",
  });
  const meta2 = buildSheetMeta({
    ...PROTAG_FP_INPUTS,
    fingerprint: "second000fingerprint",
    sheetPathPrefix: "sheet",
    presentViews: [{ view_index: 1, filename: "sheet-01.png" }],
    mintedForBook: "book-2",
  });
  // First snapshot — no archive needed
  const p1 = snapshotPreviousMeta(dir, "protagonist", meta1);
  assert(p1.endsWith("protagonist-meta.previous.json"), `first snapshot path: ${p1}`);
  let parsed = JSON.parse(fs.readFileSync(p1, "utf8"));
  assert(parsed.marker_fingerprint === "first0000fingerprint", `first snapshot content`);
  // Second snapshot — should rotate first to .previous.1.json
  const p2 = snapshotPreviousMeta(dir, "protagonist", meta2);
  assert(p2.endsWith("protagonist-meta.previous.json"), `second snapshot path`);
  parsed = JSON.parse(fs.readFileSync(p2, "utf8"));
  assert(parsed.marker_fingerprint === "second000fingerprint", `second snapshot content`);
  // The first should now be at .previous.1.json
  const rotatedPath = path.join(dir, "protagonist-meta.previous.1.json");
  assert(fs.existsSync(rotatedPath), `rotated archive should exist at ${rotatedPath}`);
  const rotated = JSON.parse(fs.readFileSync(rotatedPath, "utf8"));
  assert(rotated.marker_fingerprint === "first0000fingerprint", `rotated archive content`);
  // Third snapshot — should rotate second to .previous.2.json (.previous.1 already exists)
  const meta3 = buildSheetMeta({
    ...PROTAG_FP_INPUTS,
    fingerprint: "third0000fingerprint",
    sheetPathPrefix: "sheet",
    presentViews: [{ view_index: 1, filename: "sheet-01.png" }],
    mintedForBook: "book-3",
  });
  snapshotPreviousMeta(dir, "protagonist", meta3);
  const rotated2Path = path.join(dir, "protagonist-meta.previous.2.json");
  assert(fs.existsSync(rotated2Path), `second rotation archive should exist`);
  const rotated2 = JSON.parse(fs.readFileSync(rotated2Path, "utf8"));
  assert(rotated2.marker_fingerprint === "second000fingerprint", `second rotation content`);
  // No .tmp linger
  const tmpFiles = fs.readdirSync(dir).filter((f) => f.endsWith(".tmp"));
  assert(tmpFiles.length === 0, `lingering tmp: ${tmpFiles.join(", ")}`);
  console.log("  PASS (rotation: 3 snapshots → .previous.json + .previous.1.json + .previous.2.json)");
}

// ---- Test 13 — LEGACY_PARTIAL vs LEGACY_SKIP boundary ----
console.log();
console.log("Test 13 — LEGACY_SKIP still fires for all-present-no-meta (genuine pre-Item-3 books)");
{
  // The complementary case: all expected views present but no meta. This is
  // the pre-Item-3 book case and must still route to LEGACY_SKIP, not
  // LEGACY_PARTIAL.
  const dir = tempDir();
  fakeSheet(dir, "sheet-01.png");
  fakeSheet(dir, "sheet-02.png");
  fakeSheet(dir, "sheet-03.png");
  const r = resolveSheetState({
    subjectId: "protagonist",
    sheetPathPrefix: "sheet",
    expectedViewCount: 3,
    currentFingerprint: PROTAG_FP,
    sheetsDir: dir,
  });
  assert(r.state === SheetState.LEGACY_SKIP, `state: ${r.state} (expected LEGACY_SKIP, not LEGACY_PARTIAL)`);
  assert(r.missingViewIndices.length === 0, `no missing views`);
  console.log(`  PASS (boundary: complete-no-meta routes to LEGACY_SKIP)`);
}

console.log();
console.log("=".repeat(72));
console.log("All sheet-reuse tests passed.");
console.log("=".repeat(72));
console.log();
