// scripts/test-color-correction.js
// Post-process the v5 Gemini image to force border-zone pixels to exactly
// match the page cream (#F0EADB), then re-render via the existing
// page-pipeline imagePathOverride path. Tests whether deterministic
// color correction can salvage prompt-4-iter-1.
//
// $0 cost — uses existing v5 PNG; no new Gemini calls.

import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { renderPageWithTemplate } from "../src/page-pipeline.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, "..");
const BOOK_DIR = path.join(PROJECT_ROOT, "output", "books", "2026-05-20-iris-1230");
const TEMPLATE_DIR = path.join(PROJECT_ROOT, "templates", "prompt-4-iter-1");
const TEMPLATE_CONFIG = path.join(TEMPLATE_DIR, "config.json");
const TEST_OUT_DIR = path.join(TEMPLATE_DIR, "test-output");
const SOURCE_PNG = path.join(TEST_OUT_DIR, "page-02-v5.png");
const CORRECTED_PNG = path.join(TEST_OUT_DIR, "page-02-v5-corrected.png");

// Target cream: page background color from template.html (#F0EADB).
const TARGET_R = 0xF0; // 240
const TARGET_G = 0xEA; // 234
const TARGET_B = 0xDB; // 219

// Border zone: pixels in the outer 20% margin on any side of the image.
const BORDER_MARGIN = 0.20;

// Euclidean RGB-distance threshold. v5 drift was ~16-21; light painted
// content is typically >=40 from cream. 40 catches drifted cream and
// slightly-off variants while leaving sparse watercolor wash alone.
// Tighten to 30 if too aggressive; loosen to 50 if rectangle persists.
const CORRECTION_THRESHOLD = 40;

function displayPath(p) {
  return path.relative(PROJECT_ROOT, p).replace(/\\/g, "/");
}

console.log();
console.log("=".repeat(72));
console.log("Color-correction test — v5 → border-pixel-forced #F0EADB");
console.log("=".repeat(72));

if (!fs.existsSync(SOURCE_PNG)) {
  console.error(`SOURCE_PNG not found: ${displayPath(SOURCE_PNG)}`);
  process.exit(1);
}

// ---- Step 1: Load v5 PNG into raw buffer ---------------------------------

console.log();
console.log("-".repeat(72));
console.log("Step 1 — Load source image + raw buffer");
console.log("-".repeat(72));

const { data: srcBuffer, info } = await sharp(SOURCE_PNG)
  .raw()
  .toBuffer({ resolveWithObject: true });

const { width, height, channels } = info;
console.log(`  Source:   ${displayPath(SOURCE_PNG)}`);
console.log(`  Geometry: ${width} × ${height}, ${channels} channels`);
console.log(`  Buffer:   ${srcBuffer.length} bytes (= ${width}×${height}×${channels})`);

// ---- Step 2: Border-zone correction --------------------------------------

console.log();
console.log("-".repeat(72));
console.log(`Step 2 — Border-zone correction (threshold ${CORRECTION_THRESHOLD}, target #F0EADB)`);
console.log("-".repeat(72));

const corrected = Buffer.from(srcBuffer);

const borderXLeft  = Math.floor(width  * BORDER_MARGIN);
const borderXRight = Math.floor(width  * (1 - BORDER_MARGIN));
const borderYTop   = Math.floor(height * BORDER_MARGIN);
const borderYBot   = Math.floor(height * (1 - BORDER_MARGIN));

const thresholdSq = CORRECTION_THRESHOLD * CORRECTION_THRESHOLD;
let borderPixels = 0;
let correctedPixels = 0;

for (let y = 0; y < height; y++) {
  const inBorderY = y < borderYTop || y >= borderYBot;
  for (let x = 0; x < width; x++) {
    const inBorderX = x < borderXLeft || x >= borderXRight;
    if (!inBorderX && !inBorderY) continue;

    borderPixels++;
    const off = (y * width + x) * channels;
    const dr = corrected[off]     - TARGET_R;
    const dg = corrected[off + 1] - TARGET_G;
    const db = corrected[off + 2] - TARGET_B;
    if (dr * dr + dg * dg + db * db < thresholdSq) {
      corrected[off]     = TARGET_R;
      corrected[off + 1] = TARGET_G;
      corrected[off + 2] = TARGET_B;
      correctedPixels++;
    }
  }
}

const totalPixels = width * height;
const centralPixels = totalPixels - borderPixels;
const untouchedBorderPixels = borderPixels - correctedPixels;

