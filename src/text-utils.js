// src/text-utils.js
// Pure text utilities shared across the pipeline. No I/O, no API calls.
//
// Pre-launch defect cleanup Item 4 (2026-06-01) — extracted maskName here
// from scripts/generate-book.js (where it was unimportable from tests because
// importing the CLI runs its top-level side effects) and fixed three gaps
// identified in the audit:
//
//   1. Punctuation orphans: removing a name immediately before a period
//      previously left " ." instead of "." (the "..steady.." Step-2.5 case).
//      Now collapsed via a `\s+([.,;:!?]) → $1` rule.
//   2. Case-sensitivity: the regex lacked the `i` flag so "Theo" matched but
//      "theo" / "THEO" did not. Customer descriptions sometimes use lowercase
//      pronouns + lowercased name forms. Now `/gi`.
//   3. Smart-quote possessive: ASCII apostrophe (') and U+2019 (') were not
//      both matched. Sonnet sometimes emits smart quotes in possessives.
//      Now `(?:['']s)?` matches either.
//
// Word-boundary `\b` was already correct in the pre-Item-4 implementation
// (the earlier session-banked "regex bug" claim was based on a misread —
// it was the COPIES of maskName in throwaway probe scripts that had the
// `\b` (backspace char) typo, not the production version).

/**
 * Remove a subject's name (and possessive form) from a description.
 *
 * Mostly used at sheet-mint time so the masked appearance text fed to Gemini
 * doesn't have a known anchor name in it (which would otherwise risk Gemini
 * rendering the name as visible text or anchoring on the wrong subject in
 * multi-subject scenes).
 *
 * Multi-token names (e.g., "Iris May") are split on whitespace; each token
 * is masked separately. This matches the pre-Item-4 production behavior.
 *
 * Examples:
 *   maskName("Theo wears stripes", "Theo")        → "wears stripes"
 *   maskName("Theo's hair is black", "Theo")      → "hair is black"
 *   maskName("…like Theo.", "Theo")               → "…like."   (orphan space collapsed)
 *   maskName("theo wears stripes", "Theo")        → "wears stripes" (case-insensitive)
 *   maskName("Theodora wears", "Theo")            → "Theodora wears" (word boundary)
 *   maskName("Theo and Theo's friend", "Theo")    → "and friend"
 *   maskName("Søren is six", "Søren")             → "A six" (the "is a" grammar fix)
 *
 * Known limitations:
 *   - "Theo'shair" (no space after possessive) leaves "'shair" residue.
 *     Treated as a typo case; not worth the regex complexity.
 *   - Common-word names ("May", "Lily", "Will") could false-positive when
 *     the description uses them in a common-word sense. Case-insensitive
 *     matching makes this slightly more likely. Documented limit.
 *
 * @param {string} text
 * @param {string} name
 * @returns {string}
 */
export function maskName(text, name) {
  if (!text || !name) return text ?? "";

  const tokens = String(name).trim().split(/\s+/).filter(Boolean);
  let result = String(text);

  for (const token of tokens) {
    if (!token) continue;
    const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // \b word boundary, (?:['']s)? for ASCII or curly-quote possessive,
    // /gi for global + case-insensitive matching.
    const pattern = new RegExp(`\\b${escaped}(?:['’]s)?\\b`, "gi");
    result = result.replace(pattern, "");
  }

  // Collapse multi-whitespace
  result = result.replace(/\s+/g, " ");
  // Collapse ". ." (period + space + period) → "." BEFORE the orphan-space
  // cleanup. This handles the Step-2.5 "He moves steady. Theo." case where
  // the trailing sentence "Theo." leaves ". ." after removal. We require
  // actual whitespace between periods so legitimate ellipses ("...") and
  // typographic doubled periods ("..") survive unchanged.
  result = result.replace(/\.\s+\./g, ".");
  // Fix orphaned punctuation: " ." → ".", " ," → ",", etc.
  result = result.replace(/\s+([.,;:!?])/g, "$1");
  // Defensive: orphaned " 's" (shouldn't happen with the possessive group
  // but cheap insurance against partial matches).
  result = result.replace(/\s+['’]s\b/g, "'s");
  result = result.trim();

  // Grammar fix: "<Name> is a six-year-old…" becomes "is a six-year-old…"
  // after removal, which reads awkwardly. Capitalize to "A six-year-old…"
  // so the masked text is still a usable sentence fragment.
  if (result.startsWith("is a ")) {
    result = "A " + result.slice("is a ".length);
  } else if (result.startsWith("is an ")) {
    result = "An " + result.slice("is an ".length);
  }

  return result;
}
