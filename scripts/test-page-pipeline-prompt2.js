// scripts/test-page-pipeline-prompt2.js
// Integration test for the Stage-2 page-pipeline against prompt-2-iter-2
// (Type B template — static template CSS, no region detection, no auto-fit).
// Uses Mateo p9 narrative + v2_painted_edges image override (no Gemini call).
// Confirms the pipeline handles both Type A and Type B templates via the
// same entry function.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderPageWithTemplate } from "../src/page-pipeline.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, "..");

const BOOK_DIR = path.join(PROJECT_ROOT, "output", "books", "2026-05-17-mateo-0002");
const TEMPLATE_DIR = path.join(PROJECT_ROOT, "templates", "prompt-2-iter-2");

function displayPath(p) {
  if (!p) return null;
  return path.relative(PROJECT_ROOT, p).replace(/\\/g, "/");
}

const story = JSON.parse(fs.readFileSync(path.join(BOOK_DIR, "story.json"), "utf8"));
const scene = story.scenes.find((s) => s.page === 9);
const narrativeText = fs.readFileSync(path.join(BOOK_DIR, "pages", "page-09.txt"), "utf8").trim();

console.log();
console.log("=".repeat(72));
console.log("Page-pipeline integration test — Mateo p9 via prompt-2-iter-2 (Type B)");
console.log("=".repeat(72));
console.log();
console.log("Inputs:");
console.log(`  template config: ${displayPath(path.join(TEMPLATE_DIR, "config.json"))}`);
console.log(`  scene.page:      ${scene.page}`);
console.log(`  narrative:       ${narrativeText.length} chars`);
console.log(`  image override:  ${displayPath(path.join(TEMPLATE_DIR, "test-image-page-09-v2_painted_edges.png"))}`);

const result = await renderPageWithTemplate({
  templateConfigPath: path.join(TEMPLATE_DIR, "config.json"),
  scene,
  narrativeText,
  outputDir: TEMPLATE_DIR,
  imagePathOverride: path.join(TEMPLATE_DIR, "test-image-page-09-v2_painted_edges.png"),
});

console.log();
console.log("=".repeat(72));
console.log(`success: ${result.success}`);
if (result.error) console.log(`error:   ${result.error}`);
console.log("=".repeat(72));

const d = result.diagnostics;

console.log();
console.log("Diagnostics (Type B template — expect null for detection / conversion / autoFit / dynamicCss):");
console.log(`  regionDetection:  ${d.regionDetection === null ? "null (skipped — Type B)" : "(populated)"}`);
console.log(`  pagePtConversion: ${d.pagePtConversion === null ? "null (skipped — Type B)" : "(populated)"}`);
console.log(`  autoFit:          ${d.autoFit === null ? "null (skipped — Type B)" : "(populated)"}`);
console.log(`  dynamicCss:       ${d.dynamicCss === null ? "null (skipped — Type B)" : "(populated)"}`);
console.log(`  fontSize:         ${d.fontSize}pt  (from config.typography.fontSize, no iteration)`);

console.log();
console.log("Timing:");
console.log(`  imageGen:     ${d.timing.imageGenMs} ms`);
console.log(`  regionDetect: ${d.timing.regionDetectMs} ms  (expect 0 for Type B)`);
console.log(`  autoFit:      ${d.timing.autoFitMs} ms  (expect 0 for Type B)`);
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
