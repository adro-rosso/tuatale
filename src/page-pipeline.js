// src/page-pipeline.js
// Per-page rendering pipeline that ties together:
//   - measureText (text-measurement primitive)
//   - detectCleanRegion (image-aware region detection)
//   - fitTextToRegion (auto-fit text to detected region)
//   - generateImage (Gemini image gen)
//   - dynamic-CSS Puppeteer PDF rendering
//
// Given a template config + scene + narrative, this function produces a
// single PDF page where text is positioned in the cleanest cream area
// found in the generated (or override-provided) image, and sized to fit
// that area cleanly via auto-fit.
//
// See SESSION_NOTES for Stage-2 architecture context.

import "dotenv/config";  // src/gemini.js reads GEMINI_API_KEY at import time
import fs from "node:fs";
import os from "node:os";
import crypto from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";
import puppeteer from "puppeteer";
import sharp from "sharp";
import { measureText } from "./text-measurement.js";
import { detectCleanRegion } from "./region-detection.js";
import { fitTextToRegion } from "./auto-fit.js";
import { generateImage } from "./gemini.js";
import { stripNarrativeMarkup, expandNarrativeMarkup } from "./text-utils.js";
import { fillMediumTokens } from "./art-styles.js";

const GEMINI_IMAGE_USD_PER_CALL = 0.04;

// ---- Narrative typography treatments -------------------------------------
// The picked variants (book-polish "zing", 2026-06-21). Injected into EVERY
// page render so the tz-* span classes (emitted by expandNarrativeMarkup) and
// the deterministic page-1 drop cap resolve. Sizes are in `em` so they ride
// the auto-fit font-size (Type A/C dynamic) or the static template size (Type
// B) without re-measuring. Treatments live ONLY in the CSS text zone — never
// on the image. ACCENT is the brand iron-oxide (matches cover + website).
const TZ_ACCENT = "#7a3328";
const TREATMENT_FONT_LINK =
  '<link href="https://fonts.googleapis.com/css2?family=Architects+Daughter&display=swap" rel="stylesheet">';
const TREATMENT_CSS = `
  /* emphasis (b): slightly larger + iron-oxide accent — sparing */
  .tz-em { color: ${TZ_ACCENT}; font-size: 1.16em; font-weight: 500; }
  /* sound word (b): hand-lettered + accent + slight tilt */
  .tz-sfx { font-family: "Architects Daughter", cursive; font-size: 2.1em; color: ${TZ_ACCENT};
            display: inline-block; transform: rotate(-5deg); line-height: 1; }
  /* standalone emotional line: own larger italic line with air */
  .tz-line { display: block; margin-top: 0.7em; font-size: 1.28em; font-style: italic; }
  /* deterministic page-1 drop cap (left-aligned opening) */
  .tz-dropcap-wrap { display: block; text-align: left; }
  .tz-dropcap { float: left; font-family: "EB Garamond", Garamond, "Times New Roman", serif;
                font-size: 3em; line-height: 0.74; padding: 0.02em 0.08em 0 0;
                font-weight: 500; color: ${TZ_ACCENT}; }
`;

// ---- Unit helpers ---------------------------------------------------------

function parseInchesValue(value) {
  // Accept "11in", "612pt", or a bare number (treated as inches).
  if (typeof value === "number") return value;
  if (typeof value !== "string") throw new Error(`parseInchesValue: bad input ${value}`);
  if (value.endsWith("in")) return parseFloat(value);
  if (value.endsWith("pt")) return parseFloat(value) / 72;
  return parseFloat(value);
}

