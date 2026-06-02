// scripts/prototype-frame-break-v2.js
// Corrected $0 mockup: image strip narrower than page (65% w centered,
// cream margins L+R), image taller than frame (extends 8% page-height
// above + below frame lines into cream). The "scene overflows its
// frame" Flavor-1 effect that's reliably achievable WITHOUT subject
// isolation. Same 1333 p9 source, no Gemini spend.

import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import puppeteer from "puppeteer";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, "..");

const PROTOTYPE_DIR = path.join(PROJECT_ROOT, "templates", "_frame-break-prototype");
const TEMPLATE_HTML = path.join(PROTOTYPE_DIR, "template-v2.html");
const SOURCE_IMAGE  = path.join(PROJECT_ROOT, "output", "books", "2026-05-22-iris-1333", "pages", "page-09.png");

const NARRATIVE_TEXT =
  "One blazing star. Right above her. Burning bright.";

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
console.log("FRAME-BREAK v2 mockup — scene overflows frame top+bottom into cream");
console.log("=".repeat(72));
console.log();
console.log(`  Image:        ${displayPath(SOURCE_IMAGE)}`);
console.log(`  Template:     ${displayPath(TEMPLATE_HTML)}`);
console.log(`  Narrative:    ${NARRATIVE_TEXT}`);
console.log(`  Image strip:  65% page width centered, 58% page height (top 6% → 64%)`);
console.log(`  Frame:        65% width × 42% height (top 14% → 56%), 1.5pt #3D2418`);
console.log(`  Overflow:     8% page-height above frame top, 8% below frame bottom`);
console.log(`  Cream side:   17.5% margin L + R of image strip`);
console.log(`  Text band:    50% × 20%, centered, y=70%-90% on pure cream`);
console.log();

const PDF_OUT = path.join(PROTOTYPE_DIR, "prototype-frame-break-v2.pdf");
const PNG_OUT = path.join(PROTOTYPE_DIR, "prototype-frame-break-v2-rendered.png");
const TEMP_HTML = path.join(PROTOTYPE_DIR, "_rendering-v2.html");

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
console.log("Mockup v2 rendered.");
console.log("=".repeat(72));
console.log(`  wall:           ${(wallMs / 1000).toFixed(1)}s`);
console.log(`  cost:           $0.00 (reused 1333 page-09.png)`);
console.log(`  PDF:            ${displayPath(PDF_OUT)}  (${pdfKb} KB)`);
console.log(`  rendered PNG:   ${displayPath(PNG_OUT)}  (${pngKb} KB)`);
console.log();
console.log("Judge:");
console.log("  Does scene-overflows-its-frame read as dynamic, or still flat/box-on-picture?");
console.log();
