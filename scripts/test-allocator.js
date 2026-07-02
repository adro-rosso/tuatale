// scripts/test-allocator.js
// No-API-cost unit test for the 4-reference-image allocator (src/allocator.js).
// Covers every N case, the human/non-human split, the protagonist-required
// invariant, the degraded-fewer fallback, and the 0-sheets throw path.
// Run before any Step-3 paid render to catch plumbing bugs cheap.

import { allocate } from "../src/allocator.js";

function assert(condition, message) {
  if (!condition) {
    console.error(`FAIL: ${message}`);
    process.exit(1);
  }
}

function assertThrows(fn, partialMessage, testName) {
  let caught = null;
  try { fn(); } catch (err) { caught = err; }
  assert(caught !== null, `${testName}: expected to throw, did not`);
  assert(
    caught.message.includes(partialMessage),
    `${testName}: expected error to include "${partialMessage}", got "${caught.message}"`,
  );
}

console.log();
console.log("=".repeat(72));
console.log("Allocator unit test (no API cost)");
console.log("=".repeat(72));

// Shared fixtures.
const PROTAG = { id: "protagonist", isProtagonist: true, subjectType: "human", mintedSheetCount: 3 };
const HUMAN_SEC_2 = { id: "companion-1", isProtagonist: false, subjectType: "human", mintedSheetCount: 2 };
const HUMAN_SEC_3 = { id: "companion-2", isProtagonist: false, subjectType: "human", mintedSheetCount: 2 };
const NONHUMAN_SEC = { id: "companion-1", isProtagonist: false, subjectType: "non_human", mintedSheetCount: 1 };

// ---- Test 1: N=1 solo protagonist → 3 ----
console.log();
console.log("Test 1 — N=1: solo protagonist gets 3 views");
{
  const result = allocate(["Søren"], { "Søren": PROTAG });
  assert(Object.keys(result).length === 1, `expected 1 entry, got ${Object.keys(result).length}`);
  assert(result["protagonist"] === 3, `expected 3 views for protagonist, got ${result["protagonist"]}`);
  console.log("  PASS (solo protagonist: 3 views)");
}

// ---- Test 2: N=2 two humans → 2 + 2 ----
console.log();
console.log("Test 2 — N=2 humans: 2 + 2");
{
  const result = allocate(["Søren", "Theo"], { "Søren": PROTAG, "Theo": HUMAN_SEC_2 });
  assert(result["protagonist"] === 2, `expected 2 views for protagonist, got ${result["protagonist"]}`);
  assert(result["companion-1"] === 2, `expected 2 views for companion-1, got ${result["companion-1"]}`);
  const total = Object.values(result).reduce((s, v) => s + v, 0);
  assert(total === 4, `expected total=4 references, got ${total}`);
  console.log("  PASS (two humans: 2 + 2 = 4)");
}

// ---- Test 3: N=2 human + non_human → 3 + 1 ----
console.log();
console.log("Test 3 — N=2 human + non_human: 3 + 1");
{
  const result = allocate(["Søren", "TeddyBear"], { "Søren": PROTAG, "TeddyBear": NONHUMAN_SEC });
  assert(result["protagonist"] === 3, `expected 3 views for protagonist, got ${result["protagonist"]}`);
  assert(result["companion-1"] === 1, `expected 1 view for non-human, got ${result["companion-1"]}`);
  const total = Object.values(result).reduce((s, v) => s + v, 0);
  assert(total === 4, `expected total=4 references, got ${total}`);
  console.log("  PASS (human + non_human: 3 + 1 = 4)");
}

// ---- Test 4: N=3 → 2 + 2 + 2 (raised from 2+1+1, 2026-07-01) ----
console.log();
console.log("Test 4 — N=3: 2 + 2 + 2");
{
  const result = allocate(["Søren", "Theo", "Mia"], {
    "Søren": PROTAG,
    "Theo": HUMAN_SEC_2,
    "Mia": HUMAN_SEC_3,
  });
  assert(result["protagonist"] === 2, `expected 2 for protagonist, got ${result["protagonist"]}`);
  assert(result["companion-1"] === 2, `expected 2 for companion-1, got ${result["companion-1"]}`);
  assert(result["companion-2"] === 2, `expected 2 for companion-2, got ${result["companion-2"]}`);
  const total = Object.values(result).reduce((s, v) => s + v, 0);
  assert(total === 6, `expected total=6 references, got ${total}`);
  console.log("  PASS (N=3: 2 + 2 + 2 = 6)");
}

