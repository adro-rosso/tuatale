// scripts/test-region-detection.js
// Validation suite for src/region-detection.js. Runs detection against the
// existing v2 + v3 prompt-3-iter-2 images, prints full diagnostics, and
// writes validation PNGs with red translucent overlay marking the detected
// region for visual confirmation.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { detectCleanRegion } from "../src/region-detection.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, "..");
const TEMPLATE_DIR = path.join(PROJECT_ROOT, "templates", "prompt-3-iter-2");

function displayPath(p) {
  return path.relative(PROJECT_ROOT, p).replace(/\\/g, "/");
}

// Compose original image + translucent red rect over the detected region.
async function writeValidationPng({ imagePath, region, outputPath }) {
  const overlay = await sharp({
    create: {
      width: region.width,
      height: region.height,
      channels: 4,
      background: { r: 255, g: 0, b: 0, alpha: 0.35 },
    },
  })
    .png()
    .toBuffer();
  await sharp(imagePath)
    .composite([{ input: overlay, top: region.y, left: region.x, blend: "over" }])
    .png()
    .toFile(outputPath);
}

async function runTest({ name, imagePath, roi, minSizePx }) {
  console.log();
  console.log(`---- ${name} ----`);
  console.log(`  image: ${displayPath(imagePath)}`);
  console.log(`  ROI:   x=${roi.x} y=${roi.y} w=${roi.width} h=${roi.height} (fractional)`);

  if (!fs.existsSync(imagePath)) {
    console.error(`  FAIL: image not found`);
    return;
  }

  const result = await detectCleanRegion({
    imagePath,
    roi,
    creamTarget: "#F0E8D8",
    creamDistance: 30,
    minSizePx,
  });

  console.log();
  console.log("  Region (image pixels):");
  console.log(`    x=${result.region.x}  y=${result.region.y}  w=${result.region.width}  h=${result.region.height}`);
  console.log("  Region (% of image):");
  console.log(`    xPct=${result.region.xPct.toFixed(2)}%  yPct=${result.region.yPct.toFixed(2)}%  widthPct=${result.region.widthPct.toFixed(2)}%  heightPct=${result.region.heightPct.toFixed(2)}%`);
  console.log("  Quality:");
  console.log(`    creamDensity: ${(result.quality.creamDensity * 100).toFixed(1)}%`);
  console.log(`    paddingPx:    top=${result.quality.paddingPx.top}  right=${result.quality.paddingPx.right}  bottom=${result.quality.paddingPx.bottom}  left=${result.quality.paddingPx.left}`);
  console.log(`    score:        ${(result.quality.score * 100).toFixed(1)}%`);
  console.log("  Diagnostics:");
  console.log(`    roiPixelBounds: x=${result.diagnostics.roiPixelBounds.x}  y=${result.diagnostics.roiPixelBounds.y}  w=${result.diagnostics.roiPixelBounds.width}  h=${result.diagnostics.roiPixelBounds.height}`);
  console.log(`    pixelsAnalyzed:    ${result.diagnostics.pixelsAnalyzed}`);
  console.log(`    creamPixelsFound:  ${result.diagnostics.creamPixelsFound}  (${(result.diagnostics.creamPixelsFound / result.diagnostics.pixelsAnalyzed * 100).toFixed(1)}% of ROI)`);
  if (result.warnings.length > 0) {
    console.log("  Warnings:");
    result.warnings.forEach((w) => console.log(`    - ${w}`));
  } else {
    console.log("  Warnings: none");
  }

  const outName = `_region-detection-${name.toLowerCase().replace(/\s+/g, "-")}.png`;
  const outPath = path.join(TEMPLATE_DIR, outName);
  await writeValidationPng({ imagePath, region: result.region, outputPath: outPath });
  console.log(`  Validation PNG: ${displayPath(outPath)}`);
}

const ROI = { x: 0.05, y: 0.55, width: 0.90, height: 0.40 };
const MIN_SIZE = { width: 400, height: 100 };

console.log();
console.log("=".repeat(72));
console.log("Region-detection primitive — validation suite");
console.log("=".repeat(72));

await runTest({
  name: "v2",
  imagePath: path.join(TEMPLATE_DIR, "test-image-page-09-text-aware-zone-v2.png"),
  roi: ROI,
  minSizePx: MIN_SIZE,
});

await runTest({
  name: "v3",
  imagePath: path.join(TEMPLATE_DIR, "test-image-page-09-text-aware-zone-v3.png"),
  roi: ROI,
  minSizePx: MIN_SIZE,
});

await runTest({
  name: "v4",
  imagePath: path.join(TEMPLATE_DIR, "test-image-page-09-text-aware-zone-v4.png"),
  roi: ROI,
  minSizePx: MIN_SIZE,
});

console.log();
console.log("=".repeat(72));
console.log("Done. Open the validation PNGs to confirm the detected regions visually.");
console.log("=".repeat(72));
console.log();
