// scripts/prototype-frame-break.js
// $0 mockup of the FRAME-BREAK Flavor-1 layout (art bleeds past an inset
// CSS frame). Uses 1333 page 9 climax (Iris on blanket, star above) as
// the source image — retrofit of a full-bleed climactic composition.
//
// Validates the core question: does art-bleeds-past-inset-frame read as
// dynamic/exciting, or flat? Plus: does the hairline frame look clean
// and intentional, and does the four-sided break (star top, arms sides,
// blanket bottom) land?
//
// Note: p9 was COMPOSED for prompt-6 full-bleed, not for frame-break.
// A purpose-built frame-break image (Gemini composing with subject/key
// elements reaching for the image edges) could read even better. This
// prototype is fair-to-slightly-pessimistic: a good result here is
// conclusive; a marginal result might be the source image, not the
// effect.

import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import puppeteer from "puppeteer";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, "..");

const PROTOTYPE_DIR = path.join(PROJECT_ROOT, "templates", "_frame-break-prototype");
const TEMPLATE_HTML = path.join(PROTOTYPE_DIR, "template.html");
const SOURCE_IMAGE  = path.join(PROJECT_ROOT, "output", "books", "2026-05-22-iris-1333", "pages", "page-09.png");

// Short, punchy text matching the climactic moment — the actual 1333 p9
// narrative is longer than fits the 20%-tall band cleanly; this is a
// climax-feel placeholder for the mockup.
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
  console.error(`Prototype template not found: ${displayPath(TEMPLATE_HTML)}`);
  process.exit(1);
}

console.log();
console.log("=".repeat(72));
console.log("FRAME-BREAK Flavor-1 mockup — $0 render on 1333 p9 climax");
console.log("=".repeat(72));
console.log();
console.log(`  Image:      ${displayPath(SOURCE_IMAGE)}`);
console.log(`  Template:   ${displayPath(TEMPLATE_HTML)}`);
console.log(`  Narrative:  ${NARRATIVE_TEXT}`);
console.log(`  Bands:      5% top / 60% image / 5% gap / 20% text / 10% bottom`);
console.log(`  Image-band: 80% page width centered (left 10% to 90%)`);
console.log(`  Frame:      15% uniform inset within image-band, 1.5pt #3D2418`);
console.log();

const PDF_OUT = path.join(PROTOTYPE_DIR, "prototype-frame-break.pdf");
const PNG_OUT = path.join(PROTOTYPE_DIR, "prototype-frame-break-rendered.png");
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
console.log(`  cost:           $0.00 (reused 1333 page-09.png)`);
console.log(`  PDF:            ${displayPath(PDF_OUT)}  (${pdfKb} KB)`);
console.log(`  rendered PNG:   ${displayPath(PNG_OUT)}  (${pngKb} KB)`);
console.log();
console.log("Judge:");
console.log("  1. Does art-bleeds-past-frame read as dynamic/exciting, or flat?");
console.log("  2. Is the 1.5pt hairline frame clean/intentional, or thin/lost or heavy/decorative?");
console.log("  3. Does the four-sided break land — star top, arms sides, blanket bottom?");
console.log();
console.log("Reminder: p9 was COMPOSED for prompt-6 full-bleed, not frame-break. A");
console.log("purpose-built image (Gemini composing for the effect) could read better.");
console.log("Read accordingly: marginal here ≠ shelve Flavor 1.");
console.log();
