// scripts/diagnose-measure-text.js
// Diagnostic for the under-prediction bug surfaced 2026-05-19: measureText
// returned 15 lines / 459pt for Mateo p9 (EB Garamond 18/1.7, 32% width),
// but the validation PDF rendered 16 lines. Test 3 (Sage p10, Architects
// Daughter, 70% width) matched prediction — so the bug is conditional.
//
// HYPOTHESIS: the two HTML structures use different containing blocks for
// percentage width resolution:
//   measureText:           .measure inside .page-context directly
//   renderValidationPdf:   .measure inside .text-origin (position:absolute,
//                          width:auto) inside .page-context
// If "width: 32%" resolves against a different ancestor in B than in A,
// the rendered width differs, line-wrapping differs, line count differs.
//
// This diagnostic runs the SAME measurement twice for each test case —
// once with each HTML structure — and logs every internal field that
// could matter, so we can see exactly where the two diverge.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, "..");

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function diagnose(opts) {
  const {
    structure,    // "measure-direct" or "with-text-origin"
    text, fontFamily, fontSize, lineHeight, maxWidth,
    letterSpacing, fontWeight, fontVariantNumeric,
  } = opts;

  const styleRules = [
    `width: ${maxWidth}`,
    `font-family: '${fontFamily}', serif`,
    `font-size: ${fontSize}pt`,
    `line-height: ${lineHeight}`,
    `font-weight: ${fontWeight}`,
  ];
  if (letterSpacing) styleRules.push(`letter-spacing: ${letterSpacing}`);
  if (fontVariantNumeric) styleRules.push(`font-variant-numeric: ${fontVariantNumeric}`);

  let bodyHtml;
  if (structure === "measure-direct") {
    bodyHtml = `<div class="page-context">
    <div class="measure">${escapeHtml(text)}</div>
  </div>`;
  } else {
    bodyHtml = `<div class="page-context">
    <div class="text-origin">
      <div class="measure">${escapeHtml(text)}</div>
    </div>
  </div>`;
  }

  const encoded = fontFamily.replace(/\s+/g, "+");
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=${encoded}:wght@${fontWeight}&display=swap" rel="stylesheet">
<style>
  @page { size: 11in 8.5in; margin: 0; }
  html, body { margin: 0; padding: 0; }
  .page-context { width: 11in; height: 8.5in; position: relative; }
  .text-origin { position: absolute; top: 0.5in; left: 0.5in; }
  .measure { ${styleRules.map(r => r + ";").join(" ")} }
</style>
</head>
<body>${bodyHtml}
</body></html>`;

  let browser;
  try {
    browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0" });
    await page.evaluate(() => document.fonts.ready);
    return await page.evaluate(() => {
      const el = document.querySelector(".measure");
      const ctx = document.querySelector(".page-context");
      const origin = document.querySelector(".text-origin");
      const rect = el.getBoundingClientRect();
      const ctxRect = ctx.getBoundingClientRect();
      const originRect = origin ? origin.getBoundingClientRect() : null;
      const style = getComputedStyle(el);

      const fontSizePx = parseFloat(style.fontSize);
      const lhRaw = style.lineHeight;
      let lineHeightPx;
      if (lhRaw === "normal") lineHeightPx = fontSizePx * 1.2;
      else if (lhRaw.endsWith("px")) lineHeightPx = parseFloat(lhRaw);
      else lineHeightPx = fontSizePx * parseFloat(lhRaw);

      const range = document.createRange();
      range.selectNodeContents(el);
      const rangeRects = Array.from(range.getClientRects());
      const rangeBoundingRect = range.getBoundingClientRect();

      // Compute "lines" by counting distinct tops (rounded to 0.5px tolerance)
      const tops = new Set();
      rangeRects.forEach(r => tops.add(Math.round(r.top * 2) / 2));

      const tc = el.textContent;
      const lastChars = tc.slice(-15);
      const lastCps = Array.from(lastChars).map(c => c.charCodeAt(0));
      const firstChars = tc.slice(0, 15);
      const firstCps = Array.from(firstChars).map(c => c.charCodeAt(0));

      return {
        elRect: {
          x: rect.x, y: rect.y, width: rect.width, height: rect.height,
          top: rect.top, bottom: rect.bottom,
        },
        ctxRect: { width: ctxRect.width, height: ctxRect.height },
        originRect: originRect ? {
          x: originRect.x, y: originRect.y,
          width: originRect.width, height: originRect.height,
        } : null,
        computedFontSize: style.fontSize,
        computedLineHeight: style.lineHeight,
        computedWidth: style.width,
        computedFontFamily: style.fontFamily,
        fontSizePx,
        lineHeightPx,
        rawLinesByHeight: rect.height / lineHeightPx,
        roundedLinesByHeight: Math.round(rect.height / lineHeightPx),
        rangeRectsCount: rangeRects.length,
        uniqueTopsCount: tops.size,
        uniqueTops: Array.from(tops).sort((a, b) => a - b),
        rangeBoundingRect: {
          width: rangeBoundingRect.width, height: rangeBoundingRect.height,
          top: rangeBoundingRect.top, bottom: rangeBoundingRect.bottom,
        },
        textLength: tc.length,
        firstChars: { text: firstChars, codepoints: firstCps },
        lastChars: { text: lastChars, codepoints: lastCps },
      };
    });
  } finally {
    if (browser) try { await browser.close(); } catch {}
  }
}

// ---- Inputs ---------------------------------------------------------------
const mateoP9 = fs.readFileSync(
  path.join(PROJECT_ROOT, "output/books/2026-05-17-mateo-0002/pages/page-09.txt"),
  "utf8"
).trim();
const sageP10 = fs.readFileSync(
  path.join(PROJECT_ROOT, "output/books/2026-05-17-sage-0036/pages/page-10.txt"),
  "utf8"
).trim();

const cases = [
  {
    name: "Mateo p9 (EB Garamond 18/1.7, 32%)",
    opts: {
      text: mateoP9, fontFamily: "EB Garamond", fontSize: 18, lineHeight: 1.7,
      maxWidth: "32%", letterSpacing: "0.005em", fontWeight: 400,
      fontVariantNumeric: "oldstyle-nums",
    },
  },
  {
    name: "Sage p10 (Architects Daughter 16/1.6, 70%)",
    opts: {
      text: sageP10, fontFamily: "Architects Daughter", fontSize: 16, lineHeight: 1.6,
      maxWidth: "70%", letterSpacing: "0.01em", fontWeight: 400,
      fontVariantNumeric: null,
    },
  },
];

console.log();
console.log("=".repeat(72));
console.log("Diagnostic: measureText (A) vs renderValidationPdf (B) HTML structures");
console.log("=".repeat(72));

for (const c of cases) {
  console.log();
  console.log(`---- ${c.name} ----`);

  const a = await diagnose({ ...c.opts, structure: "measure-direct" });
  const b = await diagnose({ ...c.opts, structure: "with-text-origin" });

  for (const [label, r] of [["A (measureText)", a], ["B (renderValidationPdf)", b]]) {
    console.log();
    console.log(`  Structure ${label}:`);
    console.log(`    .page-context: w=${r.ctxRect.width.toFixed(2)} h=${r.ctxRect.height.toFixed(2)}`);
    if (r.originRect) {
      console.log(`    .text-origin:  x=${r.originRect.x.toFixed(2)} y=${r.originRect.y.toFixed(2)} w=${r.originRect.width.toFixed(2)} h=${r.originRect.height.toFixed(2)}`);
    }
    console.log(`    .measure rect: x=${r.elRect.x.toFixed(2)} y=${r.elRect.y.toFixed(2)} w=${r.elRect.width.toFixed(2)} h=${r.elRect.height.toFixed(2)}`);
    console.log(`    computed: fontSize=${r.computedFontSize}  lineHeight=${r.computedLineHeight}  width=${r.computedWidth}`);
    console.log(`              fontFamily=${r.computedFontFamily}`);
    console.log(`    fontSizePx=${r.fontSizePx}  lineHeightPx=${r.lineHeightPx}`);
    console.log(`    rect.height / lineHeightPx = ${r.rawLinesByHeight}  (rounds to ${r.roundedLinesByHeight})`);
    console.log(`    rangeRects=${r.rangeRectsCount}  uniqueTops=${r.uniqueTopsCount}`);
    console.log(`    unique tops: [${r.uniqueTops.map(t => t.toFixed(2)).join(", ")}]`);
    console.log(`    rangeBoundingRect: w=${r.rangeBoundingRect.width.toFixed(2)} h=${r.rangeBoundingRect.height.toFixed(2)} top=${r.rangeBoundingRect.top.toFixed(2)} bottom=${r.rangeBoundingRect.bottom.toFixed(2)}`);
    console.log(`    textLength=${r.textLength}`);
    console.log(`    first 15 chars: "${r.firstChars.text}" cps=[${r.firstChars.codepoints.join(",")}]`);
    console.log(`    last  15 chars: "${r.lastChars.text}" cps=[${r.lastChars.codepoints.join(",")}]`);
  }

  console.log();
  console.log(`  DIFF (B minus A):`);
  console.log(`    width:  A=${a.elRect.width.toFixed(2)}px  B=${b.elRect.width.toFixed(2)}px  delta=${(b.elRect.width - a.elRect.width).toFixed(2)}px`);
  console.log(`    height: A=${a.elRect.height.toFixed(2)}px  B=${b.elRect.height.toFixed(2)}px  delta=${(b.elRect.height - a.elRect.height).toFixed(2)}px`);
  console.log(`    lines:  A=${a.roundedLinesByHeight}  B=${b.roundedLinesByHeight}  delta=${b.roundedLinesByHeight - a.roundedLinesByHeight}`);
  console.log(`    unique tops: A=${a.uniqueTopsCount}  B=${b.uniqueTopsCount}`);
}

console.log();
console.log("=".repeat(72));
console.log("Diagnostic complete.");
console.log("=".repeat(72));
console.log();
