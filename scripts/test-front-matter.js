// scripts/test-front-matter.js
// No-API-cost unit test for the front-matter dedication logic (custom vs
// auto-default). buildDedicationSubs is pure; importing src/front-matter.js
// pulls gemini.js (reads GEMINI_API_KEY at load) so dotenv must load first.

import "dotenv/config";
import { buildDedicationSubs } from "../src/front-matter.js";

function assert(cond, msg) {
  if (!cond) { console.error(`FAIL: ${msg}`); process.exit(1); }
}
function eq(actual, expected, label) {
  assert(actual === expected, `${label}\n    expected: ${JSON.stringify(expected)}\n    actual:   ${JSON.stringify(actual)}`);
  console.log(`  PASS — ${label}`);
}

console.log("\n" + "=".repeat(72));
console.log("front-matter dedication unit test (no API cost)");
console.log("=".repeat(72) + "\n");

// Custom message present → use it verbatim (trimmed).
eq(buildDedicationSubs({ childName: "Maya", message: "For Maya, on your 6th birthday." }).DEDICATION,
   "For Maya, on your 6th birthday.", "custom message → used verbatim");

eq(buildDedicationSubs({ childName: "Maya", message: "  For Maya.  " }).DEDICATION,
   "For Maya.", "custom message → trimmed");

// No / blank message → auto-default.
eq(buildDedicationSubs({ childName: "Maya" }).DEDICATION,
   "For Maya, with love.", "no message → auto-default");
eq(buildDedicationSubs({ childName: "Maya", message: null }).DEDICATION,
   "For Maya, with love.", "null message → auto-default");
eq(buildDedicationSubs({ childName: "Maya", message: "   " }).DEDICATION,
   "For Maya, with love.", "whitespace-only message → auto-default");

// Defensive 120-char clamp (Zod caps at 120 on the website; boundary here too).
{
  const long = "x".repeat(200);
  const out = buildDedicationSubs({ childName: "Maya", message: long }).DEDICATION;
  assert(out.length === 120, `over-long message clamped to 120 (got ${out.length})`);
  console.log("  PASS — over-long message clamped to 120 chars");
}

// ---- Adult vibe-keyed dedication defaults (2026-07-21) ---------------------
console.log("\nADULT vibe-keyed defaults (adultMode:true):");
eq(buildDedicationSubs({ childName: "Marcus", adultMode: true, vibe: "romantic" }).DEDICATION,
   "For Marcus, with love.", "romantic");
eq(buildDedicationSubs({ childName: "Marcus", adultMode: true, vibe: "milestone" }).DEDICATION,
   "For Marcus. Here's to you.", "milestone (period, no em dash)");
eq(buildDedicationSubs({ childName: "Marcus", adultMode: true, vibe: "roast" }).DEDICATION,
   "For Marcus. You had this coming.", "roast");
eq(buildDedicationSubs({ childName: "Marcus", adultMode: true, vibe: "adventure" }).DEDICATION,
   "For Marcus, and the wrong turns worth taking.", "adventure");

// House style: NO em/en dash in any adult default.
for (const vibe of ["romantic", "milestone", "roast", "adventure"]) {
  const d = buildDedicationSubs({ childName: "Marcus", adultMode: true, vibe }).DEDICATION;
  assert(!/[—–]/.test(d), `adult '${vibe}' dedication must contain no em/en dash: ${d}`);
}
console.log("  PASS — no em/en dash in any adult default");

// A custom parent-written dedication STILL wins for adults.
eq(buildDedicationSubs({ childName: "Marcus", adultMode: true, vibe: "roast", message: "For Marcus, always." }).DEDICATION,
   "For Marcus, always.", "custom message wins over the adult default");

// ---- THE COLLISION (the exact seam that would break) -----------------------
// PET vibes {happy, adventure, tribute, memorial} and ADULT vibes
// {romantic, milestone, roast, adventure} SHARE the value 'adventure'. A pet book
// (adultMode:false) with vibe:'adventure' MUST render the child default, NOT the adult
// adventure line. Assert it directly — not by implication from a general check.
console.log("\nCOLLISION — pet 'adventure' must NOT get the adult adventure line:");
eq(buildDedicationSubs({ childName: "Biscuit", adultMode: false, vibe: "adventure" }).DEDICATION,
   "For Biscuit, with love.", "pet + vibe:'adventure' + adultMode:false → child default");
assert(
  buildDedicationSubs({ childName: "Biscuit", adultMode: false, vibe: "adventure" }).DEDICATION
    !== "For Biscuit, and the wrong turns worth taking.",
  "pet 'adventure' must NOT collide with the adult adventure dedication",
);
console.log("  PASS — collision blocked by the adultMode gate");

// ---- BYTE-IDENTICAL: adultMode:false is indistinguishable from no new args ----
console.log("\nBYTE-IDENTICAL child/pet (adultMode:false ≡ legacy call):");
for (const vibe of [null, "happy", "adventure", "tribute", "memorial"]) {
  const legacy = buildDedicationSubs({ childName: "Maya" }).DEDICATION;              // pre-change call shape
  const gated = buildDedicationSubs({ childName: "Maya", adultMode: false, vibe }).DEDICATION;
  eq(gated, legacy, `adultMode:false, vibe:${JSON.stringify(vibe)} ≡ legacy default`);
}

console.log("\n" + "=".repeat(72));
console.log("All front-matter dedication tests passed.");
console.log("=".repeat(72) + "\n");
