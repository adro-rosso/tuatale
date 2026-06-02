// scripts/prototype-workhorse-drama.js
// $0 mockup of the proposed "workhorse-drama" template — full-bleed
// dramatic image top 75%, clean cream text band bottom 25%. Tests
// whether this layout reads as DISTINCTLY DIFFERENT from prompt-6
// (which keeps text OVER the image on a translucent cream band).
//
// Source: prompt-6's own test-output image (a climactic full-bleed
// composition: protagonist standing on bed pointing at a bright star
// outside the window). Same image as prompt-6, different layout →
// the cleanest A/B test of the distinction.

import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import puppeteer from "puppeteer";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, "..");

const PROTOTYPE_DIR = path.join(PROJECT_ROOT, "templates", "_workhorse-drama-prototype");
const TEMPLATE_HTML = path.join(PROTOTYPE_DIR, "template.html");
const SOURCE_IMAGE  = path.join(PROJECT_ROOT, "templates", "prompt-6-iter-1", "test-output", "page-02.png");

// 190-char climactic narrative — matches workhorse-drama char cap (~250)
// while showing the layout handles a fuller paragraph than prompt-6's
// 200-char sweet spot. Borrowed from prompt-6's own validation cut so
// the A/B comparison uses comparable text.
const NARRATIVE_TEXT =
  "But tonight — there is something new. A light she has never seen before, low and steady and much brighter than the rest. It does not twinkle the way stars do. It just shines, calm and still.";

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
console.log("WORKHORSE-DRAMA mockup — full image top 75% / clean text band 25%");
console.log("=".repeat(72));
console.log();
console.log(`  Source:       ${displayPath(SOURCE_IMAGE)}`);
console.log(`                (composed FOR prompt-6 full-bleed — A/B test material)`);
console.log(`  Template:     ${displayPath(TEMPLATE_HTML)}`);
console.log(`  Narrative:    (${NARRATIVE_TEXT.length} chars) ${NARRATIVE_TEXT}`);
console.log(`  Image band:   100% width × 75% height (full-bleed top/L/R, hard cut at 75%)`);
console.log(`  Text band:    50% width centered × 25% height, pure cream, flex-centered`);
console.log(`  Typography:   EB Garamond 18pt (same as prompt-6 — layout is the distinction)`);
console.log();

const PDF_OUT = path.join(PROTOTYPE_DIR, "prototype-workhorse-drama.pdf");
const PNG_OUT = path.join(PROTOTYPE_DIR, "prototype-workhorse-drama-rendered.png");
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
console.log(`  cost:           $0.00 (reused prompt-6 test-output page-02.png)`);
console.log(`  PDF:            ${displayPath(PDF_OUT)}  (${pdfKb} KB)`);
console.log(`  rendered PNG:   ${displayPath(PNG_OUT)}  (${pngKb} KB)`);
console.log();
console.log("Judge:");
console.log("  1. Distinctly different from prompt-6 — text-below-on-clean vs prompt-6's");
console.log("     text-over-image? (Make-or-break: must be visibly its own thing.)");
console.log("  2. Dramatic enough to justify existing as a template?");
console.log("  3. Text clean/legible on pure cream, image bold above?");
console.log();
