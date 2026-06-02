// scripts/test-page-pipeline.js
// Integration test for the Stage-2 page-pipeline. Uses Mateo p9 +
// prompt-3-iter-2 config + v4 image override (no Gemini call). Surfaces
// detection (pixels) + conversion (page-pt) + auto-fit + dynamic CSS so
// each step is traceable for visual debugging of the rendered PDF.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderPageWithTemplate } from "../src/page-pipeline.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, "..");

const BOOK_DIR = path.join(PROJECT_ROOT, "output", "books", "2026-05-17-mateo-0002");
const TEMPLATE_DIR = path.join(PROJECT_ROOT, "templates", "prompt-3-iter-2");

function displayPath(p) {
  if (!p) return null;
  return path.relative(PROJECT_ROOT, p).replace(/\\/g, "/");
}

const story = JSON.parse(fs.readFileSync(path.join(BOOK_DIR, "story.json"), "utf8"));
const scene = story.scenes.find((s) => s.page === 9);
const narrativeText = fs.readFileSync(path.join(BOOK_DIR, "pages", "page-09.txt"), "utf8").trim();

console.log();
console.log("=".repeat(72));
console.log("Page-pipeline integration test — Mateo p9 via prompt-3-iter-2");
console.log("=".repeat(72));
console.log();
console.log("Inputs:");
console.log(`  template config: ${displayPath(path.join(TEMPLATE_DIR, "config.json"))}`);
console.log(`  scene.page:      ${scene.page}`);
console.log(`  narrative:       ${narrativeText.length} chars`);
console.log(`  image override:  ${displayPath(path.join(TEMPLATE_DIR, "test-image-page-09-text-aware-zone-v4.png"))}`);

const result = await renderPageWithTemplate({
  templateConfigPath: path.join(TEMPLATE_DIR, "config.json"),
  scene,
  narrativeText,
  outputDir: TEMPLATE_DIR,
  imagePathOverride: path.join(TEMPLATE_DIR, "test-image-page-09-text-aware-zone-v4.png"),
});

console.log();
console.log("=".repeat(72));
console.log(`success: ${result.success}`);
if (result.error) console.log(`error:   ${result.error}`);
console.log("=".repeat(72));

const d = result.diagnostics;

if (d.regionDetection) {
  console.log();
  console.log("Region detection (source pixels):");
  console.log(`  x=${d.regionDetection.region.x}  y=${d.regionDetection.region.y}  w=${d.regionDetection.region.width}  h=${d.regionDetection.region.height}`);
  console.log(`  quality: creamDensity=${(d.regionDetection.quality.creamDensity * 100).toFixed(1)}%  score=${(d.regionDetection.quality.score * 100).toFixed(1)}%`);
  console.log(`  warnings: ${d.regionDetection.warnings.length === 0 ? "none" : d.regionDetection.warnings.join("; ")}`);
}

if (d.pagePtConversion) {
  console.log();
  console.log("Pixel → Page-point conversion (LOAD-BEARING — used for CSS positioning):");
  console.log(`  source image:   ${d.pagePtConversion.sourceImageDimensions.width} × ${d.pagePtConversion.sourceImageDimensions.height} px`);
  console.log(`  scale:          ${d.pagePtConversion.conversion.scale.toFixed(4)} (object-fit:cover, max of byH=${d.pagePtConversion.conversion.scaleByHeight.toFixed(4)} byW=${d.pagePtConversion.conversion.scaleByWidth.toFixed(4)})`);
  console.log(`  crop:           leftPt=${d.pagePtConversion.conversion.cropLeftPt.toFixed(2)}  topPt=${d.pagePtConversion.conversion.cropTopPt.toFixed(2)}`);
  console.log(`  source px:      x=${d.pagePtConversion.regionSourcePx.x}  y=${d.pagePtConversion.regionSourcePx.y}  w=${d.pagePtConversion.regionSourcePx.width}  h=${d.pagePtConversion.regionSourcePx.height}`);
  console.log(`  page pt:        x=${d.pagePtConversion.regionPagePt.x.toFixed(2)}  y=${d.pagePtConversion.regionPagePt.y.toFixed(2)}  w=${d.pagePtConversion.regionPagePt.width.toFixed(2)}  h=${d.pagePtConversion.regionPagePt.height.toFixed(2)}`);
  const pageW = d.pagePtConversion.conversion.pageWidthPt;
  const pageH = d.pagePtConversion.conversion.pageHeightPt;
  console.log(`  page pt (%):    x=${(d.pagePtConversion.regionPagePt.x / pageW * 100).toFixed(2)}%  y=${(d.pagePtConversion.regionPagePt.y / pageH * 100).toFixed(2)}%  w=${(d.pagePtConversion.regionPagePt.width / pageW * 100).toFixed(2)}%  h=${(d.pagePtConversion.regionPagePt.height / pageH * 100).toFixed(2)}%`);
}

if (d.autoFit) {
  console.log();
  console.log("Auto-fit:");
  console.log(`  fits:           ${d.autoFit.fits}`);
  console.log(`  fontSize:       ${d.autoFit.fontSize === null ? "null (no fit)" : `${d.autoFit.fontSize}pt`}`);
  console.log(`  lines:          ${d.autoFit.lines}`);
  console.log(`  iterations:     ${d.autoFit.iterations}`);
  console.log(`  rejectedSizes:  [${d.autoFit.rejectedSizes.join(", ")}]`);
  if (d.autoFit.measurement) {
    console.log(`  measurement:    heightPt=${d.autoFit.measurement.heightPt.toFixed(2)}  widthPt=${d.autoFit.measurement.widthPt.toFixed(2)}  actualMaxWidthPt=${d.autoFit.measurement.actualMaxWidthPt.toFixed(2)}`);
  }
}

if (d.dynamicCss) {
  console.log();
  console.log("Dynamic CSS injected (verbatim — what overrides template.html):");
  console.log(d.dynamicCss);
}

console.log();
console.log("Timing:");
console.log(`  imageGen:     ${d.timing.imageGenMs} ms`);
console.log(`  regionDetect: ${d.timing.regionDetectMs} ms`);
console.log(`  autoFit:      ${d.timing.autoFitMs} ms`);
console.log(`  render:       ${d.timing.renderMs} ms`);
console.log(`  TOTAL:        ${d.timing.totalMs} ms`);

console.log();
console.log(`Cost:  $${d.cost.toFixed(2)}`);
console.log(`Image: ${displayPath(result.imagePath)}`);
console.log(`PDF:   ${displayPath(result.pdfPath)}`);
if (result.pdfPath && fs.existsSync(result.pdfPath)) {
  const sz = (fs.statSync(result.pdfPath).size / 1024).toFixed(1);
  console.log(`PDF size: ${sz} KB`);
}
console.log();
