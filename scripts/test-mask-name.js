// scripts/test-mask-name.js
// No-API-cost unit tests for src/text-utils.js's maskName.
// Covers the 10 cases from the Item 4 audit + edge cases.

import { maskName } from "../src/text-utils.js";

function assert(condition, message) {
  if (!condition) {
    console.error(`FAIL: ${message}`);
    process.exit(1);
  }
}
function eq(actual, expected, label) {
  assert(actual === expected, `${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

console.log();
console.log("=".repeat(72));
console.log("maskName unit test (no API cost) — Item 4");
console.log("=".repeat(72));

// ---- Test 1 — Name at start, mid, end of sentence ----
console.log();
console.log("Test 1 — Name at start, mid, end of sentence: clean removal");
{
  // Start
  eq(maskName("Theo wears a striped tee", "Theo"), "wears a striped tee", "name at start");
  // Mid
  eq(maskName("Then Theo waved goodbye", "Theo"), "Then waved goodbye", "name mid-sentence");
  // End (no period)
  eq(maskName("The friend was Theo", "Theo"), "The friend was", "name at end no punct");
  // End (with period) — this is the Step-2.5 "..steady.." case
  eq(maskName("...kind friend like Theo.", "Theo"), "...kind friend like.", "name at end with period");
  console.log("  PASS");
}

// ---- Test 2 — Possessive forms (ASCII ' and smart quote ') ----
console.log();
console.log("Test 2 — Possessive forms (ASCII ' and smart quote ')");
{
  eq(maskName("Theo's hair is black", "Theo"), "hair is black", "ASCII possessive");
  eq(maskName("Theo’s hair is black", "Theo"), "hair is black", "smart-quote possessive");
  eq(maskName("That is Theo's bag.", "Theo"), "That is bag.", "ASCII possessive mid-sentence");
  console.log("  PASS");
}

// ---- Test 3 — Name not a substring of another word ----
console.log();
console.log("Test 3 — Name not substring of another word (word boundary)");
{
  eq(maskName("Theodora wears a dress", "Theo"), "Theodora wears a dress", "Theo in Theodora not matched");
  eq(maskName("Theos and Theo are friends", "Theo"), "Theos and are friends", "only 'Theo' matches, 'Theos' preserved");
  eq(maskName("matheo Theo", "Theo"), "matheo", "name at end preserves prefix word");
  console.log("  PASS");
}

// ---- Test 4 — Multiple occurrences in one string ----
console.log();
console.log("Test 4 — Multiple occurrences removed");
{
  eq(maskName("Theo and Theo's friend like Theo", "Theo"), "and friend like", "three occurrences (one possessive)");
  eq(maskName("Iris, Iris, Iris.", "Iris"), ",,.", "three with commas — note adjacent commas left for sentence-cleanup downstream");
  console.log("  PASS");
}

// ---- Test 5 — Diacritic name (Søren) ----
console.log();
console.log("Test 5 — Diacritic name (Søren) matches correctly");
{
  // Production Sonnet outputs "Søren is a six-year-old boy…" — the "is a"
  // grammar fix triggers there. Test both forms to cover both paths.
  eq(maskName("Søren is a six-year-old boy", "Søren"), "A six-year-old boy", "diacritic + is-a grammar fix");
  eq(maskName("Søren is six years old", "Søren"), "is six years old", "diacritic without 'is a'");
  eq(maskName("Then Søren laughed", "Søren"), "Then laughed", "diacritic mid-sentence");
  eq(maskName("Søren's hair", "Søren"), "hair", "diacritic possessive");
  console.log("  PASS");
}

// ---- Test 6 — Case variation ----
console.log();
console.log("Test 6 — Case variation (theo, Theo, THEO) all match");
{
  eq(maskName("theo wears stripes", "Theo"), "wears stripes", "lowercase in text, capitalized name");
  eq(maskName("THEO wears stripes", "Theo"), "wears stripes", "uppercase in text");
  eq(maskName("Theo wears stripes", "theo"), "wears stripes", "lowercase name");
  eq(maskName("Then theo and THEO and Theo waved", "Theo"), "Then and and waved", "mixed-case multiple");
  console.log("  PASS");
}

// ---- Test 7 — Empty inputs ----
console.log();
console.log("Test 7 — Empty inputs");
{
  eq(maskName("", "Theo"), "", "empty text → empty");
  eq(maskName("Theo wears stripes", ""), "Theo wears stripes", "empty name → text unchanged");
  eq(maskName("", ""), "", "both empty → empty");
  eq(maskName(null, "Theo"), "", "null text → empty");
  eq(maskName("Theo wears", null), "Theo wears", "null name → text unchanged");
  console.log("  PASS");
}

// ---- Test 8 — The original ".." Step 2.5 case ----
console.log();
console.log("Test 8 — The original '..' Step 2.5 case (orphan space + period collapse)");
{
  // Original failure shape: "He moves steady. Theo." after maskName left "He moves steady.. ."
  // With the fix, both the orphan whitespace and the double-period collapse to ".".
  eq(maskName("He moves steady. Theo.", "Theo"), "He moves steady.", "double-period collapse");
  eq(maskName("Look at Theo, Theo, and Theo", "Theo"), "Look at,, and", "trailing-comma orphans collapsed");
  console.log("  PASS");
}

// ---- Test 9 — Punctuation cleanup (" ." → ".") ----
console.log();
console.log("Test 9 — Punctuation cleanup for each punct");
{
  eq(maskName("She found Theo.", "Theo"), "She found.", "period orphan");
  eq(maskName("She likes Theo, and apples.", "Theo"), "She likes, and apples.", "comma orphan");
  eq(maskName("That is Theo; Iris is next.", "Theo"), "That is; Iris is next.", "semicolon orphan");
  eq(maskName("The friend Theo: a real one.", "Theo"), "The friend: a real one.", "colon orphan");
  eq(maskName("Hello Theo!", "Theo"), "Hello!", "exclamation orphan");
  eq(maskName("Is that Theo?", "Theo"), "Is that?", "question-mark orphan");
  console.log("  PASS");
}

// ---- Test 10 — Special regex chars in name (defensive) ----
console.log();
console.log("Test 10 — Special regex chars in name escaped correctly");
{
  // Most realistic: hyphen or apostrophe. Less realistic: parens, dots, etc.
  // All should escape cleanly and not crash.
  eq(maskName("A.B and Iris went to the park", "A.B"), "and Iris went to the park", "name with dot");
  eq(maskName("Iris-May is a six-year-old", "Iris-May"), "A six-year-old", "name with hyphen + is-a fix");
  eq(maskName("O'Brien went home", "O'Brien"), "went home", "name with apostrophe");
  // Ensure no regex injection crashes the call:
  let didNotThrow = true;
  try { maskName("text $1 here", "$1"); } catch { didNotThrow = false; }
  assert(didNotThrow, "name '$1' should not crash regex");
  console.log("  PASS");
}

// ---- Bonus: the existing "is a"/"is an" grammar fix preserved ----
console.log();
console.log("Test 11 (bonus) — 'is a'/'is an' grammar fix preserved");
{
  eq(maskName("Theo is a six-year-old boy", "Theo"), "A six-year-old boy", "is a → A");
  eq(maskName("Theo is an artist", "Theo"), "An artist", "is an → An");
  console.log("  PASS");
}

// ---- Bonus: Multi-token name behavior preserved ----
console.log();
console.log("Test 12 (bonus) — Multi-token name behavior (each token masked separately)");
{
  // "Iris May" tokenizes into ["Iris", "May"]; both are masked anywhere they appear.
  // Note this also catches "May" used as a common word — documented limit.
  eq(maskName("Iris went home", "Iris May"), "went home", "first token only present");
  eq(maskName("May went home", "Iris May"), "went home", "second token only present");
  eq(maskName("Iris May went home", "Iris May"), "went home", "both tokens adjacent");
  eq(maskName("Iris and May", "Iris May"), "and", "both tokens separated");
  // Known limit: 'May' as month name gets stripped
  eq(maskName("In May, we went home", "Iris May"), "In, we went home", "common-word false positive (documented limit)");
  console.log("  PASS");
}

console.log();
console.log("=".repeat(72));
console.log("All maskName tests passed.");
console.log("=".repeat(72));
console.log();
