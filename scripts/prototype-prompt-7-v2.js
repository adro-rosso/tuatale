// scripts/prototype-prompt-7-v2.js
// $0 prototype of the prompt-7 v2 structural redesign (three CSS bands:
// image / gap / text). Reuses today's existing firefly PNG (16:9-pinned
// 1376×768 raster on disk) so no Gemini call fires.
//
// Purpose: validate the core unknown — does a 528×297px feathered shrunk
// raster image read as a beautiful small jewel on cream, or as a blurry
// shrunk photo? Plus confirm the structural guarantees:
//   - Text strictly in the bottom band, on pure cream, zero painted intrusion.
//   - Image's bottom edge at exactly 41% of page (CSS-set, not Gemini-set).
//
// Outputs: prototype-firefly.pdf + prototype-firefly-rendered.png in
// _v2-prototype/. Canonical config + template untouched.

import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import puppeteer from "puppeteer";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, "..");

const PROTOTYPE_DIR = path.join(PROJECT_ROOT, "templates", "prompt-7-iter-1", "_v2-prototype");
const TEMPLATE_HTML = path.join(PROTOTYPE_DIR, "template.html");
const FIREFLY_PNG   = path.join(PROJECT_ROOT, "templates", "prompt-7-iter-1", "test-output", "page-02.png");

const NARRATIVE_TEXT =
  "The little light pulses in her hands. She holds her breath. It is the smallest, kindest brightness she has ever seen.";

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

if (!fs.existsSync(FIREFLY_PNG)) {
  console.error(`Firefly PNG not found at ${displayPath(FIREFLY_PNG)} — prototype cannot run.`);
  process.exit(1);
}
if (!fs.existsSync(TEMPLATE_HTML)) {
  console.error(`Prototype template not found at ${displayPath(TEMPLATE_HTML)} — prototype cannot run.`);
  process.exit(1);
}

console.log();
console.log("=".repeat(72));
console.log("prompt-7-iter-1 v2 PROTOTYPE — three-band layout, $0 firefly render");
console.log("=".repeat(72));
console.log();
console.log(`  Image source:  ${displayPath(FIREFLY_PNG)}  (existing 1376×768)`);
console.log(`  Template:      ${displayPath(TEMPLATE_HTML)}`);
console.log(`  Narrative:     ${NARRATIVE_TEXT}`);
console.log(`  Geometry:      5% top / 36% image / 17% gap / 32% text / 10% bottom`);
console.log(`  Image box:     50% page width × 36% page height, centered`);
console.log(`  Feather:       12% cross-gradient mask each side`);
console.log();

const PDF_OUT = path.join(PROTOTYPE_DIR, "prototype-firefly.pdf");
const PNG_OUT = path.join(PROTOTYPE_DIR, "prototype-firefly-rendered.png");
const TEMP_HTML = path.join(PROTOTYPE_DIR, "_rendering.html");

let html = fs.readFileSync(TEMPLATE_HTML, "utf8");
html = html
  .replace(/\{\{IMAGE_URL\}\}/g, pathToFileURL(FIREFLY_PNG).href)
  .replace(/\{\{NARRATIVE_TEXT\}\}/g, escapeHtml(NARRATIVE_TEXT));
fs.writeFileSync(TEMP_HTML, html, "utf8");

// Same viewport math as the canonical pipeline: page dims at 96dpi (browser
// default for CSS inch units). 11×8.5in → 1056×816px.
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
console.log("Prototype rendered.");
console.log("=".repeat(72));
console.log(`  wall:           ${(wallMs / 1000).toFixed(1)}s`);
console.log(`  cost:           $0.00 (reused existing firefly PNG)`);
console.log(`  PDF:            ${displayPath(PDF_OUT)}  (${pdfKb} KB)`);
console.log(`  rendered PNG:   ${displayPath(PNG_OUT)}  (${pngKb} KB)`);
console.log();
console.log("Judge:");
console.log("  1. Does the 528×297 feathered shrunk firefly read as a beautiful small");
console.log("     jewel on cream — or as a blurry shrunk photo? (CORE UNKNOWN)");
console.log("  2. Text strictly in the bottom band, pure cream, zero painted intrusion,");
console.log("     fully legible at 14pt.");
console.log("  3. Band proportions 5/36/17/32/10 — right, or wants tuning?");
console.log();
console.log("Reminder: firefly was painted under v1's prompt — it fills ~half its source");
console.log("frame, so shrinking it cuts feather through real content. Production v2 would");
console.log("paint a cleaner contained scene. Read accordingly: marginal here ≠ shelve v2.");
console.log();
