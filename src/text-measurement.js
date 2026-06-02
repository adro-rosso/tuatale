// src/text-measurement.js
// Single primitive: measureText(). Renders a styled text block in headless
// Chromium and returns its rendered dimensions converted from CSS pixels
// to PDF points, so callers can pre-compute layout against Puppeteer-PDF
// output. The foundation for text-aware image zones in the template
// system (see SESSION_NOTES "Pivot — Template architecture").

import puppeteer from "puppeteer";

// CSS spec: 1in = 96 CSS px = 72 PDF pt. Independent of physical DPI.
// Puppeteer's headless Chromium renders at 96 CSS DPI, and page.pdf({width:
// "11in"}) outputs a PDF where 1in in CSS == 1in in PDF.
const CSS_PX_PER_INCH = 96;
const PDF_PT_PER_INCH = 72;
const PX_TO_PT = PDF_PT_PER_INCH / CSS_PX_PER_INCH;  // = 0.75

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function googleFontsUrl(fontFamily, fontWeight) {
  const encoded = fontFamily.trim().replace(/\s+/g, "+");
  return `https://fonts.googleapis.com/css2?family=${encoded}:wght@${fontWeight}&display=swap`;
}

/**
 * Render the given text in a headless browser with the specified typography
 * and measure its rendered dimensions.
 *
 * @param {object} opts
 * @param {string} opts.text          - the narrative content to measure
 * @param {string} opts.fontFamily    - Google Fonts name (system fonts also accepted)
 * @param {number} opts.fontSize      - point size, e.g. 18
 * @param {number} opts.lineHeight    - multiplier, e.g. 1.7
 * @param {string} opts.maxWidth      - CSS width, e.g. "540pt" / "5.5in" / "32%"
 * @param {string} [opts.pageWidth="11in"]   - for % resolution
 * @param {string} [opts.pageHeight="8.5in"] - for % resolution
 * @param {string} [opts.letterSpacing=null]
 * @param {number} [opts.fontWeight=400]
 * @param {string} [opts.fontVariantNumeric=null]
 * @returns {Promise<{
 *   lines: number,
 *   linesByRange: number,
 *   heightPt: number,
 *   heightIn: number,
 *   widthPt: number,
 *   actualMaxWidthPt: number,
 * }>}
 */
export async function measureText({
  text,
  fontFamily,
  fontSize,
  lineHeight,
  maxWidth,
  pageWidth = "11in",
  pageHeight = "8.5in",
  letterSpacing = null,
  fontWeight = 400,
  fontVariantNumeric = null,
}) {
  if (text === undefined || text === null || text === "") {
    throw new Error("measureText: text is required and non-empty");
  }
  if (!fontFamily) throw new Error("measureText: fontFamily required");
  if (!fontSize)   throw new Error("measureText: fontSize required");
  if (!lineHeight) throw new Error("measureText: lineHeight required");
  if (!maxWidth)   throw new Error("measureText: maxWidth required");

  const styleRules = [
    `width: ${maxWidth}`,
    `font-family: '${fontFamily}', serif`,
    `font-size: ${fontSize}pt`,
    `line-height: ${lineHeight}`,
    `font-weight: ${fontWeight}`,
  ];
  if (letterSpacing)       styleRules.push(`letter-spacing: ${letterSpacing}`);
  if (fontVariantNumeric)  styleRules.push(`font-variant-numeric: ${fontVariantNumeric}`);

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="${googleFontsUrl(fontFamily, fontWeight)}" rel="stylesheet">
<style>
  @page { size: ${pageWidth} ${pageHeight}; margin: 0; }
  html, body { margin: 0; padding: 0; }
  /* Page-context provides the basis for % maxWidth resolution. Width =
     pageWidth so "32%" resolves against the page, not the viewport. */
  .page-context {
    width: ${pageWidth};
    height: ${pageHeight};
    position: relative;
  }
  .measure {
    ${styleRules.map(r => r + ";").join("\n    ")}
  }
</style>
</head>
<body>
  <div class="page-context">
    <div class="measure">${escapeHtml(text)}</div>
  </div>
</body>
</html>`;

  let browser;
  try {
    browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0" });
    // Wait for web fonts (Google Fonts) to actually load before measuring.
    await page.evaluate(() => document.fonts.ready);

    const m = await page.evaluate(() => {
      const el = document.querySelector(".measure");
      if (!el) throw new Error("measureText: .measure element not found");
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);

      const fontSizePx = parseFloat(style.fontSize);
      const lhRaw = style.lineHeight;
      let lineHeightPx;
      if (lhRaw === "normal") {
        lineHeightPx = fontSizePx * 1.2;
      } else if (lhRaw.endsWith("px")) {
        lineHeightPx = parseFloat(lhRaw);
      } else {
        // Unitless multiplier — getComputedStyle returns the multiplier as
        // a number string for unitless line-height.
        lineHeightPx = fontSizePx * parseFloat(lhRaw);
      }

      const linesByHeight = Math.round(rect.height / lineHeightPx);

      // Cross-check via Range API. Each visual line gets one or more rects
      // at the same top position; counting unique tops gives the line
      // count. Round tops to nearest integer pixel to avoid subpixel noise.
      const range = document.createRange();
      range.selectNodeContents(el);
      const rangeRects = Array.from(range.getClientRects());
      const uniqueTops = new Set();
      rangeRects.forEach(r => uniqueTops.add(Math.round(r.top)));
      const linesByRange = uniqueTops.size;

      const rangeRect = range.getBoundingClientRect();

      return {
        heightPx: rect.height,
        widthPx: rangeRect.width,    // actual text extent
        maxWidthPx: rect.width,      // container layout box
        linesByHeight,
        linesByRange,
      };
    });

    return {
      lines: m.linesByHeight,
      linesByRange: m.linesByRange,
      heightPt: m.heightPx * PX_TO_PT,
      heightIn: m.heightPx / CSS_PX_PER_INCH,
      widthPt: m.widthPx * PX_TO_PT,
      actualMaxWidthPt: m.maxWidthPx * PX_TO_PT,
    };
  } finally {
    if (browser) {
      try { await browser.close(); } catch { /* ignore close errors */ }
    }
  }
}
