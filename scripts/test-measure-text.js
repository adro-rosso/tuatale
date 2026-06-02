// scripts/test-measure-text.js
// Validation suite for src/text-measurement.js. Three tests:
//   1. Sanity: single 'X' at 12pt → expect heightPt in [11, 13]. FAIL-ASSERT.
//   2. Mateo p9 in prompt-2-iter-2 typography. Log + render validation PDF.
//   3. Sage p10 in prompt-3-iter-2 typography. Log + render validation PDF.
// Test 4 (round-trip visual confirmation) is the user opening the validation
// PDFs from tests 2/3 and confirming the predicted red dashed line aligns
// with the actual rendered text bottom.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer";
import { measureText } from "../src/text-measurement.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, "..");
const VALIDATION_DIR = path.join(PROJECT_ROOT, "output", "measurement-validation");

function displayPath(p) {
  return path.relative(PROJECT_ROOT, p).replace(/\\/g, "/");
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Render the measured text into a real PDF, with a red dashed line drawn at
// the predicted bottom of the text block. User visually confirms alignment.
// Uses identical CSS to measureText() — same page-context wrapper, same
// styles — plus a 0.5in offset (so text doesn't hug edges) and the marker.
async function renderValidationPdf({
  outputPath,
  text,
  fontFamily,
  fontSize,
  lineHeight,
  maxWidth,
  letterSpacing,
  fontWeight,
  fontVariantNumeric,
  predictedHeightPt,
}) {
  const styleRules = [
    `width: ${maxWidth}`,
    `font-family: '${fontFamily}', serif`,
    `font-size: ${fontSize}pt`,
    `line-height: ${lineHeight}`,
    `font-weight: ${fontWeight}`,
  ];
  if (letterSpacing)       styleRules.push(`letter-spacing: ${letterSpacing}`);
  if (fontVariantNumeric)  styleRules.push(`font-variant-numeric: ${fontVariantNumeric}`);

  const encodedFamily = fontFamily.replace(/\s+/g, "+");

  // text-origin sits 0.5in from page top-left. The .measure div renders
  // inside it with the measureText CSS. The predicted-marker dashed line
  // is positioned at (0.5in + predictedHeightPt) from page top — the
  // claimed text bottom. If the measurement is correct, the dashed line
  // sits exactly at the visual text bottom; no overlap, no gap.
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=${encodedFamily}:wght@${fontWeight}&display=swap" rel="stylesheet">
<style>
  @page { size: 11in 8.5in; margin: 0; }
  html, body { margin: 0; padding: 0; background: #fff; }
  .page-context {
    width: 11in;
    height: 8.5in;
    position: relative;
  }
  .measure {
    /* Position .measure directly (no wrapper) so its containing block for
       percentage width is .page-context — matching how production templates
       resolve width:32%/etc. against the page, and matching measureText's
       containing block. A wrapper with width:auto would shrink-to-fit and
       resolve % widths against a smaller basis (see diagnose-measure-text). */
    position: absolute;
    top: 0.5in;
    left: 0.5in;
    ${styleRules.map(r => r + ";").join("\n    ")}
  }
  .predicted-marker {
    position: absolute;
    top: calc(0.5in + ${predictedHeightPt.toFixed(3)}pt);
    left: 0.5in;
    width: calc(11in - 1in);
    border-top: 0.5pt dashed red;
    color: red;
    font: 9pt 'Courier New', monospace;
    text-align: right;
    padding-top: 2pt;
  }
</style>
</head>
<body>
  <div class="page-context">
    <div class="measure">${escapeHtml(text)}</div>
    <div class="predicted-marker">↑ predicted text-bottom: ${predictedHeightPt.toFixed(1)}pt below origin</div>
  </div>
</body>
</html>`;

  let browser;
  try {
    browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0" });
    await page.evaluate(() => document.fonts.ready);
    await page.pdf({
      path: outputPath,
      width: "11in",
      height: "8.5in",
      printBackground: true,
      margin: { top: 0, right: 0, bottom: 0, left: 0 },
      preferCSSPageSize: false,
    });
    await browser.close();
  } catch (err) {
    if (browser) { try { await browser.close(); } catch {} }
    throw err;
  }
}

// =====================================================================

console.log();
console.log("=".repeat(70));
console.log("Text-measurement primitive — validation suite");
console.log("=".repeat(70));

// ---- Test 1: sanity --------------------------------------------------
console.log();
console.log("Test 1 — Sanity: single 'X' at Arial 12pt, lh 1.0, 10in width");
console.log("  Expected: lines=1, heightPt in [11, 13]");

const t1 = await measureText({
  text: "X",
  fontFamily: "Arial",
  fontSize: 12,
  lineHeight: 1.0,
  maxWidth: "10in",
});

console.log(`  Result:   lines=${t1.lines} (range:${t1.linesByRange}) heightPt=${t1.heightPt.toFixed(2)} heightIn=${t1.heightIn.toFixed(4)} widthPt=${t1.widthPt.toFixed(2)} actualMaxWidthPt=${t1.actualMaxWidthPt.toFixed(2)}`);

let t1Pass = true;
if (t1.lines !== 1) {
  console.error(`  FAIL: expected lines=1, got ${t1.lines}`);
  t1Pass = false;
}
if (t1.heightPt < 11 || t1.heightPt > 13) {
  console.error(`  FAIL: expected heightPt in [11, 13], got ${t1.heightPt.toFixed(2)}`);
  t1Pass = false;
}
if (!t1Pass) {
  console.error("Test 1 failed — conversion math is wrong or browser layout differs from expectation.");
  console.error("Halting before Tests 2/3 (downstream measurements would be meaningless).");
  process.exit(1);
}
console.log("  PASS");

// ---- Test 2: Mateo p9 + prompt-2-iter-2 typography --------------------
const mateoP9Path = path.join(PROJECT_ROOT, "output", "books", "2026-05-17-mateo-0002", "pages", "page-09.txt");
if (!fs.existsSync(mateoP9Path)) {
  console.error(`FAIL: Test 2 source missing: ${displayPath(mateoP9Path)}`);
  process.exit(1);
}
const mateoP9Text = fs.readFileSync(mateoP9Path, "utf8").trim();

console.log();
console.log("Test 2 — Mateo p9 in prompt-2-iter-2 typography");
console.log(`  Source:     ${displayPath(mateoP9Path)} (${mateoP9Text.length} chars)`);
console.log("  Typography: EB Garamond 18pt, lh 1.7, width 32% of 11in (=3.52in)");
console.log("  Sanity:     lines ~15-17, heightPt ~460-520 (informational, not asserted)");

const t2 = await measureText({
  text: mateoP9Text,
  fontFamily: "EB Garamond",
  fontSize: 18,
  lineHeight: 1.7,
  maxWidth: "32%",
  pageWidth: "11in",
  letterSpacing: "0.005em",
  fontVariantNumeric: "oldstyle-nums",
});

console.log(`  Result:     lines=${t2.lines} (range:${t2.linesByRange}) heightPt=${t2.heightPt.toFixed(2)} heightIn=${t2.heightIn.toFixed(4)} widthPt=${t2.widthPt.toFixed(2)} actualMaxWidthPt=${t2.actualMaxWidthPt.toFixed(2)}`);

fs.mkdirSync(VALIDATION_DIR, { recursive: true });
const t2pdf = path.join(VALIDATION_DIR, "test2-mateo-p9-em-garamond.pdf");
await renderValidationPdf({
  outputPath: t2pdf,
  text: mateoP9Text,
  fontFamily: "EB Garamond",
  fontSize: 18,
  lineHeight: 1.7,
  maxWidth: "32%",
  letterSpacing: "0.005em",
  fontWeight: 400,
  fontVariantNumeric: "oldstyle-nums",
  predictedHeightPt: t2.heightPt,
});
console.log(`  Validation: ${displayPath(t2pdf)}`);

// ---- Test 3: Sage p10 + prompt-3-iter-2 typography --------------------
const sageP10Path = path.join(PROJECT_ROOT, "output", "books", "2026-05-17-sage-0036", "pages", "page-10.txt");
if (!fs.existsSync(sageP10Path)) {
  console.error(`FAIL: Test 3 source missing: ${displayPath(sageP10Path)}`);
  process.exit(1);
}
const sageP10Text = fs.readFileSync(sageP10Path, "utf8").trim();

console.log();
console.log("Test 3 — Sage p10 in prompt-3-iter-2 typography");
console.log(`  Source:     ${displayPath(sageP10Path)} (${sageP10Text.length} chars)`);
console.log("  Typography: Architects Daughter 16pt, lh 1.6, width 70% of 11in (=7.7in)");
console.log("  Sanity:     lines ~7-9, heightPt ~180-230 (informational, not asserted)");

const t3 = await measureText({
  text: sageP10Text,
  fontFamily: "Architects Daughter",
  fontSize: 16,
  lineHeight: 1.6,
  maxWidth: "70%",
  pageWidth: "11in",
  letterSpacing: "0.01em",
});

console.log(`  Result:     lines=${t3.lines} (range:${t3.linesByRange}) heightPt=${t3.heightPt.toFixed(2)} heightIn=${t3.heightIn.toFixed(4)} widthPt=${t3.widthPt.toFixed(2)} actualMaxWidthPt=${t3.actualMaxWidthPt.toFixed(2)}`);

const t3pdf = path.join(VALIDATION_DIR, "test3-sage-p10-arch-daughter.pdf");
await renderValidationPdf({
  outputPath: t3pdf,
  text: sageP10Text,
  fontFamily: "Architects Daughter",
  fontSize: 16,
  lineHeight: 1.6,
  maxWidth: "70%",
  letterSpacing: "0.01em",
  fontWeight: 400,
  fontVariantNumeric: null,
  predictedHeightPt: t3.heightPt,
});
console.log(`  Validation: ${displayPath(t3pdf)}`);

console.log();
console.log("=".repeat(70));
console.log("Primitive ran without errors. Test 1 passed assertions.");
console.log("Tests 2/3 logged measurements + wrote validation PDFs:");
console.log(`  ${displayPath(t2pdf)}`);
console.log(`  ${displayPath(t3pdf)}`);
console.log("Open each PDF and visually confirm the red dashed line aligns with");
console.log("the actual rendered text bottom. If the line sits above or below the");
console.log("text bottom, surface that — the primitive is mis-calibrated.");
console.log("=".repeat(70));
console.log();
