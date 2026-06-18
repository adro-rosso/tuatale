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

console.log("\n" + "=".repeat(72));
console.log("All front-matter dedication tests passed.");
console.log("=".repeat(72) + "\n");
