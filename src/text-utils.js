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
// ---- Narrative typography markup -----------------------------------------
// Sonnet may mark up a FEW moments in narrative_text with three inline tags
// (see the EMPHASIS MARKUP section of the story-gen system prompt):
//
//   [[em:word]]        slightly-larger iron-oxide accent on one peak word
//   [[sfx:word]]       hand-lettered sound word (onomatopoeia)
//   [[line:sentence.]] one standalone emotional sentence on its own line
//
// Delimiter choice: [[tag:...]] survives BOTH the em-dash sanitizer
// (stripNarrativeDashes touches only dashes / whitespace / commas — never
// [ ] :) AND HTML-escaping (escapeHtml touches only & < > " ' — never the
// bracket/colon delimiters). The inner content `[^\]]+` cannot cross the
// closing `]]`, so adjacent tokens never run together.
//
// Two consumers, two helpers:
//   - stripNarrativeMarkup: tokens → their plain inner text. Used BEFORE
//     measuring / auto-fit (text-measurement + auto-fit escape+measure the
//     literal string, so they must see the visible characters, not the
//     bracket tokens, or sizing would be wrong).
//   - expandNarrativeMarkup: tokens → <span class="tz-*"> HTML. Runs on
//     ALREADY-ESCAPED text at render time (escape FIRST, THEN expand — the
//     load-bearing ordering; expanding first would let escapeHtml turn the
//     spans into visible &lt;span&gt; text).
const NARRATIVE_TOKEN_RE = {
  em: /\[\[em:([^\]]+)\]\]/g,
  sfx: /\[\[sfx:([^\]]+)\]\]/g,
  line: /\[\[line:([^\]]+)\]\]/g,
};

/** Replace every [[tag:...]] token with its trimmed inner text. Pure + idempotent. */
export function stripNarrativeMarkup(text) {
  if (typeof text !== "string" || text.length === 0) return text;
  return text
    .replace(NARRATIVE_TOKEN_RE.em, (_, x) => x.trim())
    .replace(NARRATIVE_TOKEN_RE.sfx, (_, x) => x.trim())
    .replace(NARRATIVE_TOKEN_RE.line, (_, x) => x.trim());
}

/** True if the text carries any narrative markup token. */
export function hasNarrativeMarkup(text) {
  return typeof text === "string" && /\[\[(?:em|sfx|line):[^\]]+\]\]/.test(text);
}

// Page-1 deterministic drop cap: wrap the opening letter as an oversized
// decorative initial and left-align the opening paragraph. Skipped (returns
// unchanged) unless the text starts with a plain letter — if page 1 opens with
// markup or an escaped entity, no cap rather than a broken one.
function applyDropCap(html) {
  const m = html.match(/^([A-Za-z])([\s\S]*)$/);
  if (!m) return html;
  return `<span class="tz-dropcap-wrap"><span class="tz-dropcap">${m[1]}</span>${m[2]}</span>`;
}

/**
 * Expand [[tag:...]] tokens in ALREADY-ESCAPED text into styled spans, and
 * (page 1 only) apply the deterministic opening drop cap.
 *
 * @param {string} escapedText  narrative text already passed through escapeHtml
 * @param {{ page?: number }} [opts]
 * @returns {string} render-ready HTML for the .narrative text zone
 */
export function expandNarrativeMarkup(escapedText, { page } = {}) {
  if (typeof escapedText !== "string" || escapedText.length === 0) return escapedText;
  let html = escapedText
    .replace(NARRATIVE_TOKEN_RE.em, (_, x) => `<span class="tz-em">${x.trim()}</span>`)
    .replace(NARRATIVE_TOKEN_RE.sfx, (_, x) => `<span class="tz-sfx">${x.trim()}</span>`)
    .replace(NARRATIVE_TOKEN_RE.line, (_, x) => `<span class="tz-line">${x.trim()}</span>`);
  if (page === 1) html = applyDropCap(html);
  return html;
}

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
