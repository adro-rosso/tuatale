// scripts/confirm-bg-patch.js
// $0 confirm-pass after the BG unification patch (2026-05-24).
// Renders prompt-3 p12 and prompt-6 p10 (climax) through the now-patched
// template HTML — no body-bg override, the templates themselves are
// already at #FAF9F0. This shows the actual final state, not a mock.
//
// Why these two:
//   - prompt-3 p12: the patch updates body bg + text-backdrop + text-
//     shadow halo. The previous comparison only tested body-bg change;
//     this renders the fully-patched template so we can confirm the
//     text region is invisible against the new cream (cream-on-cream
//     invariant maintained).
//   - prompt-6 p10: the climax page has a translucent text-overlay
//     deliberately kept at the OLD rgba(240,234,219,0.92). The body bg
//     under the overlay is now #FAF9F0. The overlay's 8% transmission
//     of the body bg through the 92%-opaque cream layer is an untested
//     composite — confirm it stays clean.

import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import puppeteer from "puppeteer";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, "..");

const BOOK_DIR = path.join(PROJECT_ROOT, "output", "books", "2026-05-24-iris-2229");
const PAGES_DIR = path.join(BOOK_DIR, "pages");
const STORY = JSON.parse(fs.readFileSync(path.join(BOOK_DIR, "story.json"), "utf8"));

const TPL_DIR = path.join(PROJECT_ROOT, "templates");
const OUT_DIR = path.join(PROJECT_ROOT, "templates", "_bg-comparison-prototype");

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

const TESTS = [
  {
    page: 12,
    template: "prompt-3-iter-2",
    out: "confirm-page-12-prompt-3-PATCHED.png",
    title: "p12 — prompt-3 PATCHED (body bg + text-backdrop + text-shadow halo all #FAF9F0)",
  },
  {
    page: 10,
    template: "prompt-6-iter-1",
    out: "confirm-page-10-prompt-6-PATCHED.png",
    title: "p10 — prompt-6 climax PATCHED (body #FAF9F0; text-overlay rgba unchanged)",
  },
];

async function renderOne({ templateDir, imageUrl, narrativeText }) {
  const templateHtmlPath = path.join(templateDir, "template.html");
  let html = fs.readFileSync(templateHtmlPath, "utf8");
  html = html
    .replace(/\{\{IMAGE_URL\}\}/g, imageUrl)
    .replace(/\{\{NARRATIVE_TEXT\}\}/g, escapeHtml(narrativeText));

  const tempHtmlPath = path.join(OUT_DIR, `_confirm-${Date.now()}-${Math.random().toString(36).slice(2)}.html`);
  fs.writeFileSync(tempHtmlPath, html, "utf8");

  const browser = await puppeteer.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1056, height: 816 });
    await page.goto(pathToFileURL(tempHtmlPath).href, { waitUntil: "networkidle0" });
    await page.evaluate(() => document.fonts.ready);
    const buf = await page.screenshot({
      type: "png",
      clip: { x: 0, y: 0, width: 1056, height: 816 },
    });
    return buf;
  } finally {
    await browser.close();
    fs.unlinkSync(tempHtmlPath);
  }
}

console.log();
console.log("=".repeat(72));
console.log("Confirm-pass renders post-BG-unification (no body-bg override)");
console.log("=".repeat(72));
console.log();

for (const t of TESTS) {
  const templateDir = path.join(TPL_DIR, t.template);
  const imagePath = path.join(PAGES_DIR, `page-${String(t.page).padStart(2, "0")}.png`);
  if (!fs.existsSync(imagePath)) throw new Error(`missing: ${imagePath}`);
  const scene = STORY.scenes.find((s) => s.page === t.page);
  if (!scene) throw new Error(`scene p${t.page} not in story.json`);

  process.stdout.write(`  rendering ${t.title} ...`);
  const buf = await renderOne({
    templateDir,
    imageUrl: pathToFileURL(imagePath).href,
    narrativeText: scene.narrative_text,
  });
  const outPath = path.join(OUT_DIR, t.out);
  fs.writeFileSync(outPath, buf);
  const kb = (fs.statSync(outPath).size / 1024).toFixed(1);
  process.stdout.write(` done (${kb} KB)\n`);
  console.log(`    -> ${displayPath(outPath)}`);
}

console.log();
console.log("Done. Surface:");
for (const t of TESTS) console.log(`  templates/_bg-comparison-prototype/${t.out}`);
console.log();
