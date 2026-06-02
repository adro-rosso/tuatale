// scripts/prototype-bg-comparison.js
// $0 read-only prototype: re-render existing book pages through their
// actual template HTML with body background-color overridden to three
// candidate values. Composes side-by-side comparison images so the
// user can judge whether brightening the cream diminishes the prompt-8
// rim outline AND check that prompt-2's left-edge feather + prompt-3's
// vignette don't degrade on the brighter values.
//
// Test pages: p7, p9 (prompt-8 portrait — rim most visible),
//             p6 (prompt-2 landscape — has CSS-mask left-edge feather),
//             p12 (prompt-3 closing — vignette + cream clearing).
//
// Backgrounds:
//   1. (current)         — each template's own background unchanged
//                           (prompt-2 #F0EADB, prompt-3/8 #F0E8D8)
//   2. #F7F2E6 midpoint
//   3. #FAF9F0 rim-match
//
// Output: one comparison PNG per test page (4 total) in
// templates/_bg-comparison-prototype/. Each comparison has labelled
// 3-panel layout, ready to surface.
//
// No template configs or source files modified.

import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import puppeteer from "puppeteer";
import sharp from "sharp";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, "..");

const BOOK_DIR = path.join(PROJECT_ROOT, "output", "books", "2026-05-24-iris-2229");
const PAGES_DIR = path.join(BOOK_DIR, "pages");
const STORY = JSON.parse(fs.readFileSync(path.join(BOOK_DIR, "story.json"), "utf8"));

const TPL_DIR = path.join(PROJECT_ROOT, "templates");
const OUT_DIR = path.join(PROJECT_ROOT, "templates", "_bg-comparison-prototype");
fs.mkdirSync(OUT_DIR, { recursive: true });

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

const BACKGROUNDS = [
  { label: "(current — unchanged)", color: null },
  { label: "#F7F2E6 midpoint",      color: "#F7F2E6" },
  { label: "#FAF9F0 rim-match",     color: "#FAF9F0" },
];

const TESTS = [
  { page: 7,  template: "prompt-8-iter-1", title: "p7 — prompt-8 portrait (rim test)" },
  { page: 9,  template: "prompt-8-iter-1", title: "p9 — prompt-8 portrait (rim test, uniform)" },
  { page: 6,  template: "prompt-2-iter-2", title: "p6 — prompt-2 landscape (feather edge test)" },
  { page: 12, template: "prompt-3-iter-2", title: "p12 — prompt-3 vignette + cream clearing test" },
];

