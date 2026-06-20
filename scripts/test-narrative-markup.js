// scripts/test-narrative-markup.js
// No-API-cost unit test for the narrative typography markup helpers
// (book-polish "zing", 2026-06-21):
//
//   stripNarrativeMarkup  — tokens → plain inner text (for measure / auto-fit)
//   expandNarrativeMarkup — escaped text → <span class="tz-*"> HTML (+ page-1 drop cap)
//   hasNarrativeMarkup    — detector
//
// The load-bearing contract: expandNarrativeMarkup runs on ALREADY-ESCAPED
// text (escape first, then expand) so it never re-escapes its own spans, and
// the [[tag:...]] delimiters survive escapeHtml (which touches only & < > " ').

import { stripNarrativeMarkup, expandNarrativeMarkup, hasNarrativeMarkup } from "../src/text-utils.js";

// Local copy of page-pipeline's escapeHtml so we can prove the real two-step
// order (escape → expand) end-to-end without importing the render module.
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function assert(cond, msg) {
  if (!cond) { console.error(`FAIL: ${msg}`); process.exit(1); }
}
function eq(actual, expected, label) {
  assert(actual === expected, `${label}\n    expected: ${JSON.stringify(expected)}\n    actual:   ${JSON.stringify(actual)}`);
  console.log(`  PASS — ${label}`);
}
function has(hay, needle, label) {
  assert(hay.includes(needle), `${label}\n    "${needle}" not found in: ${JSON.stringify(hay)}`);
  console.log(`  PASS — ${label}`);
}
function not(hay, needle, label) {
  assert(!hay.includes(needle), `${label}\n    unexpected "${needle}" in: ${JSON.stringify(hay)}`);
  console.log(`  PASS — ${label}`);
}

console.log("\n" + "=".repeat(72));
console.log("narrative-markup unit test (no API cost)");
console.log("=".repeat(72) + "\n");

// ---- stripNarrativeMarkup: tokens → visible text (what measure/fit must see) ----
eq(stripNarrativeMarkup("goes in [[em:straight]]."), "goes in straight.", "strip em → inner word");
eq(stripNarrativeMarkup("a sound, [[sfx:thunk]], done"), "a sound, thunk, done", "strip sfx → inner word");
eq(stripNarrativeMarkup("[[line:He did it today.]]"), "He did it today.", "strip line → inner sentence");
eq(stripNarrativeMarkup("[[em:one]] then [[sfx:bang]] then [[line:Done.]]"), "one then bang then Done.", "strip multiple mixed tokens");
eq(stripNarrativeMarkup("no markup here"), "no markup here", "no-markup text unchanged");
eq(stripNarrativeMarkup(""), "", "empty passes through");
eq(stripNarrativeMarkup(null), null, "null passes through");
eq(stripNarrativeMarkup("[[em:  spaced  ]]"), "spaced", "inner whitespace trimmed");

// ---- hasNarrativeMarkup ----
eq(hasNarrativeMarkup("plain"), false, "detector false on plain");
eq(hasNarrativeMarkup("x [[em:y]] z"), true, "detector true with markup");

// ---- expandNarrativeMarkup: tokens → spans ----
has(expandNarrativeMarkup("goes in [[em:straight]].", {}), '<span class="tz-em">straight</span>', "em → tz-em span");
has(expandNarrativeMarkup("a [[sfx:thunk]] sound", {}), '<span class="tz-sfx">thunk</span>', "sfx → tz-sfx span");
has(expandNarrativeMarkup("[[line:He did it.]]", {}), '<span class="tz-line">He did it.</span>', "line → tz-line span");

// ---- page-1 deterministic drop cap ----
{
  const out = expandNarrativeMarkup("The sun is up.", { page: 1 });
  has(out, '<span class="tz-dropcap-wrap"><span class="tz-dropcap">T</span>he sun is up.</span>', "page 1 → drop cap on first letter");
}
{
  const out = expandNarrativeMarkup("The sun is up.", { page: 5 });
  not(out, "tz-dropcap", "page 5 → NO drop cap");
}
{
  // Page 1 opening straight into a [[line:]] (starts with '<' after expand) → no cap, no break.
  const out = expandNarrativeMarkup("[[line:Quiet now.]]", { page: 1 });
  not(out, "tz-dropcap", "page 1 starting with markup → drop cap safely skipped");
  has(out, '<span class="tz-line">Quiet now.</span>', "…and the line span still renders");
}

// ---- THE load-bearing order: escape FIRST, then expand ----
{
  // Prose with a real ampersand + angle bracket AND markup. Real pipeline does
  // expandNarrativeMarkup(escapeHtml(text), {page}).
  const raw = "Tom & Jerry <3 it goes in [[em:straight]].";
  const out = expandNarrativeMarkup(escapeHtml(raw), { page: 2 });
  has(out, "Tom &amp; Jerry &lt;3", "prose & and < are escaped (entities), not raw");
  has(out, '<span class="tz-em">straight</span>', "markup still becomes a REAL span (not escaped)");
  not(out, "&lt;span", "span is real HTML, never escaped to &lt;span");
}
{
  // Special chars INSIDE a token stay escaped (safe) after expand.
  const raw = "[[em:A & B]]";
  const out = expandNarrativeMarkup(escapeHtml(raw), { page: 2 });
  eq(out, '<span class="tz-em">A &amp; B</span>', "escaped entity inside token preserved within span");
}

console.log("\n" + "=".repeat(72));
console.log("All narrative-markup tests passed.");
console.log("=".repeat(72) + "\n");