function inchesToPoints(inches) {
  return inches * 72;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ---- Pixel-to-page-point conversion (object-fit: cover) ------------------
// scale = max(pageHpt/srcHpx, pageWpt/srcWpx). The larger scale applies;
// the other axis overflows and is centre-cropped. See SESSION_NOTES
// "Pixel-to-page-pt conversion is load-bearing" for the math derivation.
function srcToPagePt(srcRegion, imgInfo, pageSizeIn) {
  const srcWpx = imgInfo.width;
  const srcHpx = imgInfo.height;
  const pageWpt = inchesToPoints(parseInchesValue(pageSizeIn.width));
  const pageHpt = inchesToPoints(parseInchesValue(pageSizeIn.height));

  const scaleByH = pageHpt / srcHpx;
  const scaleByW = pageWpt / srcWpx;
  const scale = Math.max(scaleByH, scaleByW);
  const scaledWpt = srcWpx * scale;
  const scaledHpt = srcHpx * scale;
  const cropLeftPt = (scaledWpt - pageWpt) / 2;
  const cropTopPt = (scaledHpt - pageHpt) / 2;

  return {
    region: {
      x: srcRegion.x * scale - cropLeftPt,
      y: srcRegion.y * scale - cropTopPt,
      width: srcRegion.width * scale,
      height: srcRegion.height * scale,
    },
    conversion: {
      scale,
      scaleByHeight: scaleByH,
      scaleByWidth: scaleByW,
      cropLeftPt,
      cropTopPt,
      pageWidthPt: pageWpt,
      pageHeightPt: pageHpt,
    },
  };
}

// ---- Dynamic CSS override block ------------------------------------------
function buildDynamicCss({ region, fontSize, color }) {
  return `
    .text-layer {
      top: ${region.y.toFixed(3)}pt !important;
      left: ${region.x.toFixed(3)}pt !important;
      width: ${region.width.toFixed(3)}pt !important;
      height: ${region.height.toFixed(3)}pt !important;
      transform: none !important;
    }
    .narrative {
      font-size: ${fontSize}pt !important;
      ${color ? `color: ${color} !important;` : ""}
    }
  `;
}

// ---- Render PDF with dynamic CSS injection -------------------------------
// Returns { pdfPath, renderedPngPath }. The PNG is a viewport screenshot
// taken in the same Puppeteer session as the PDF — same HTML, same
// dimensions, same object-fit:cover crop. It exists so measurement can
// run against the FINAL rendered page (post-crop, post-text-overlay) —
// the only honest reflection of what the user sees, and the lesson banked
// from prompt-7-iter-1 validation (measuring the raw Gemini PNG lied when
// Gemini's output aspect varied and CSS cover re-cropped it on the page).
async function renderPdfWithDynamicCss({
  templateHtmlPath,
  imagePath,
  narrativeText,
  pageSize,
  dynamicCss,
  outputPath,
  page = null,
}) {
  let templateHtml = fs.readFileSync(templateHtmlPath, "utf8");
  const imageFileUrl = pathToFileURL(imagePath).href;
  // Escape FIRST, then expand the [[tag:...]] markup into <span> HTML. This
  // ordering is load-bearing: escapeHtml neutralises any real < & " in the
  // prose, and because it never touches [ ] :, the markup tokens survive it;
  // expandNarrativeMarkup then turns them into real spans (+ the page-1 drop
  // cap). Doing it the other way round would escape our own spans into text.
  const narrativeHtml = expandNarrativeMarkup(escapeHtml(narrativeText), { page });
  templateHtml = templateHtml
    .replace(/\{\{IMAGE_URL\}\}/g, imageFileUrl)
    .replace(/\{\{NARRATIVE_TEXT\}\}/g, narrativeHtml);

  // Always inject the typography-treatment font + CSS so the tz-* classes
  // resolve. Goes in before any dynamicCss so the latter's !important
  // font-size on .narrative still wins; the tz-* sizes are em-relative.
  templateHtml = templateHtml.replace(
    /<\/head>/i,
    `${TREATMENT_FONT_LINK}<style>${TREATMENT_CSS}</style></head>`
  );

  // Source-order CSS: the injected <style> at end of <head> overrides the
  // template's earlier <style> for equal-specificity selectors. Combined
  // with !important rules in dynamicCss, the override is robust.
  // Type B templates skip the injection entirely (dynamicCss is null).
  if (dynamicCss) {
    templateHtml = templateHtml.replace(
      /<\/head>/i,
      `<style>${dynamicCss}</style></head>`
    );
  }

  // Unique per-render temp path in the OS temp dir — NOT a shared path in
  // the template dir. Concurrent renders (multiple books, or a multi-page
  // book under load) previously collided on a single
  // `templates/<id>/_pipeline-rendering.html`, racing write/read/unlink
  // (caused the Mia + Priya retries in the 2026-05-25 robustness batch).
  // crypto.randomUUID() guarantees no two renders share a path. The temp
  // HTML has no relative-path deps (image is an absolute file:// URL,
  // fonts are absolute https), so os.tmpdir() is safe.
  const tempHtmlPath = path.join(os.tmpdir(), `daboo-render-${crypto.randomUUID()}.html`);
  fs.writeFileSync(tempHtmlPath, templateHtml, "utf8");

  // Sidecar PNG path — `page-NN.pdf` → `page-NN-rendered.png`. Sits next
  // to the PDF in outputDir so tests + downstream tools can locate it
  // without extra plumbing.
  const renderedPngPath = outputPath.replace(/\.pdf$/i, "-rendered.png");

  // Viewport for screenshot. Page dimensions at 96dpi (browser default
  // for CSS inch units). 11×8.5in → 1056×816px. page.pdf() ignores the
  // viewport (uses print rendering) so the PDF is unaffected; only the
  // screenshot uses these dimensions.
  const pageWidthIn = parseInchesValue(pageSize.width);
  const pageHeightIn = parseInchesValue(pageSize.height);
  const viewportPxW = Math.round(pageWidthIn * 96);
  const viewportPxH = Math.round(pageHeightIn * 96);

  let browser;
  try {
    // PUPPETEER_LAUNCH_ARGS lets the container pass Chrome flags it needs —
    // notably --no-sandbox, required when running in Docker without the
    // SYS_ADMIN capability (Fly.io can't grant it). Unset locally → args:[],
    // i.e. byte-for-byte the historical behavior (verified by the B.3 harness).
    const launchArgs = process.env.PUPPETEER_LAUNCH_ARGS
      ? process.env.PUPPETEER_LAUNCH_ARGS.split(/\s+/).filter(Boolean)
      : [];
    browser = await puppeteer.launch({ headless: true, args: launchArgs });
    const page = await browser.newPage();
    await page.setViewport({ width: viewportPxW, height: viewportPxH });
    await page.goto(pathToFileURL(tempHtmlPath).href, { waitUntil: "networkidle0" });
    await page.evaluate(() => document.fonts.ready);
    await page.pdf({
      path: outputPath,
      width: pageSize.width,
      height: pageSize.height,
      printBackground: true,
      margin: { top: 0, right: 0, bottom: 0, left: 0 },
      preferCSSPageSize: false,
    });
    await page.screenshot({
      path: renderedPngPath,
      clip: { x: 0, y: 0, width: viewportPxW, height: viewportPxH },
      type: "png",
    });
    await browser.close();
  } catch (err) {
    if (browser) { try { await browser.close(); } catch {} }
    throw err;
  } finally {
    // Clean up the per-render temp HTML on BOTH success and error paths.
    // Guarded: the file may already be gone (or never written) — losing
    // the temp file is harmless, but a throw here would mask the real error.
    try { fs.unlinkSync(tempHtmlPath); } catch {}
  }
  return { pdfPath: outputPath, renderedPngPath };
}

// ---- Diagnostic helpers --------------------------------------------------

function finalizeTiming(timing, tStart) {
  timing.totalMs = Date.now() - tStart;
  return timing;
}

function extractFitDiagnostics(fit) {
  if (!fit) return null;
  return {
    fits: fit.fits,
    fontSize: fit.fontSize,
    lines: fit.measurement ? fit.measurement.lines : null,
    iterations: fit.iterations,
    rejectedSizes: fit.rejectedSizes,
    measurement: fit.measurement ? {
      heightPt: fit.measurement.heightPt,
      widthPt: fit.measurement.widthPt,
      actualMaxWidthPt: fit.measurement.actualMaxWidthPt,
    } : null,
  };
}

// ---- Main pipeline entry -------------------------------------------------

// Canvas-split V2 composition rule (2026-05-31, validated via the Pip
// Scene B probe in templates/_multisubject-probe/). Stronger replacement
// for the Stage C wording ("Single unified scene with all named subjects
// appearing exactly once...") — adds positive shared-environment cues
// (same ground / light / horizon) and an expanded negative-list with
// synonyms (panel / seam / split / diptych / side-by-side) so Gemini's
// escape hatches into compositional dialects close cleanly.
//
// Applied to N>1 branches only (gated 2026-06-01 per Item 7 audit):
//   - N>1: load-bearing — fixes the mid-distance wide-shot vertical seam
//     observed across the Bramble + Pip soft-anchor probes
//   - N=1: skipped — no canvas-seam failure mode to defend against (only
//     one subject), and the plural framing ("subjects share the same
//     ground", "each named subject appears exactly once") could subtly
//     suppress legitimate single-subject compositional flexibility
const COMPOSITION_RULE_V2 =
  "Render this as a single continuous painted scene. The entire image must " +
  "read as one shared physical space with one consistent background that " +
  "flows unbroken across the full width of the frame. NO panel divisions, " +
  "NO vertical seams, NO split compositions, NO diptych or side-by-side " +
  "arrangements. The subjects share the same ground, the same light, the " +
  "same horizon — they are all in ONE place together, not in separate views. " +
  "Each named subject appears exactly once in the scene.";

/**
 * Build the user-facing prompt string for one page's Gemini call. Branches
 * on subjects.length: N=1 follows the legacy single-subject layout; N>1
 * adds per-subject Appearance blocks + a References mapping (Stage B's
 * parallel-emphasis pattern).
 *
 * The COMPOSITION_RULE_V2 is appended to templateComposition in the N>1
 * branch only — N=1 uses the bare templateComposition (no canvas-seam
 * defense needed for one subject, and the plural framing risks subtle
 * over-constraint at the prompt level).
 *
 * Multi-subject layout (N > 1, Step 3 build, 2026-05-31): one Subject + one
 * Appearance block per subject; a single shared Style / Composition /
 * Template composition / Avoid; and a trailing References mapping that
 * pins each subject to a contiguous range of reference-image positions
 * (Stage B's parallel-emphasis pattern).
 *
 * @param {object} opts
 * @param {Array<{
 *   name: string, age: number, description: string,
 *   subjectType: string, sheetCount: number
 * }>} opts.subjects  IN ORDER — the order each subject's sheets are
 *   concatenated into the references array passed to generateImage. Element
 *   [0] is the anchor (protagonist for multi-character books; the sole
 *   subject for legacy single-protagonist books). sheetCount is the number
 *   of refs THIS call uses for this subject (post-allocator), not the total
 *   minted for them.
 * @param {object} opts.scene                  { page, action }
 * @param {string} opts.styleLine              joined Style: text
 * @param {string} opts.compositionLine        joined Composition: text
 * @param {string} opts.templateComposition    template-specific composition
 * @param {string} opts.negativePrompt         joined Avoid: text
 * @returns {string} the full prompt
 */
// Outfit-anchoring directive (B.8, 2026-06-08). B.7 found that each subject's
// outfit is ALREADY described in their Appearance block (Sonnet commits one
// outfit per book) and shown in the reference sheets, yet multi-character
// renders drift to a different outfit nearly every page. The fix is render-level
// emphasis: a prominent "wear the identical reference outfit on every page"
// directive. Pointing at the reference image + Appearance line (rather than
// re-parsing the outfit string out of the prose) keeps it robust. Additive +
// easy to revert (delete this fn + its two call sites). Tunable strength: this
// is the B.8 "Option B+" — restate-and-lock without per-garment enumeration;
// escalate to per-axis constraints (Option C) here if iteration shows drift.
// Returns the directive followed by a paragraph break, or "" — so call sites can
// inline it and, when disabled, reproduce the exact pre-B.8 prompt byte-for-byte.
// WARDROBE_LOCK=off disables it (used for the B.8 A/B baseline render).
function buildWardrobeLock(subjects) {
  if (process.env.WARDROBE_LOCK === "off") return "";
  const named = subjects.map((s) => s.name).filter(Boolean);
  const who =
    named.length > 1
      ? `Each of ${named.join(" and ")} wears the exact outfit shown in their own reference image(s) and described in their Appearance line above`
      : `The subject wears the exact outfit shown in the reference image(s) and described in the Appearance line above`;
  return (
    `WARDROBE CONTINUITY — CRITICAL: this is one page of a single continuous story, ` +
    `and every subject must wear the IDENTICAL outfit on every page. ${who} — same garments, ` +
    `same colours, same patterns, same footwear. Do NOT invent, substitute, recolour, add, or ` +
    `remove any clothing item. The only permitted wardrobe change is one the Scene text explicitly ` +
    `states (e.g. putting on a helmet).\n\n`
  );
}

// Shirt-colour lock (2026-07-01). The wardrobe-lock points at "the outfit
// described in the Appearance line", but at N>=2 the model still swaps/recolours
// tops between pages (the fishing-book drift: Pheonix's shirt flipped green<->
// maroon page to page). This extracts each subject's explicit shirt colour from
// their Appearance prose (which pins "<colour> t-shirt") and restates all of
// them together as a hard per-subject colour lock, so the model can neither
// recolour nor SWAP shirts between the children. Only meaningful for multi-
// subject pages (needs >=2 named colours). Env-gated SHIRT_COLOUR_LOCK=off.
function buildShirtColourLock(subjects) {
  if (process.env.SHIRT_COLOUR_LOCK === "off") return "";
  const pieces = [];
  for (const s of subjects) {
    const m = (s.description || "").match(/([a-z]+(?:-[a-z]+)?)\s+t-shirt/i);
    if (m && s.name) pieces.push(`${s.name}'s t-shirt is ${m[1].toLowerCase()}`);
  }
  if (pieces.length < 2) return ""; // single-colour case is already covered by the wardrobe lock
  return (
    `SHIRT COLOUR LOCK — CRITICAL: ${pieces.join("; ")}. Keep each child's shirt colour EXACTLY ` +
    `as stated; never recolour a shirt and never swap shirt colours between the children.\n\n`
  );
}

// Reference-authority directive (2026-07-01). Root cause of the fishing-book
// "different people": the Appearance TEXT carried adjectives that conflicted with
// the reference sheet (e.g. "tousled" hair vs the sheet's blunt fringe; "lean"
// vs a sturdy build; "mischievous/cheeky" pulling a freckled-ginger archetype),
// and with no photo at page-render time the model followed the WORDS over the
// image. This makes the image authoritative for identity so a stray adjective
// can't override the real face. Env-gated REF_AUTHORITY=off.
function buildReferenceAuthorityDirective(subjects) {
  if (process.env.REF_AUTHORITY === "off") return "";
  if (subjects.length < 1) return "";
  return (
    `REFERENCE IS AUTHORITATIVE: the provided reference images are the exact, definitive source ` +
    `for each character's face, hairstyle, hair colour, skin tone, and body build. Reproduce the ` +
    `faces and hair EXACTLY as in the references. If any word in the Appearance text seems to ` +
    `conflict with a reference image, FOLLOW THE IMAGE. Do not substitute a generic or stereotyped ` +
    `child; each face must be individually recognisable as the specific child in their reference.\n\n`
  );
}

// Crowd-framing directive (2026-07-01). The dominant likeness failure at N>=3 is
// FACE COLLAPSE: in a wide full-body group long-shot each face is only a few
// dozen pixels, too little detail to carry a real likeness, so the model
// substitutes a generic child's face (the fishing-book "different people on
// page 12"). Bigger faces = more detail = recognisable. Pushes 2+ subject
// scenes CLOSER so faces are large. Env-gated CROWD_FRAMING=off.
function buildCrowdFramingDirective(subjects) {
  if (process.env.CROWD_FRAMING === "off") return "";
  if (subjects.length < 2) return ""; // 2026-07-01: extended to N>=2 — face collapse hit a 2-char page too
  return (
    `GROUP FRAMING — IMPORTANT: frame these ${subjects.length} characters CLOSE and LARGE in the ` +
    `image (roughly waist-up, filling most of the frame height), so EACH face is big, clearly ` +
    `detailed, and individually recognisable from their reference images. Do NOT render them small ` +
    `or distant in a wide full-body long-shot — small faces lose their likeness. Keep all ` +
    `${subjects.length} faces clearly visible and turned enough to read.\n\n`
  );
}

// Bike-colour lock (Spec D-B, 2026-06-08). The bike is an action-prose prop with
// no Appearance line and no reference sheet, so the wardrobe-lock can't reach it.
// Story-gen already states the colour ("red bike"), but only on pages whose
// action prose names it — pages that omit it (e.g. a "riding, arms wide" beat)
// let the model re-decide the colour. `bikeColour` is derived once per book from
// the prose (see extractBikeColour in book-pipeline.js) and restated here, with
// CONDITIONAL phrasing so it never hallucinates a bike onto a bike-less page.
// Env-gated BIKE_COLOUR_LOCK=off. Returns directive + paragraph break, or "".
function buildBikeLock(bikeColour) {
  if (!bikeColour || process.env.BIKE_COLOUR_LOCK === "off") return "";
  return (
    `PROP CONTINUITY: any bicycle that appears in this scene is ${bikeColour} — the same single ` +
    `${bikeColour} bicycle throughout the whole book. Do NOT recolour it or draw a differently ` +
    `coloured bike. (If no bicycle appears in this scene, ignore this.)\n\n`
  );
}

// Helmet-colour lock (Spec D-H, 2026-06-08). Same prop-lock shape as buildBikeLock.
// The helmet colour is NOT extracted from prose (the prose has no consensus helmet
// colour — it renders blue/grey/purple/rainbow/red across books); it is sourced from
// the already-locked bike colour (helmet = bike colour) by the caller. This is a
// COLOUR lock only — conditional phrasing so it never forces a helmet onto a
// helmet-less page (presence is governed by the scene, not this directive).
// Env-gated HELMET_COLOUR_LOCK=off. Returns directive + paragraph break, or "".
function buildHelmetLock(helmetColour) {
  if (!helmetColour || process.env.HELMET_COLOUR_LOCK === "off") return "";
  return (
    `PROP CONTINUITY: any safety helmet that appears in this scene is ${helmetColour} — the same ` +
    `single ${helmetColour} helmet throughout the whole book. Do NOT recolour it, give it a ` +
    `different pattern, or make it multicoloured. (If no helmet appears in this scene, ignore this.)\n\n`
  );
}

// Operator revision note (review station, 2026-07-02). A per-page free-text
// directive an operator types in the review station when re-rolling a bad page
// ("make the faces crisper", "she should hold a rod not a line", ...). Threaded
// generate-book.js --only-pages → generateBook(pageDirectives) →
// renderPageWithTemplate(reviewNote) → here. Appended LAST so it is the most
// recent instruction the model reads and is clearly framed as page-scoped
// operator feedback. Empty/absent → "" → byte-for-byte the pre-feature prompt.
function buildReviewNoteDirective(reviewNote) {
  if (!reviewNote || !reviewNote.trim()) return "";
  return `\n\nREVISION NOTE FOR THIS PAGE (operator feedback — apply it to this render): ${reviewNote.trim()}`;
}

export function buildScenePrompt({
  subjects,
  scene,
  styleLine,
  compositionLine,
  templateComposition,
  negativePrompt,
  bikeColour = null,
  helmetColour = null,
  reviewNote = "",
}) {
  if (!Array.isArray(subjects) || subjects.length === 0) {
    throw new Error("buildScenePrompt: subjects must be a non-empty array");
  }

  // ---- N=1: single-subject prompt. ---------------------------------------
  // The bare templateComposition is sent unchanged — V2 is N>1-only (gated
  // 2026-06-01 per Item 7 audit: no canvas-seam failure mode to defend
  // against at N=1, and the plural framing risked suppressing legitimate
  // single-subject compositional space).
  // The "name" field on the single subject is intentionally NOT inserted
  // into the prompt (legacy used anonymous "a <age>-year-old child" to
  // discourage Gemini from rendering the name as image text).
  if (subjects.length === 1) {
    const s = subjects[0];
    return [
      `Subject: a ${s.age}-year-old child.`,
      `Appearance: ${s.description}.`,
      `Style: ${styleLine}.`,
      `Composition: ${compositionLine}`,
      `Template composition: ${templateComposition}`,
      `Avoid: ${negativePrompt}.`,
    ].join("\n")
      + `\n\nScene: ${scene.action}\n\n${buildReferenceAuthorityDirective(subjects)}${buildWardrobeLock(subjects)}${buildBikeLock(bikeColour)}${buildHelmetLock(helmetColour)}Use the provided reference images of the character to keep their appearance, clothing, and proportions consistent.`
      + buildReviewNoteDirective(reviewNote);
  }

  // ---- N>1: V2 canvas-seam defense is load-bearing here. -----------------
  const templateCompositionV2 = `${templateComposition} ${COMPOSITION_RULE_V2}`;

  // ---- N>1: multi-subject prompt with References mapping. ----------------
  // Stage B's parallel-emphasis pattern: each subject gets its own
  // labelled Subject + Appearance block, and the closing References line
  // tells Gemini which reference positions anchor which subject.
  const subjectBlocks = [];
  let refCursor = 1; // 1-based positions for human-readable References line
  const refMappingPieces = [];
  for (let i = 0; i < subjects.length; i++) {
    const s = subjects[i];
    const label = s.subjectType === "non_human"
      ? `${s.name}, a handmade non-human subject`
      : `a ${s.age}-year-old child named ${s.name}`;
    subjectBlocks.push(`Subject ${i + 1}: ${label}.`);
    subjectBlocks.push(`Appearance of ${s.name}: ${s.description}.`);
    const startIdx = refCursor;
    const endIdx = refCursor + s.sheetCount - 1;
    refMappingPieces.push(
      startIdx === endIdx
        ? `ref ${startIdx} is ${s.name}`
        : `refs ${startIdx}-${endIdx} are ${s.name}`,
    );
    refCursor = endIdx + 1;
  }

  return [
    `Subjects: ${subjects.length}.`,
    ...subjectBlocks,
    `Style: ${styleLine}.`,
    `Composition: ${compositionLine}`,
    `Template composition: ${templateCompositionV2}`,
    `Avoid: ${negativePrompt}.`,
  ].join("\n")
    + `\n\nScene: ${scene.action}\n\n${buildReferenceAuthorityDirective(subjects)}${buildCrowdFramingDirective(subjects)}${buildWardrobeLock(subjects)}${buildShirtColourLock(subjects)}${buildBikeLock(bikeColour)}${buildHelmetLock(helmetColour)}Use the provided reference images of the subjects to keep each one's appearance, clothing, and proportions consistent. References: ${refMappingPieces.join(", ")}.`
    + buildReviewNoteDirective(reviewNote);
}

/**
 * Render a single page through the full Stage-2 pipeline.
 *
 * @param {object} opts
 * @param {string} opts.templateConfigPath   absolute path to a template config.json
 * @param {object} opts.scene                { page: number, action: string }
 * @param {string} opts.narrativeText        the page's narrative
 * @param {Array<{
 *   name: string, age: number, description: string,
 *   subjectType: string, sheets: Buffer[]
 * }>} [opts.subjects]
 *   The subjects to anchor this page (Step 3 multi-character build). Order
 *   matters — element [0] is the anchor (protagonist for multi-character
 *   books). The wiring layer (scripts/generate-book.js) builds this array
 *   per-scene from scene.subjects_present + the allocator's view counts.
 *   `sheets` is the ACTUAL slice for this call (already capped to the
 *   allocated view count); they are concatenated in order to form the
 *   refs[] passed to generateImage. Required if imagePathOverride is not set.
 * @param {string}   [opts.sceneStyle]            required if imagePathOverride not set
 * @param {string}   [opts.sceneNegativePrompt]   required if imagePathOverride not set
 * @param {string}   opts.outputDir               directory where PNG + PDF land
 * @param {string|null} [opts.imagePathOverride=null] skip Gemini, use this image
 * @returns {Promise<{
 *   success: boolean,
 *   pdfPath: string | null,
 *   imagePath: string | null,
 *   diagnostics: object,
 *   error: string | null,
 * }>}
 */
export async function renderPageWithTemplate({
  templateConfigPath,
  scene,
  narrativeText,
  subjects,
  sceneStyle,
  sceneNegativePrompt,
  outputDir,
  imagePathOverride = null,
  callContext = null,
  bikeColour = null,        // Spec D-B: canonical bike colour for this book, or null
  helmetColour = null,      // Spec D-H: helmet colour (= bike colour), or null
  reviewNote = "",          // Review station: per-page operator directive, or "" (inert)
  styleMedium = null,       // W-E: per-style MEDIUM-token fills, or null (→ watercolour default)
}) {
  const timing = {
    imageGenMs: 0,
    regionDetectMs: 0,
    autoFitMs: 0,
    renderMs: 0,
    totalMs: 0,
  };
  const tStart = Date.now();
  let cost = 0;
  let detection = null;
  let fit = null;
  let pagePtConversion = null;
  let dynamicCssOut = null;
  let imagePath = null;

  try {
    if (!fs.existsSync(templateConfigPath)) {
      throw new Error(`template config not found: ${templateConfigPath}`);
    }
    const config = JSON.parse(fs.readFileSync(templateConfigPath, "utf8"));
    const configDir = path.dirname(templateConfigPath);
    const templateHtmlPath = path.join(configDir, config.rendering.templateHtmlPath);

    // Three template modes:
    //   Type A: detection ON  + autoFit ON  — detect cream region, auto-fit into it
    //   Type B: detection OFF + autoFit OFF — static template CSS, fixed fontSize
    //   Type C: detection OFF + autoFit ON  — fixed config.textRegion box, auto-fit into it
    // Invalid: detection ON + autoFit OFF (a detected region with no auto-fit
    // to size text into it is meaningless).
    const detectionEnabled = config.regionDetection !== null && config.regionDetection !== undefined;
    const autoFitEnabled = config.autoFit !== null && config.autoFit !== undefined;
    if (detectionEnabled && !autoFitEnabled) {
      throw new Error(
        `Config error: regionDetection is set but autoFit is null. A detected ` +
        `region needs auto-fit to size text into it. Set autoFit (Type A), null ` +
        `both (Type B), or use autoFit + textRegion without regionDetection (Type C).`
      );
    }

    fs.mkdirSync(outputDir, { recursive: true });
    const pageNumStr = String(scene.page).padStart(2, "0");

    // Typography markup ([[em:]]/[[sfx:]]/[[line:]]) is invisible to layout:
    // measure + auto-fit must size the VISIBLE characters, not the bracket
    // tokens (text-measurement escapes+measures the literal string). Strip to
    // plain for every measure/fit; the marked-up original is rendered later.
    const plainNarrative = stripNarrativeMarkup(narrativeText);

    // ---- 1. Image: generate via Gemini, or use override -----------------
    if (imagePathOverride) {
      imagePath = imagePathOverride;
      if (!fs.existsSync(imagePath)) {
        throw new Error(`imagePathOverride not found: ${imagePath}`);
      }
    } else {
      if (!Array.isArray(subjects) || subjects.length === 0) {
        throw new Error("subjects[] required (non-empty) when imagePathOverride is not set");
      }
      for (let i = 0; i < subjects.length; i++) {
        const s = subjects[i];
        if (!s || typeof s.age !== "number") {
          throw new Error(`subjects[${i}] missing 'age'`);
        }
        if (typeof s.description !== "string") {
          throw new Error(`subjects[${i}] missing 'description'`);
        }
        if (!Array.isArray(s.sheets) || s.sheets.length === 0) {
          throw new Error(`subjects[${i}] (${s.name ?? "unnamed"}) has no sheets`);
        }
        if (subjects.length > 1 && (typeof s.name !== "string" || !s.name)) {
          throw new Error(`subjects[${i}] missing 'name' (required for multi-subject pages)`);
        }
      }

      // Build the Template-composition prompt text.
      // Type A (region detection + auto-fit): run a baseline measureText
      // to derive cream-zone dims and substitute placeholders ({{LINES}},
      // {{CREAM_*}}) in the template.
      // Type B (static template CSS): no placeholders in the template;
      // use it verbatim. Skipping the baseline measure also avoids
      // requiring maxFontSize / paddingVerticalIn / paddingHorizontalIn
      // in Type B configs.
      let templateComposition;
      if (detectionEnabled) {
        const pageWidthIn = parseInchesValue(config.rendering.pageSize.width);
        const pageHeightIn = parseInchesValue(config.rendering.pageSize.height);

        const baselineMeasure = await measureText({
          text: plainNarrative,
          fontFamily: config.typography.fontFamily,
          fontSize: config.typography.maxFontSize,
          lineHeight: config.typography.lineHeight,
          maxWidth: "70%",
          pageWidth: config.rendering.pageSize.width,
          pageHeight: config.rendering.pageSize.height,
          letterSpacing: config.typography.letterSpacing,
          fontVariantNumeric: config.typography.fontVariantNumeric,
        });

        const creamWidthIn = (baselineMeasure.actualMaxWidthPt / 72) + config.imageGeneration.paddingHorizontalIn;
        const creamHeightIn = baselineMeasure.heightIn + config.imageGeneration.paddingVerticalIn;
        const creamWidthPct = (creamWidthIn / pageWidthIn) * 100;
        const creamHeightPct = (creamHeightIn / pageHeightIn) * 100;

        templateComposition = config.imageGeneration.compositionPromptTemplate
          .replace(/\{\{LINES\}\}/g, String(baselineMeasure.lines))
          .replace(/\{\{CREAM_HEIGHT_PCT\}\}/g, creamHeightPct.toFixed(2))
          .replace(/\{\{CREAM_WIDTH_PCT\}\}/g, creamWidthPct.toFixed(2))
          .replace(/\{\{CREAM_HEIGHT_IN\}\}/g, creamHeightIn.toFixed(2))
          .replace(/\{\{CREAM_WIDTH_IN\}\}/g, creamWidthIn.toFixed(2));
      } else {
        // Type B: compositionPromptTemplate has no placeholders, use verbatim
        templateComposition = config.imageGeneration.compositionPromptTemplate;
      }

      // W-E: fill the template composition's {{MEDIUM:key}} tokens with the chosen
      // style's medium vocabulary. Absent styleMedium → per-key watercolour default,
      // so watercolour is byte-identical to pre-W-E (guarded by test-medium-tokens.js).
      templateComposition = fillMediumTokens(templateComposition, styleMedium);

      const styleLine = config.imageGeneration.styleOverride || sceneStyle;
      const compositionLine = config.imageGeneration.customCompositionRules
        || "full body, centered subject, clean uncluttered background, consistent framing, face clearly visible.";

      // Adapt each subject for the prompt builder: sheetCount = actual
      // reference count this call sends for that subject (already capped
      // by the allocator before they reached us).
      const promptSubjects = subjects.map((s) => ({
        name: s.name,
        age: s.age,
        description: s.description,
        subjectType: s.subjectType,
        sheetCount: s.sheets.length,
      }));
      const fullPrompt = buildScenePrompt({
        subjects: promptSubjects,
        scene,
        styleLine,
        compositionLine,
        templateComposition,
        negativePrompt: sceneNegativePrompt,
        bikeColour,
        helmetColour,
        reviewNote,
      });

      // Reference images: concatenate each subject's allocated sheets in
      // subject order. Subject ordering is the caller's responsibility;
      // the References line in the prompt assumes the same order.
      const referenceImages = [];
      for (const s of subjects) {
        for (const sheet of s.sheets) referenceImages.push(sheet);
      }

      const tImgStart = Date.now();
      const buf = await generateImage(
        fullPrompt,
        referenceImages,
        { aspectRatio: config.imageGeneration?.aspectRatio },
        callContext ?? {},
      );
      timing.imageGenMs = Date.now() - tImgStart;
      cost += GEMINI_IMAGE_USD_PER_CALL;

      imagePath = path.join(outputDir, `page-${pageNumStr}.png`);
      fs.writeFileSync(imagePath, buf);
    }

    // Default fontSize for Type B (static template CSS). Auto-fit overrides
    // this for Type A inside the conditional below.
    let fontSize = config.typography.fontSize;

    if (detectionEnabled) {
      // ---- 2. Detect clean region (source-pixel coords) -----------------
      const tDetectStart = Date.now();
      detection = await detectCleanRegion({
        imagePath,
        roi: config.regionDetection.roi,
        creamTarget: config.regionDetection.creamTarget,
        creamDistance: config.regionDetection.creamDistance,
        minSizePx: config.regionDetection.minSizePx,
      });
      timing.regionDetectMs = Date.now() - tDetectStart;

      if (detection.warnings.some((w) => w.includes("failed minSizePx"))) {
        return {
          success: false,
          pdfPath: null,
          imagePath,
          diagnostics: {
            regionDetection: detection,
            pagePtConversion: null,
            autoFit: null,
            dynamicCss: null,
            fontSize,
            cost,
            timing: finalizeTiming(timing, tStart),
          },
          error: "detected region too small (failed minSizePx)",
        };
      }

      // ---- 3. Convert pixel coords → page-point coords -----------------
      const imgMeta = await sharp(imagePath).metadata();
      const converted = srcToPagePt(detection.region, imgMeta, config.rendering.pageSize);
      pagePtConversion = {
        sourceImageDimensions: { width: imgMeta.width, height: imgMeta.height },
        regionSourcePx: { ...detection.region },
        regionPagePt: converted.region,
        conversion: converted.conversion,
      };

      // ---- 4. Auto-fit text to page-pt region --------------------------
      const tFitStart = Date.now();
      fit = await fitTextToRegion({
        text: plainNarrative,
        region: { width: converted.region.width, height: converted.region.height },
        fontFamily: config.typography.fontFamily,
        lineHeight: config.typography.lineHeight,
        maxFontSize: config.typography.maxFontSize,
        minFontSize: config.typography.minFontSize,
        letterSpacing: config.typography.letterSpacing,
        fontVariantNumeric: config.typography.fontVariantNumeric,
      });
      timing.autoFitMs = Date.now() - tFitStart;

      if (!fit.fits) {
        return {
          success: false,
          pdfPath: null,
          imagePath,
          diagnostics: {
            regionDetection: detection,
            pagePtConversion,
            autoFit: extractFitDiagnostics(fit),
            dynamicCss: null,
            fontSize,
            cost,
            timing: finalizeTiming(timing, tStart),
          },
          error: "no readable font size fits detected region",
        };
      }
      fontSize = fit.fontSize;

      // ---- 5a. Build dynamic CSS for the text layer --------------------
      dynamicCssOut = buildDynamicCss({
        region: converted.region,
        fontSize,
        color: config.typography.color,
      });
    } else if (autoFitEnabled) {
      // ---- Type C: fixed text region from config + auto-fit -----------
      // No region detection. The text region is a fixed box declared in
      // config.textRegion (fractional page coords). Auto-fit sizes the
      // narrative into that fixed box. The region is page-native — no
      // source-pixel → page-pt conversion needed.
      if (!config.textRegion) {
        throw new Error(
          "Type C template (autoFit set, regionDetection null) requires " +
          "config.textRegion { x, y, width, height } in fractional page coords."
        );
      }
      const tr = config.textRegion;
      const pageWpt = inchesToPoints(parseInchesValue(config.rendering.pageSize.width));
      const pageHpt = inchesToPoints(parseInchesValue(config.rendering.pageSize.height));
      const fixedRegion = {
        x: tr.x * pageWpt,
        y: tr.y * pageHpt,
        width: tr.width * pageWpt,
        height: tr.height * pageHpt,
      };

      const tFitStart = Date.now();
      fit = await fitTextToRegion({
        text: plainNarrative,
        region: { width: fixedRegion.width, height: fixedRegion.height },
        fontFamily: config.typography.fontFamily,
        lineHeight: config.typography.lineHeight,
        maxFontSize: config.typography.maxFontSize,
        minFontSize: config.typography.minFontSize,
        letterSpacing: config.typography.letterSpacing,
        fontVariantNumeric: config.typography.fontVariantNumeric,
      });
      timing.autoFitMs = Date.now() - tFitStart;

      if (!fit.fits) {
        return {
          success: false,
          pdfPath: null,
          imagePath,
          diagnostics: {
            regionDetection: null,
            pagePtConversion: null,
            autoFit: extractFitDiagnostics(fit),
            dynamicCss: null,
            fontSize,
            cost,
            timing: finalizeTiming(timing, tStart),
          },
          error: "no readable font size fits fixed text region",
        };
      }
      fontSize = fit.fontSize;

      dynamicCssOut = buildDynamicCss({
        region: fixedRegion,
        fontSize,
        color: config.typography.color,
      });
    }
    // (Type B: detection / pagePtConversion / fit / dynamicCssOut all stay
    // null; fontSize stays at config.typography.fontSize; render uses the
    // template's static CSS only.)

    // ---- 5b. Render PDF (dynamic CSS injection only for Type A) -------
    const tRenderStart = Date.now();
    const pdfPath = path.join(outputDir, `page-${pageNumStr}.pdf`);
    const { renderedPngPath } = await renderPdfWithDynamicCss({
      templateHtmlPath,
      imagePath,
      narrativeText,
      pageSize: config.rendering.pageSize,
      dynamicCss: dynamicCssOut,
      outputPath: pdfPath,
      page: scene.page,
    });
    timing.renderMs = Date.now() - tRenderStart;
    timing.totalMs = Date.now() - tStart;

    return {
      success: true,
      pdfPath,
      imagePath,
      renderedPngPath,
      diagnostics: {
        regionDetection: detection,
        pagePtConversion,
        autoFit: extractFitDiagnostics(fit),
        dynamicCss: dynamicCssOut,
        fontSize,
        cost,
        timing,
      },
      error: null,
    };
  } catch (err) {
    // Item 5 D2: preserve the full structured error (WallCeilingError,
    // RetryExhaustionError with retry_history, etc.) alongside the existing
    // message string. Callers that read `.error` as a string keep working;
    // callers that want the structured payload read `.structuredError`.
    const structuredError =
      typeof err?.toJSON === "function" ? err.toJSON()
      : (err?.retry_history != null
        ? { kind: "retry_exhausted", message: String(err?.message ?? err).slice(0, 300), status: err?.status ?? null, retry_history: err.retry_history }
        : null);
    return {
      success: false,
      pdfPath: null,
      imagePath,
      diagnostics: {
        regionDetection: detection,
        pagePtConversion,
        autoFit: extractFitDiagnostics(fit),
        dynamicCss: dynamicCssOut,
        cost,
        timing: finalizeTiming(timing, tStart),
      },
      error: err?.message ?? String(err),
      structuredError,
    };
  }
}
