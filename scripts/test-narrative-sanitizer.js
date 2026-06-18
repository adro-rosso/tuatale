// scripts/test-narrative-sanitizer.js
// No-API-cost unit test for Item 1 (book-polish): the deterministic em/en-dash
// sanitizer applied to printed story fields (narrative_text + title).
//
// stripNarrativeDashes is the GUARANTEE layered on top of the prompt rule —
// it must remove every em dash (—) and en dash (–) and the typed double-hyphen
// (--), replacing each with a clean comma, WITHOUT touching single hyphens
// (well-loved, tip-toe). Pure + idempotent.

// dotenv first: importing src/anthropic.js throws at load if ANTHROPIC_API_KEY
// is unset (same guard the other scripts rely on). No API call is made here.
import "dotenv/config";
import { stripNarrativeDashes } from "../src/anthropic.js";

function assert(condition, message) {
  if (!condition) {
    console.error(`FAIL: ${message}`);
    process.exit(1);
  }
}
function eq(actual, expected, label) {
  assert(actual === expected, `${label}\n    expected: ${JSON.stringify(expected)}\n    actual:   ${JSON.stringify(actual)}`);
  console.log(`  PASS — ${label}`);
}
const noDashes = (s) => !/[—–]|--/.test(s);

console.log();
console.log("=".repeat(72));
console.log("narrative-sanitizer unit test (no API cost) — Item 1 em/en-dash strip");
console.log("=".repeat(72));
console.log();

// ---- Core replacements ----
eq(stripNarrativeDashes("Lila ran — fast."), "Lila ran, fast.", "spaced em dash → comma");
eq(stripNarrativeDashes("Lila—fast"), "Lila, fast", "unspaced em dash → comma");
eq(stripNarrativeDashes("wait--what"), "wait, what", "typed double-hyphen → comma");

// ---- Digit-guard: a number range (digit on BOTH sides) stays a range ----
eq(stripNarrativeDashes("ages 3–5 today"), "ages 3–5 today", "en-dash range 3–5 PRESERVED (digit both sides)");
eq(stripNarrativeDashes("count 1—10 sheep"), "count 1—10 sheep", "em-dash numeric range 1—10 PRESERVED");
eq(stripNarrativeDashes("on page 3 — really"), "on page 3, really", "digit on ONE side only → still converts to comma");
eq(stripNarrativeDashes("a long–quiet day"), "a long, quiet day", "en dash between WORDS → comma (not a range)");

// ---- Single hyphens are sacred ----
eq(stripNarrativeDashes("a well-loved tip-toe dance"), "a well-loved tip-toe dance", "single hyphens untouched");

// ---- Spacing / punctuation cleanup ----
eq(stripNarrativeDashes("She waited —. Then she slept."), "She waited. Then she slept.", "dash before period → clean period (no stray comma)");
eq(stripNarrativeDashes("— Then she ran"), "Then she ran", "leading dash → no leading comma");
eq(stripNarrativeDashes("She paused, — then ran"), "She paused, then ran", "dash beside existing comma → single comma");
eq(stripNarrativeDashes("Bo looked up — and up — and up."), "Bo looked up, and up, and up.", "multiple em dashes all replaced");

// ---- Title field ----
eq(stripNarrativeDashes("Mia — The Brave"), "Mia, The Brave", "title em dash → comma");

// ---- Pass-through + robustness ----
eq(stripNarrativeDashes("A clean sentence with no dashes."), "A clean sentence with no dashes.", "no-dash text unchanged");
eq(stripNarrativeDashes(""), "", "empty string passes through");
eq(stripNarrativeDashes(null), null, "null passes through (non-string guard)");
eq(stripNarrativeDashes(undefined), undefined, "undefined passes through (non-string guard)");

// ---- Idempotency: a second pass must be a no-op ----
{
  const once = stripNarrativeDashes("Bo looked up — and up — and up.");
  const twice = stripNarrativeDashes(once);
  eq(twice, once, "idempotent (second pass is a no-op)");
}

// ---- Invariant: non-range dashes always collapse (output is dash-free) ----
// (Number ranges like "3–5" intentionally keep their dash — covered above, so
// they are excluded from this dash-free invariant.)
{
  const samples = [
    "Lila ran — fast.", "Lila—fast", "wait--what",
    "Bo looked up — and up — and up.", "Mia — The Brave", "— Then she ran",
    "on page 3 — really", "a long–quiet day",
  ];
  for (const s of samples) {
    assert(noDashes(stripNarrativeDashes(s)), `output still contains a dash for input ${JSON.stringify(s)}`);
  }
  console.log(`  PASS — every non-range sample collapses to a dash-free string`);
}

console.log();
console.log("=".repeat(72));
console.log("All narrative-sanitizer tests passed.");
console.log("=".repeat(72));
console.log();
