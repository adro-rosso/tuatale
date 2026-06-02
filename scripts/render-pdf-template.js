// scripts/render-pdf-template.js — Architecture-B spike renderer.
//
// Loads an HTML template, substitutes {{IMAGE_URL}} + {{NARRATIVE_TEXT}}
// placeholders with one scene's content from a book directory, and renders
// the result via Puppeteer to a single-page PDF.
//
// This is the spike for the post-pivot template architecture (see
// SESSION_NOTES "Pivot — Template architecture"). It renders ONE page only,
// not a whole book. Full multi-page wiring comes after the spike validates.
//
// Output: <template-path>/spike-output.pdf

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import puppeteer from "puppeteer";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, "..");

const USAGE = `
Usage: node scripts/render-pdf-template.js [flags]

Required:
  --template-path  <path>   Template dir; must contain template.html
  --book-dir       <path>   Book dir (pages/page-NN.{png,txt})
  --page-number    <int>    Scene page 1..12

Optional:
  --image-override <path>   Use this image instead of <book-dir>/pages/page-NN.png
  --output-name    <name>   Output filename in <template-path> (default: spike-output.pdf)

Output:
  Writes the output PDF into the template dir.

Both --flag value and --flag=value forms are accepted.
`.trim();

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) {
      throw new Error(`Unexpected positional argument: ${a}.`);
    }
    const eqIdx = a.indexOf("=");
    if (eqIdx >= 0) {
      args[a.slice(2, eqIdx)] = a.slice(eqIdx + 1);
    } else {
      const k = a.slice(2);
      const v = argv[i + 1];
      if (v === undefined || v.startsWith("--")) {
        throw new Error(`Missing value for --${k}`);
      }
      args[k] = v;
      i++;
    }
  }
  return args;
}

function displayPath(absolutePath) {
  return path.relative(PROJECT_ROOT, absolutePath).replace(/\\/g, "/");
}

function escapeHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ---- Parse + validate args -------------------------------------------------
let args;
try {
  args = parseArgs(process.argv.slice(2));
} catch (err) {
  console.error(`FAIL: ${err.message}`);
  console.error("");
  console.error(USAGE);
  process.exit(1);
}

const templatePathArg = args["template-path"];
const bookDirArg = args["book-dir"];
const pageNumberArg = args["page-number"];

if (!templatePathArg || !bookDirArg || !pageNumberArg) {
  console.error("FAIL: missing required flag(s).");
  console.error("");
  console.error(USAGE);
  process.exit(1);
}

const pageNumber = parseInt(pageNumberArg, 10);
if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > 12) {
  console.error(`FAIL: --page-number must be an integer 1..12 (got: ${pageNumberArg})`);
  process.exit(1);
}

const templatePath = path.resolve(templatePathArg);
const bookDir = path.resolve(bookDirArg);
const templateHtmlPath = path.join(templatePath, "template.html");
const imageOverrideArg = args["image-override"];
const outputName = args["output-name"] || "spike-output.pdf";

if (!fs.existsSync(templateHtmlPath)) {
  console.error(`FAIL: template.html not found at ${displayPath(templateHtmlPath)}`);
  process.exit(1);
}
if (!fs.existsSync(bookDir) || !fs.statSync(bookDir).isDirectory()) {
  console.error(`FAIL: --book-dir does not exist or is not a directory: ${displayPath(bookDir)}`);
  process.exit(1);
}

const pageNumStr = String(pageNumber).padStart(2, "0");
let imagePath = path.join(bookDir, "pages", `page-${pageNumStr}.png`);
const textPath = path.join(bookDir, "pages", `page-${pageNumStr}.txt`);

if (imageOverrideArg) {
  imagePath = path.resolve(imageOverrideArg);
}

if (!fs.existsSync(imagePath)) {
  console.error(
    imageOverrideArg
      ? `FAIL: --image-override path not found: ${displayPath(imagePath)}`
      : `FAIL: image not found at ${displayPath(imagePath)}`
  );
  process.exit(1);
}
if (!fs.existsSync(textPath)) {
  console.error(`FAIL: text not found at ${displayPath(textPath)}`);
  process.exit(1);
}

// ---- Substitute template ---------------------------------------------------
const templateHtml = fs.readFileSync(templateHtmlPath, "utf8");
const narrativeText = fs.readFileSync(textPath, "utf8").trim();

// file:// URI to the image; pathToFileURL handles Windows backslashes +
// URL-encoding correctly so Chromium can fetch the local PNG.
const imageFileUrl = pathToFileURL(imagePath).href;

const renderedHtml = templateHtml
  .replace(/\{\{IMAGE_URL\}\}/g, imageFileUrl)
  .replace(/\{\{NARRATIVE_TEXT\}\}/g, escapeHtml(narrativeText));

// Write rendered HTML to a temp file inside the template dir, so Puppeteer
// loads it via file:// — that's what lets Chromium load the image file://
// src and the relative Google Fonts link without cross-origin headaches.
const tempHtmlPath = path.join(templatePath, "_rendering.html");
fs.writeFileSync(tempHtmlPath, renderedHtml, "utf8");

// ---- Render via Puppeteer --------------------------------------------------
console.log();
console.log(`Spike render: ${displayPath(templatePath)} ← ${displayPath(bookDir)} page ${pageNumStr}`);
console.log(`  image: ${displayPath(imagePath)}${imageOverrideArg ? " (override)" : ""}`);
console.log(`  text:  ${displayPath(textPath)} (${narrativeText.length} chars)`);
console.log();

const outputPdfPath = path.join(templatePath, outputName);

let browser;
try {
  browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto(pathToFileURL(tempHtmlPath).href, { waitUntil: "networkidle0" });
  // Wait for web fonts (EB Garamond from Google Fonts) to load.
  await page.evaluate(() => document.fonts.ready);
  await page.pdf({
    path: outputPdfPath,
    width: "11in",
    height: "8.5in",
    printBackground: true,
    margin: { top: 0, right: 0, bottom: 0, left: 0 },
    preferCSSPageSize: false,
  });
  await browser.close();
} catch (err) {
  console.error(`FAIL: render error: ${err?.message ?? err}`);
  if (browser) {
    try { await browser.close(); } catch {}
  }
  // Leave _rendering.html on disk for debugging.
  process.exit(1);
}

// Clean up temp HTML.
fs.unlinkSync(tempHtmlPath);

const outputSize = fs.statSync(outputPdfPath).size;
const outputSizeKB = (outputSize / 1024).toFixed(1);

console.log("=".repeat(70));
console.log("Spike render complete.");
console.log("=".repeat(70));
console.log(`  Output:  ${displayPath(outputPdfPath)} (${outputSizeKB} KB)`);
console.log();