console.log(`  Total pixels:           ${totalPixels.toLocaleString()}`);
console.log(`  Central (untouched):    ${centralPixels.toLocaleString()} (${(centralPixels/totalPixels*100).toFixed(1)}%)`);
console.log(`  Border (considered):    ${borderPixels.toLocaleString()} (${(borderPixels/totalPixels*100).toFixed(1)}%)`);
console.log(`    Corrected → #F0EADB:    ${correctedPixels.toLocaleString()} (${(correctedPixels/borderPixels*100).toFixed(1)}% of border)`);
console.log(`    Untouched (painted):    ${untouchedBorderPixels.toLocaleString()} (${(untouchedBorderPixels/borderPixels*100).toFixed(1)}% of border)`);

// ---- Step 3: Sample comparison at v5-diagnostic positions ----------------

console.log();
console.log("-".repeat(72));
console.log("Step 3 — Sample comparison vs v5 diagnostic positions");
console.log("-".repeat(72));

function avgRgb(buf, cx, cy, half) {
  let r = 0, g = 0, b = 0, n = 0;
  for (let y = cy - half; y <= cy + half; y++) {
    if (y < 0 || y >= height) continue;
    for (let x = cx - half; x <= cx + half; x++) {
      if (x < 0 || x >= width) continue;
      const off = (y * width + x) * channels;
      r += buf[off]; g += buf[off + 1]; b += buf[off + 2]; n++;
    }
  }
  return { r: Math.round(r/n), g: Math.round(g/n), b: Math.round(b/n) };
}
const hex = ({r,g,b}) => "#" + [r,g,b].map(v => v.toString(16).padStart(2, "0")).join("").toUpperCase();

const positions = [
  { label: "top-left corner",     x: 20,                  y: 20 },
  { label: "top-right corner",    x: width - 20,          y: 20 },
  { label: "bottom-left corner",  x: 20,                  y: height - 20 },
  { label: "bottom-right corner", x: width - 20,          y: height - 20 },
  { label: "top-middle",          x: Math.floor(width/2), y: 20 },
  { label: "bottom-middle",       x: Math.floor(width/2), y: height - 20 },
];

console.log(`  Position             v5 before                v5 corrected`);
for (const p of positions) {
  const before = avgRgb(srcBuffer, p.x, p.y, 10);
  const after  = avgRgb(corrected, p.x, p.y, 10);
  console.log(
    `  ${p.label.padEnd(20)} ${hex(before)} (${String(before.r).padStart(3)},${String(before.g).padStart(3)},${String(before.b).padStart(3)})  →  ${hex(after)} (${String(after.r).padStart(3)},${String(after.g).padStart(3)},${String(after.b).padStart(3)})`
  );
}
console.log(`  Target page cream:   #F0EADB (240, 234, 219)`);

// ---- Step 4: Write corrected PNG -----------------------------------------

console.log();
console.log("-".repeat(72));
console.log("Step 4 — Write corrected PNG");
console.log("-".repeat(72));

await sharp(corrected, { raw: { width, height, channels } })
  .png()
  .toFile(CORRECTED_PNG);

const correctedSize = (fs.statSync(CORRECTED_PNG).size / 1024).toFixed(1);
console.log(`  Wrote:  ${displayPath(CORRECTED_PNG)} (${correctedSize} KB)`);

// ---- Step 5: Render PDF via existing page-pipeline override path ---------

console.log();
console.log("-".repeat(72));
console.log("Step 5 — Render PDF via renderPageWithTemplate (imagePathOverride)");
console.log("-".repeat(72));

const story = JSON.parse(fs.readFileSync(path.join(BOOK_DIR, "story.json"), "utf8"));
const irisP4 = story.scenes.find((s) => s.page === 4);

const tStart = Date.now();
const result = await renderPageWithTemplate({
  templateConfigPath: TEMPLATE_CONFIG,
  scene: { page: "02-v5-corrected", action: irisP4.action },
  narrativeText: irisP4.narrative_text,
  outputDir: TEST_OUT_DIR,
  imagePathOverride: CORRECTED_PNG,
});
const tMs = Date.now() - tStart;

console.log(`  success:   ${result.success}`);
if (result.error) console.log(`  error:     ${result.error}`);
console.log(`  fontSize:  ${result.diagnostics.fontSize}pt`);
console.log(`  cost:      $${result.diagnostics.cost.toFixed(2)}`);
console.log(`  duration:  ${(tMs / 1000).toFixed(1)}s`);
console.log(`  pdfPath:   ${displayPath(result.pdfPath)}`);
if (result.pdfPath && fs.existsSync(result.pdfPath)) {
  const sz = (fs.statSync(result.pdfPath).size / 1024).toFixed(1);
  console.log(`  PDF size:  ${sz} KB`);
}

console.log();
console.log("=".repeat(72));
console.log("Color-correction test complete. Upload PDF for visual judgment.");
console.log("=".repeat(72));
