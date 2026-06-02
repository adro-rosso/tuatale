// scripts/test-color-correction-feathered.js
// Feathered variant of test-color-correction.js: replace binary snap
// with linear gradient blend that tapers correction strength from 1.0
// at the outermost edge to 0.0 at the inner boundary of the zone.
// Eliminates the "migrated rectangle" artifact at the binary version's
// inner correction boundary.
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
const CORRECTED_PNG = path.join(TEST_OUT_DIR, "page-02-v5-corrected-feathered.png");

const TARGET_R = 0xF0;
const TARGET_G = 0xEA;
const TARGET_B = 0xDB;
const BORDER_MARGIN = 0.20;
const CORRECTION_THRESHOLD = 40;

function displayPath(p) {
  return path.relative(PROJECT_ROOT, p).replace(/\\/g, "/");
}

console.log();
console.log("=".repeat(72));
console.log("Feathered color-correction test — v5 → gradient blend toward #F0EADB");
console.log("=".repeat(72));

if (!fs.existsSync(SOURCE_PNG)) {
  console.error(`SOURCE_PNG not found: ${displayPath(SOURCE_PNG)}`);
  process.exit(1);
}

// ---- Step 1: Load source ------------------------------------------------

console.log();
console.log("-".repeat(72));
console.log("Step 1 — Load source image + raw buffer");
console.log("-".repeat(72));

const { data: srcBuffer, info } = await sharp(SOURCE_PNG)
  .raw()
  .toBuffer({ resolveWithObject: true });

const { width, height, channels } = info;
const zoneWidth = Math.min(
  Math.floor(width  * BORDER_MARGIN),
  Math.floor(height * BORDER_MARGIN)
);
console.log(`  Source:      ${displayPath(SOURCE_PNG)}`);
console.log(`  Geometry:    ${width} × ${height}, ${channels} channels`);
console.log(`  Zone width:  ${zoneWidth} px (= min(${Math.floor(width*BORDER_MARGIN)}, ${Math.floor(height*BORDER_MARGIN)}) — uniform on all sides)`);

// ---- Step 2: Feathered correction ---------------------------------------

console.log();
console.log("-".repeat(72));
console.log(`Step 2 — Feathered correction (threshold ${CORRECTION_THRESHOLD}, target #F0EADB)`);
console.log("-".repeat(72));

const corrected = Buffer.from(srcBuffer);
const thresholdSq = CORRECTION_THRESHOLD * CORRECTION_THRESHOLD;

let inZonePixels = 0;
let gateCaughtPixels = 0;
let blendedPixels = 0;
const strengthBuckets = [0, 0, 0, 0, 0]; // [0,0.2) [0.2,0.4) [0.4,0.6) [0.6,0.8) [0.8,1.0]

for (let y = 0; y < height; y++) {
  const dy = y < height - 1 - y ? y : height - 1 - y;
  for (let x = 0; x < width; x++) {
    const dx = x < width - 1 - x ? x : width - 1 - x;
    const distFromEdge = dx < dy ? dx : dy;
    if (distFromEdge >= zoneWidth) continue;

    inZonePixels++;
    const off = (y * width + x) * channels;
    const r = corrected[off];
    const g = corrected[off + 1];
    const b = corrected[off + 2];
    const drr = r - TARGET_R;
    const dgg = g - TARGET_G;
    const dbb = b - TARGET_B;
    if (drr * drr + dgg * dgg + dbb * dbb > thresholdSq) {
      gateCaughtPixels++;
      continue;
    }

    const strength = 1 - distFromEdge / zoneWidth;
    corrected[off]     = Math.round(r * (1 - strength) + TARGET_R * strength);
    corrected[off + 1] = Math.round(g * (1 - strength) + TARGET_G * strength);
    corrected[off + 2] = Math.round(b * (1 - strength) + TARGET_B * strength);
    blendedPixels++;

    const bucket = strength >= 0.8 ? 4
                 : strength >= 0.6 ? 3
                 : strength >= 0.4 ? 2
                 : strength >= 0.2 ? 1
                 : 0;
    strengthBuckets[bucket]++;
  }
}

const totalPixels = width * height;
const centralPixels = totalPixels - inZonePixels;