// ---- Test 5: N=4 → 2 + 2 + 2 + 2 (raised from 1+1+1+1, 2026-07-01) ----
console.log();
console.log("Test 5 — N=4: 2 + 2 + 2 + 2");
{
  const protag4 = { ...PROTAG };
  const a = { id: "a", isProtagonist: false, subjectType: "human", mintedSheetCount: 2 };
  const b = { id: "b", isProtagonist: false, subjectType: "human", mintedSheetCount: 2 };
  const c = { id: "c", isProtagonist: false, subjectType: "human", mintedSheetCount: 2 };
  const result = allocate(["P", "A", "B", "C"], { "P": protag4, "A": a, "B": b, "C": c });
  assert(result["protagonist"] === 2, `protagonist should be 2, got ${result["protagonist"]}`);
  assert(result["a"] === 2 && result["b"] === 2 && result["c"] === 2, `each secondary should be 2`);
  const total = Object.values(result).reduce((s, v) => s + v, 0);
  assert(total === 8, `expected total=8, got ${total}`);
  console.log("  PASS (N=4: 2 + 2 + 2 + 2 = 8)");
}

// ---- Test 6: fewer minted than allocated (degraded-fewer fallback) ----
console.log();
console.log("Test 6 — fewer minted sheets than allocated: use what's available");
{
  const partialProtag = { ...PROTAG, mintedSheetCount: 2 }; // only 2 of 3 minted
  const result = allocate(["Søren"], { "Søren": partialProtag });
  assert(result["protagonist"] === 2, `expected min(3, 2)=2 for partial protagonist, got ${result["protagonist"]}`);
  console.log("  PASS (partial sheets: allocator caps at mintedSheetCount)");
}

// ---- Test 7: 0 minted sheets → throws (degraded-skipped fallback) ----
console.log();
console.log("Test 7 — 0 minted sheets: throws so caller can drop the subject");
{
  const brokenSec = { ...HUMAN_SEC_2, mintedSheetCount: 0 };
  assertThrows(
    () => allocate(["Søren", "Theo"], { "Søren": PROTAG, "Theo": brokenSec }),
    "no minted sheets",
    "0-sheet subject",
  );
  console.log("  PASS (subject with 0 sheets throws — caller catches + drops)");
}

// ---- Test 8: missing protagonist throws (story-gen invariant) ----
console.log();
console.log("Test 8 — no protagonist in subjects_present: throws");
{
  assertThrows(
    () => allocate(["Theo"], { "Theo": HUMAN_SEC_2 }),
    "no protagonist",
    "missing protagonist",
  );
  console.log("  PASS (missing protagonist throws)");
}

// ---- Test 9: subjectsPresent empty → throws ----
console.log();
console.log("Test 9 — empty subjects_present: throws");
{
  assertThrows(() => allocate([], {}), "is empty", "empty subjects_present");
  console.log("  PASS (empty list throws)");
}

// ---- Test 10: N>4 throws ----
console.log();
console.log("Test 10 — subjects_present > 4: throws");
{
  const meta = {
    "P": PROTAG,
    "A": HUMAN_SEC_2,
    "B": HUMAN_SEC_2,
    "C": HUMAN_SEC_2,
    "D": HUMAN_SEC_2,
  };
  assertThrows(() => allocate(["P", "A", "B", "C", "D"], meta), "max 4", "N=5");
  console.log("  PASS (N>4 throws)");
}

// ---- Test 11: missing metadata for a name → throws ----
console.log();
console.log("Test 11 — missing metadata for a name: throws");
{
  assertThrows(
    () => allocate(["Søren", "Ghost"], { "Søren": PROTAG }),
    `no metadata for subject "Ghost"`,
    "missing metadata",
  );
  console.log("  PASS (missing metadata throws)");
}

// ---- Test 12: invalid subjectType → throws ----
console.log();
console.log("Test 12 — invalid subjectType: throws");
{
  const bad = { id: "bad", isProtagonist: false, subjectType: "alien", mintedSheetCount: 1 };
  assertThrows(
    () => allocate(["Søren", "Bad"], { "Søren": PROTAG, "Bad": bad }),
    "invalid 'subjectType'",
    "bad subjectType",
  );
  console.log("  PASS (bad subjectType throws)");
}

console.log();
console.log("=".repeat(72));
console.log("All allocator tests passed.");
console.log("=".repeat(72));
console.log();
