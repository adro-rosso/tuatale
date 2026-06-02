// scripts/test-auto-fit.js
// Validation suite for src/auto-fit.js. Three cases exercise:
//   - "narrative too big for region" (Mateo p9 at v4 detected region)
//   - "region too narrow" (Mateo p9 at v2 detected region)
//   - "narrative fits at max size" (shorter Mateo scene at v4 region)

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fitTextToRegion } from "../src/auto-fit.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, "..");

async function runTest(name, opts, expected) {
  console.log();
  console.log(`---- ${name} ----`);
  console.log(`  text:        ${opts.text.length} chars`);
  console.log(`  region:      ${opts.region.width}pt × ${opts.region.height}pt`);
  console.log(`  typography:  ${opts.fontFamily} lh=${opts.lineHeight} max=${opts.maxFontSize}pt min=${opts.minFontSize}pt`);
  console.log(`  expected:    ${expected}`);

  const t0 = Date.now();
  const result = await fitTextToRegion(opts);
  const ms = Date.now() - t0;

  console.log();
  console.log(`  fits:           ${result.fits}`);
  console.log(`  fontSize:       ${result.fontSize === null ? "null (no fit)" : `${result.fontSize}pt`}`);
  console.log(`  iterations:     ${result.iterations}`);
  console.log(`  rejectedSizes:  [${result.rejectedSizes.join(", ")}]`);
  if (result.measurement) {
    console.log(`  measurement:`);
    console.log(`    lines:             ${result.measurement.lines}`);
    console.log(`    heightPt:          ${result.measurement.heightPt.toFixed(2)}  vs region.height ${opts.region.height}  (${result.measurement.heightPt <= opts.region.height ? "FITS" : "OVERFLOWS"})`);
    console.log(`    widthPt:           ${result.measurement.widthPt.toFixed(2)}  (actual text extent)`);
    console.log(`    actualMaxWidthPt:  ${result.measurement.actualMaxWidthPt.toFixed(2)}  (resolved container width)`);
  }
  console.log(`  wall time:      ${(ms / 1000).toFixed(1)}s  (${(ms / result.iterations / 1000).toFixed(2)}s/iter)`);
}

const mateoP9 = fs.readFileSync(
  path.join(PROJECT_ROOT, "output/books/2026-05-17-mateo-0002/pages/page-09.txt"),
  "utf8"
).trim();

const mateoP5 = fs.readFileSync(
  path.join(PROJECT_ROOT, "output/books/2026-05-17-mateo-0002/pages/page-05.txt"),
  "utf8"
).trim();

console.log();
console.log("=".repeat(72));
console.log("Auto-fit primitive — validation suite");
console.log("=".repeat(72));

// Test 1: Mateo p9 (504 chars) at v4 detected region (468pt × 132pt)
await runTest(
  "Test 1 — Mateo p9 at v4 detected region (468 × 132 pt)",
  {
    text: mateoP9,
    region: { width: 468, height: 132 },
    fontFamily: "Architects Daughter",
    lineHeight: 1.6,
    maxFontSize: 16,
    minFontSize: 10,
    letterSpacing: "0.01em",
  },
  "Predicted: fits=true at fontSize 10-12, or possibly fits=false"
);

// Test 2: Mateo p9 at v2 detected region (267pt × 143pt — much narrower)
await runTest(
  "Test 2 — Mateo p9 at v2 detected region (267 × 143 pt)",
  {
    text: mateoP9,
    region: { width: 267, height: 143 },
    fontFamily: "Architects Daughter",
    lineHeight: 1.6,
    maxFontSize: 16,
    minFontSize: 10,
    letterSpacing: "0.01em",
  },
  "Predicted: fits=false (region too narrow for 504 chars in 143pt height even at 10pt)"
);

// Test 3: Mateo p5 (shorter scene, ~320 chars) at v4 region
await runTest(
  "Test 3 — Mateo p5 (shorter scene) at v4 detected region (468 × 132 pt)",
  {
    text: mateoP5,
    region: { width: 468, height: 132 },
    fontFamily: "Architects Daughter",
    lineHeight: 1.6,
    maxFontSize: 16,
    minFontSize: 10,
    letterSpacing: "0.01em",
  },
  "Predicted: fits=true at fontSize 14-16 (shorter text wraps to fewer lines)"
);

console.log();
console.log("=".repeat(72));
console.log("Done.");
console.log("=".repeat(72));
console.log();
