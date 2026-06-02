// scripts/prototype-vertical-split.js
// $0 mockup of the proposed vertical-split template: portrait image
// left (58% w, full-height, would be 3:4 pinned in production), pure
// cream text column right (42% w, full-height, flex-centered text).
//
// HONEST CAVEAT: our existing images are landscape; cropping one into a
// 3:4 portrait column will look awkward regardless of layout quality
// because the source wasn't composed tall. This mockup tests the
// LAYOUT MECHANICS — does the vertical division read well, is the text
// column clean and balanced full-height, does the hard vertical cut
// feel intentional?
//
// If layout mechanics hold → one fresh ~$0.04 render with portrait
// aspect pin + vertical-composition prompt is the real validation.

import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import puppeteer from "puppeteer";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, "..");

const PROTOTYPE_DIR = path.join(PROJECT_ROOT, "templates", "_vertical-split-prototype");
const TEMPLATE_HTML = path.join(PROTOTYPE_DIR, "template.html");
// 1333 p11 — Iris pointing up at the sky with mother. Pointing-up
// gesture is the clearest vertical-emphasis content in the existing
// image pool. p9 has been used 3× in prior mockups — diminishing
// freshness. Side-crop into 3:4 will lose the mother (right edge) and
// most of the left sky; keeps central pointing gesture. Known awkward.
const SOURCE_IMAGE = path.join(PROJECT_ROOT, "output", "books", "2026-05-22-iris-1333", "pages", "page-11.png");

// 247-char narrative — matches the proposed ~280 char cap, tests the
// tall column's text-holding capacity vs the bottom-band templates'
// shorter caps.
const NARRATIVE_TEXT =
  "Look! she whispered, her finger reaching for the very tip of the sky. Mama smiled and looked up too. Together they watched the first star quietly arrive, and then another, and another — the whole night sky beginning, just for them.";

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function displayPath(p) {
  return path.relative(PROJECT_ROOT, p).replace(/\\/g, "/");
}

if (!fs.existsSync(SOURCE_IMAGE)) {
  console.error(`Source image not found: ${displayPath(SOURCE_IMAGE)}`);
  process.exit(1);
}
if (!fs.existsSync(TEMPLATE_HTML)) {
  console.error(`Template not found: ${displayPath(TEMPLATE_HTML)}`);
  process.exit(1);
}

console.log();
console.log("=".repeat(72));
console.log("VERTICAL-SPLIT mockup — portrait image left, text column right");
console.log("=".repeat(72));
console.log();
console.log(`  Source image:  ${displayPath(SOURCE_IMAGE)}`);
console.log(`                 (landscape source, will side-crop heavily into 3:4 column)`);
console.log(`  Template:      ${displayPath(TEMPLATE_HTML)}`);
console.log(`  Narrative:     (${NARRATIVE_TEXT.length} chars)`);
console.log(`                 ${NARRATIVE_TEXT}`);
console.log(`  Image column:  58% page width, full-height (matches 3:4 portrait aspect)`);
console.log(`  Text column:   42% page width, full-height, pure cream, flex-centered`);
console.log(`  Typography:    EB Garamond 18pt (catalogue-cohesive serif)`);
console.log();

const PDF_OUT = path.join(PROTOTYPE_DIR, "prototype-vertical-split.pdf");
const PNG_OUT = path.join(PROTOTYPE_DIR, "prototype-vertical-split-rendered.png");
const TEMP_HTML = path.join(PROTOTYPE_DIR, "_rendering.html");

let html = fs.readFileSync(TEMPLATE_HTML, "utf8");
html = html
  .replace(/\{\{IMAGE_URL\}\}/g, pathToFileURL(SOURCE_IMAGE).href)
  .replace(/\{\{NARRATIVE_TEXT\}\}/g, escapeHtml(NARRATIVE_TEXT));
fs.writeFileSync(TEMP_HTML, html, "utf8");

const VIEWPORT_W = Math.round(11 * 96);
const VIEWPORT_H = Math.round(8.5 * 96);

console.log("Rendering...");
const tStart = Date.now();
let browser;
try {
  browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();
  await page.setViewport({ width: VIEWPORT_W, height: VIEWPORT_H });
  await page.goto(pathToFileURL(TEMP_HTML).href, { waitUntil: "networkidle0" });
  await page.evaluate(() => document.fonts.ready);
  await page.pdf({
    path: PDF_OUT,
    width: "11in",
    height: "8.5in",
    printBackground: true,
    margin: { top: 0, right: 0, bottom: 0, left: 0 },
    preferCSSPageSize: false,
  });
  await page.screenshot({
    path: PNG_OUT,
    clip: { x: 0, y: 0, width: VIEWPORT_W, height: VIEWPORT_H },
    type: "png",
  });
  await browser.close();
} catch (err) {
  if (browser) { try { await browser.close(); } catch {} }
  fs.unlinkSync(TEMP_HTML);
  console.error("Render failed:", err.message);
  process.exit(1);
}
fs.unlinkSync(TEMP_HTML);

const wallMs = Date.now() - tStart;
const pdfKb = (fs.statSync(PDF_OUT).size / 1024).toFixed(1);
const pngKb = (fs.statSync(PNG_OUT).size / 1024).toFixed(1);

console.log();
console.log("=".repeat(72));
console.log("Mockup rendered.");
console.log("=".repeat(72));
console.log(`  wall:           ${(wallMs / 1000).toFixed(1)}s`);
console.log(`  cost:           $0.00 (reused 1333 page-11.png)`);
console.log(`  PDF:            ${displayPath(PDF_OUT)}  (${pdfKb} KB)`);
console.log(`  rendered PNG:   ${displayPath(PNG_OUT)}  (${pngKb} KB)`);
console.log();
console.log("Judge (layout mechanics — be charitable to the cropped landscape image):");
console.log("  1. Vertical division at 58% reads well? Text column clean and balanced full-height?");
console.log("  2. Hard vertical cut: intentional/poster-mounted, or jarring/cheap?");
console.log("  3. Catalogue distinction from prompt-2 (which has landscape+feathered-edge+image-right)?");
console.log();
