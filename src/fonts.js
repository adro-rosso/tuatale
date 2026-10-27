// src/fonts.js — self-hosted STATIC TrueType fonts for every Chromium → PDF render.
//
// Why: Chromium embeds a Google-served VARIABLE font as a Type 3 font (glyph streams) in the
// PDF, which print prepress can reject; a static TrueType file embeds as a CIDFontType2
// subset. So every face the book prints with — interior story pages, the $0 title /
// dedication / colophon, the typography treatments (tz-*) and the cover voices — ships as a
// static TTF under assets/fonts/ (OFL; licence texts alongside) and is loaded through local
// @font-face rules with absolute file:// URLs. No network at render time; the worker image
// COPYs assets/ (worker/Dockerfile).
//
// Adding a face: drop the static TTF in assets/fonts/ (variable masters from
// github.com/google/fonts are cut to static instances with fontTools:
// `python -m fontTools.varLib.instancer --update-name-table -o Family-Medium.ttf
//  "Family[wght].ttf" wght=500`), add it to FONT_FILES, and worker/tests/fonts.test.js
// checks the file exists, is static TrueType, and covers the weights the templates use.
//
// Pure: no I/O (the URL below is computed, not read).

import { fileURLToPath } from "node:url";

/** family → [[file, weight, style], ...]. Only the weights/styles the templates actually use. */
export const FONT_FILES = {
  // Interior story pages + $0 front matter (title / dedication / colophon) + the tz-* drop cap
  // and emphasis (500) and the standalone italic line (400 italic).
  "EB Garamond":         [["EBGaramond-Regular.ttf", 400, "normal"], ["EBGaramond-Medium.ttf", 500, "normal"], ["EBGaramond-SemiBold.ttf", 600, "normal"], ["EBGaramond-Italic.ttf", 400, "italic"]],
  // tz-sfx sound words (page-pipeline.js TREATMENT_CSS).
  "Architects Daughter": [["ArchitectsDaughter-Regular.ttf", 400, "normal"]],
  // Cover voices (cover-voices.js) + the "A Tuatale Book" mark (Nunito).
  "Fraunces":            [["Fraunces-Bold.ttf", 700, "normal"], ["Fraunces-SemiBold.ttf", 600, "normal"], ["Fraunces-BoldItalic.ttf", 700, "italic"], ["Fraunces-SemiBoldItalic.ttf", 600, "italic"]],
  "Sorts Mill Goudy":    [["SortsMillGoudy-Regular.ttf", 400, "normal"], ["SortsMillGoudy-Italic.ttf", 400, "italic"]],
  "Alegreya SC":         [["AlegreyaSC-Bold.ttf", 700, "normal"], ["AlegreyaSC-Medium.ttf", 500, "normal"]],
  "Oswald":              [["Oswald-Bold.ttf", 700, "normal"], ["Oswald-SemiBold.ttf", 600, "normal"]],
  "Patrick Hand":        [["PatrickHand-Regular.ttf", 400, "normal"]],
  "Arvo":                [["Arvo-Bold.ttf", 700, "normal"]],
  "Varela Round":        [["VarelaRound-Regular.ttf", 400, "normal"]],
  "Gochi Hand":          [["GochiHand-Regular.ttf", 400, "normal"]],
  "Nunito":              [["Nunito-ExtraBold.ttf", 800, "normal"], ["Nunito-Bold.ttf", 700, "normal"], ["Nunito-SemiBoldItalic.ttf", 600, "italic"]],
};

/** file:///…/assets/fonts/ — absolute, so a page written to os.tmpdir() still resolves it. */
export const FONTS_DIR_URL = new URL("../assets/fonts/", import.meta.url).href;
/** The same directory as a filesystem path (tests, diagnostics). */
export const FONTS_DIR = fileURLToPath(FONTS_DIR_URL);

/** Matches a Google Fonts <link> (stylesheet or preconnect) so a page can be made network-free. */
export const GOOGLE_FONTS_LINK_RE = /<link\b[^>]*fonts\.g(?:oogleapis|static)\.com[^>]*>[ \t]*\r?\n?/gi;

/**
 * @font-face rules for the given families (deduplicated), pointing at the local TTFs.
 * Throws on a family that is not self-hosted — a silent system-font fallback would change
 * the look of a printed book, so it has to fail loudly at render time and in tests.
 */
export function fontFaceRules(families, dirUrl = FONTS_DIR_URL) {
  const rules = [];
  for (const fam of new Set(families)) {
    const files = FONT_FILES[fam];
    if (!files) throw new Error(`fonts: "${fam}" is not self-hosted — add its static TTF(s) to assets/fonts/ and FONT_FILES (src/fonts.js)`);
    for (const [file, weight, style] of files) {
      rules.push(`@font-face{font-family:'${fam}';font-weight:${weight};font-style:${style};font-display:block;src:url('${dirUrl}${file}') format('truetype');}`);
    }
  }
  return rules.join("\n");
}

/** `<style>` element wrapping fontFaceRules(). */
export function fontFaceStyle(families, dirUrl = FONTS_DIR_URL) {
  return `<style>${fontFaceRules(families, dirUrl)}</style>`;
}

/** The self-hosted families a page names (quoted, as in `font-family: "EB Garamond", serif`). */
export function familiesReferenced(html) {
  return Object.keys(FONT_FILES).filter((fam) => {
    const esc = fam.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`['"]${esc}['"]`).test(html);
  });
}

/**
 * Make a page's fonts local: strip any Google Fonts <link> and add, just before </head>, the
 * @font-face rules for every self-hosted family the page names (plus `extraFamilies`).
 * Used by the interior page render (page-pipeline.js) and the {{KEY}} front-matter pages
 * (front-matter.js renderTemplatePage). Pages that name no self-hosted family come back
 * with only the <link>s removed.
 */
export function localizeFonts(html, { extraFamilies = [], dirUrl = FONTS_DIR_URL } = {}) {
  const stripped = html.replace(GOOGLE_FONTS_LINK_RE, "");
  const families = [...new Set([...familiesReferenced(stripped), ...extraFamilies])];
  if (families.length === 0) return stripped;
  return stripped.replace(/<\/head>/i, `${fontFaceStyle(families, dirUrl)}</head>`);
}