console.log(`  Total pixels:           ${totalPixels.toLocaleString()}`);
console.log(`  Central (outside zone): ${centralPixels.toLocaleString()} (${(centralPixels/totalPixels*100).toFixed(1)}%)`);
console.log(`  In correction zone:     ${inZonePixels.toLocaleString()} (${(inZonePixels/totalPixels*100).toFixed(1)}%)`);
console.log(`    Color-gate caught:      ${gateCaughtPixels.toLocaleString()} (${(gateCaughtPixels/inZonePixels*100).toFixed(1)}% of zone — painted)`);
console.log(`    Blended:                ${blendedPixels.toLocaleString()} (${(blendedPixels/inZonePixels*100).toFixed(1)}% of zone)`);
console.log();
console.log(`  Strength distribution among blended pixels:`);
const labels = ["[0.0, 0.2)", "[0.2, 0.4)", "[0.4, 0.6)", "[0.6, 0.8)", "[0.8, 1.0]"];
const notes  = ["near inner boundary", "", "", "", "near outer edge"];
for (let i = 0; i < 5; i++) {
  const count = strengthBuckets[i];
  const pct = (count / blendedPixels * 100).toFixed(1);
  console.log(`    ${labels[i]}  ${count.toLocaleString().padStart(8)} (${pct.padStart(4)}%)${notes[i] ? "   ← " + notes[i] : ""}`);
}

// ---- Step 3: Sample comparison (extended for gradient) ------------------

console.log();
console.log("-".repeat(72));
console.log("Step 3 — Sample comparison (with gradient demonstration positions)");
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
const rgbStr = ({r,g,b}) => `(${String(r).padStart(3)},${String(g).padStart(3)},${String(b).padStart(3)})`;

const positions = [
  { label: "top-left corner",      x: 20,                  y: 20 },
  { label: "top-middle",           x: Math.floor(width/2), y: 20 },
  { label: "top-right corner",     x: width - 20,          y: 20 },
  { label: "top-quarter-down",     x: Math.floor(width/2), y: 80 },
  { label: "top-near-boundary",    x: Math.floor(width/2), y: 140 },
  { label: "center (out of zone)", x: Math.floor(width/2), y: Math.floor(height/2) },
  { label: "bottom-near-boundary", x: Math.floor(width/2), y: height - 140 },
  { label: "bottom-middle",        x: Math.floor(width/2), y: height - 20 },
  { label: "bottom-left corner",   x: 20,                  y: height - 20 },
  { label: "bottom-right corner",  x: width - 20,          y: height - 20 },
];

function geometricStrength(x, y) {
  const dx = Math.min(x, width  - 1 - x);
  const dy = Math.min(y, height - 1 - y);
  const d  = Math.min(dx, dy);
  if (d >= zoneWidth) return 0;
  return 1 - d / zoneWidth;
}

console.log(`  Position                  strength   before                  →  after`);
for (const p of positions) {
  const before = avgRgb(srcBuffer, p.x, p.y, 10);
  const after  = avgRgb(corrected, p.x, p.y, 10);
  const s = geometricStrength(p.x, p.y);
  console.log(
    `  ${p.label.padEnd(25)} ${s.toFixed(3)}      ${hex(before)} ${rgbStr(before)}  →  ${hex(after)} ${rgbStr(after)}`
  );
}
console.log(`  Target page cream:        —          #F0EADB (240, 234, 219)`);

// ---- Step 4: Write corrected PNG ----------------------------------------

console.log();
console.log("-".repeat(72));
console.log("Step 4 — Write corrected PNG");
console.log("-".repeat(72));

await sharp(corrected, { raw: { width, height, channels } })
  .png()
  .toFile(CORRECTED_PNG);

const correctedSize = (fs.statSync(CORRECTED_PNG).size / 1024).toFixed(1);
console.log(`  Wrote:  ${displayPath(CORRECTED_PNG)} (${correctedSize} KB)`);

// ---- Step 5: Render PDF -------------------------------------------------

console.log();
console.log("-".repeat(72));
console.log("Step 5 — Render PDF via renderPageWithTemplate (imagePathOverride)");
console.log("-".repeat(72));

const story = JSON.parse(fs.readFileSync(path.join(BOOK_DIR, "story.json"), "utf8"));
const irisP4 = story.scenes.find((s) => s.page === 4);

const tStart = Date.now();
const result = await renderPageWithTemplate({
  templateConfigPath: TEMPLATE_CONFIG,
  scene: { page: "02-v5-corrected-feathered", action: irisP4.action },
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
console.log("Feathered color-correction test complete. Upload PDF for visual judgment.");
console.log("=".repeat(72));