async function renderOne({ templateDir, imageUrl, narrativeText, bgColor }) {
  const templateHtmlPath = path.join(templateDir, "template.html");
  let html = fs.readFileSync(templateHtmlPath, "utf8");
  html = html
    .replace(/\{\{IMAGE_URL\}\}/g, imageUrl)
    .replace(/\{\{NARRATIVE_TEXT\}\}/g, escapeHtml(narrativeText));
  if (bgColor) {
    // Override ONLY the body/html background-color. Text-backdrop / other
    // cream-coloured elements (e.g. prompt-3's text-backdrop) keep their
    // declared colour — this is the honest test of "what if we change
    // just the body bg?". Any backdrop-vs-bg mismatch is itself a finding.
    const override = `<style>html, body { background-color: ${bgColor} !important; }</style>`;
    html = html.replace(/<\/head>/i, override + "</head>");
  }

  const tempHtmlPath = path.join(OUT_DIR, `_temp-${Date.now()}-${Math.random().toString(36).slice(2)}.html`);
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

async function buildComparisonImage({ template, page, title }) {
  const templateDir = path.join(TPL_DIR, template);
  const imagePath = path.join(PAGES_DIR, `page-${String(page).padStart(2, "0")}.png`);
  if (!fs.existsSync(imagePath)) throw new Error(`missing image: ${imagePath}`);
  const scene = STORY.scenes.find((s) => s.page === page);
  if (!scene) throw new Error(`scene p${page} not in story.json`);
  const imageUrl = pathToFileURL(imagePath).href;

  process.stdout.write(`  building ${title} ...`);
  const renders = [];
  for (const bg of BACKGROUNDS) {
    const buf = await renderOne({
      templateDir,
      imageUrl,
      narrativeText: scene.narrative_text,
      bgColor: bg.color,
    });
    renders.push({ ...bg, buf });
  }

  // Composite layout: title row + label row + 3 panels horizontal
  const PANEL_W = 528, PANEL_H = 408;
  const GAP = 12, PAD = 14;
  const TITLE_H = 32, LABEL_H = 26;
  const totalW = PANEL_W * 3 + GAP * 2 + PAD * 2;
  const totalH = TITLE_H + LABEL_H + PANEL_H + PAD * 2;

  // Resize each render to half-scale panel
  const resizedBufs = await Promise.all(
    renders.map((r) =>
      sharp(r.buf)
        .resize(PANEL_W, PANEL_H, { fit: "fill" })
        .png()
        .toBuffer()
    )
  );

  // SVG header (title + 3 column labels)
  const labelX = (i) => PAD + i * (PANEL_W + GAP) + PANEL_W / 2;
  const headerSvg = Buffer.from(
    `<svg width="${totalW}" height="${TITLE_H + LABEL_H + PAD}" xmlns="http://www.w3.org/2000/svg">
       <rect width="100%" height="100%" fill="#ffffff"/>
       <text x="${totalW / 2}" y="22" font-family="Arial, sans-serif" font-size="17" font-weight="bold" fill="#111" text-anchor="middle">${escapeHtml(title)}</text>
       <text x="${labelX(0)}" y="${TITLE_H + 18}" font-family="Arial, sans-serif" font-size="13" fill="#333" text-anchor="middle">${escapeHtml(BACKGROUNDS[0].label)}</text>
       <text x="${labelX(1)}" y="${TITLE_H + 18}" font-family="Arial, sans-serif" font-size="13" fill="#333" text-anchor="middle">${escapeHtml(BACKGROUNDS[1].label)}</text>
       <text x="${labelX(2)}" y="${TITLE_H + 18}" font-family="Arial, sans-serif" font-size="13" fill="#333" text-anchor="middle">${escapeHtml(BACKGROUNDS[2].label)}</text>
     </svg>`
  );

  const panelTop = TITLE_H + LABEL_H + PAD;
  const composites = [
    { input: headerSvg, top: 0, left: 0 },
    { input: resizedBufs[0], top: panelTop, left: PAD },
    { input: resizedBufs[1], top: panelTop, left: PAD + PANEL_W + GAP },
    { input: resizedBufs[2], top: panelTop, left: PAD + (PANEL_W + GAP) * 2 },
  ];

  const outPath = path.join(
    OUT_DIR,
    `comparison-page-${String(page).padStart(2, "0")}-${template}.png`
  );

  await sharp({
    create: { width: totalW, height: totalH, channels: 3, background: { r: 255, g: 255, b: 255 } },
  })
    .composite(composites)
    .png()
    .toFile(outPath);

  process.stdout.write(` done\n`);
  return outPath;
}

console.log();
console.log("=".repeat(72));
console.log("BG-comparison $0 prototype — 4 pages × 3 backgrounds");
console.log("=".repeat(72));
console.log();
console.log("Source book:  output/books/2026-05-24-iris-2229/  (read-only)");
console.log("Output dir:   templates/_bg-comparison-prototype/");
console.log("Cost:         $0.00 (no Gemini calls)");
console.log();
console.log("Backgrounds tested:");
for (const bg of BACKGROUNDS) console.log(`  - ${bg.label}${bg.color ? "  " + bg.color : ""}`);
console.log();

const outputs = [];
for (const t of TESTS) {
  outputs.push(await buildComparisonImage(t));
}

console.log();
console.log("=".repeat(72));
console.log("Done. Comparison images (group by page, 3 backgrounds each):");
console.log("=".repeat(72));
for (const o of outputs) console.log("  " + displayPath(o));
console.log();
