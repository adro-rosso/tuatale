// scripts/test-prompt-3-phase2.js
// Phase 2 of the prompt-3-iter-2 region-detection investigation.
// Regenerates the 4 scenes that escalated B-class in the 1104 book
// (pages 2, 4, 5, 11) through the FIXED composition prompt (contained-
// vignette / blank-cream-zone rewrite, 2026-05-21) and measures whether
// region detection now passes first-try.
//
// Cost: ~$0.16 (4 fresh Gemini calls). Character sheets reused from the
// 1104 book dir (no API call). 6s pacing between calls.

import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderPageWithTemplate } from "../src/page-pipeline.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, "..");
const BOOK_DIR = path.join(PROJECT_ROOT, "output", "books", "2026-05-21-iris-1104");
const TEMPLATE_CONFIG = path.join(PROJECT_ROOT, "templates", "prompt-3-iter-2", "config.json");
const OUT_DIR = path.join(PROJECT_ROOT, "templates", "prompt-3-iter-2", "test-output", "phase2");

// The 4 pages that escalated B-class in the 1104 book run.
const ESCALATED_PAGES = [2, 4, 5, 11];
const PACING_MS = 6000;

function displayPath(p) {
  return path.relative(PROJECT_ROOT, p).replace(/\\/g, "/");
}

function maskName(text, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return text
    .replace(new RegExp(`\\b${escaped}(?:'s)?\\b`, "g"), "")
    .replace(/\s+/g, " ")
    .trim();
}

const story = JSON.parse(fs.readFileSync(path.join(BOOK_DIR, "story.json"), "utf8"));
const config = JSON.parse(fs.readFileSync(TEMPLATE_CONFIG, "utf8"));
const minSize = config.regionDetection.minSizePx;
const characterDescription = maskName(story.character, "Iris");

const sheetsDir = path.join(BOOK_DIR, "character-sheets");
const sheetBuffers = ["sheet-01.png", "sheet-02.png", "sheet-03.png"]
  .map((f) => fs.readFileSync(path.join(sheetsDir, f)));

fs.mkdirSync(OUT_DIR, { recursive: true });

console.log();
console.log("=".repeat(72));
console.log("Phase 2 — prompt-3-iter-2 region-detection fix measurement");
console.log("=".repeat(72));
console.log();
console.log(`Regenerating 4 previously-escalated scenes through fixed prompt.`);
console.log(`minSizePx: ${minSize.width}×${minSize.height} · ~$0.16 · 6s pacing`);

const results = [];
for (let i = 0; i < ESCALATED_PAGES.length; i++) {
  const pageNum = ESCALATED_PAGES[i];
  const scene = story.scenes.find((s) => s.page === pageNum);

  console.log();
  console.log("-".repeat(72));
  console.log(`Scene ${i + 1}/4 — page ${pageNum} (${scene.narrative_text.length} chars)`);
  console.log("-".repeat(72));
  console.log(`  Action: ${scene.action.slice(0, 100)}${scene.action.length > 100 ? "..." : ""}`);

  const tStart = Date.now();
  const result = await renderPageWithTemplate({
    templateConfigPath: TEMPLATE_CONFIG,
    scene: { page: pageNum, action: scene.action },
    narrativeText: scene.narrative_text,
    characterDescription,
    characterAge: 5,
    characterSheets: sheetBuffers,
    sceneStyle: story.style,
    sceneNegativePrompt: story.negative_prompt,
    outputDir: OUT_DIR,
  });
  const wallMs = Date.now() - tStart;

  const rd = result.diagnostics.regionDetection;
  let regionW = null, regionH = null;
  if (rd && rd.region) {
    regionW = Math.round(rd.region.width);
    regionH = Math.round(rd.region.height);
  }

  results.push({ pageNum, result, wallMs, regionW, regionH });

  console.log();
  console.log(`  region detection: ${result.success ? "PASS" : "FAIL (would escalate)"}`);
  if (regionW !== null) {
    console.log(`  detected region:  ${regionW}×${regionH} px  (minSizePx ${minSize.width}×${minSize.height})`);
    console.log(`    width  ${regionW} >= ${minSize.width}: ${regionW >= minSize.width ? "PASS" : "FAIL"}`);
    console.log(`    height ${regionH} >= ${minSize.height}: ${regionH >= minSize.height ? "PASS" : "FAIL"}`);
  }
  if (result.error) console.log(`  error:    ${result.error}`);
  if (result.success) console.log(`  fontSize: ${result.diagnostics.fontSize}pt`);
  console.log(`  cost:     $${result.diagnostics.cost.toFixed(2)}`);
  console.log(`  wall:     ${(wallMs / 1000).toFixed(1)}s`);
  if (result.imagePath && fs.existsSync(result.imagePath)) {
    console.log(`  PNG:      ${displayPath(result.imagePath)}`);
  }
  if (result.pdfPath && fs.existsSync(result.pdfPath)) {
    console.log(`  PDF:      ${displayPath(result.pdfPath)}`);
  }

  if (i < ESCALATED_PAGES.length - 1) {
    console.log(`  (pacing — ${PACING_MS / 1000}s)`);
    await new Promise((r) => setTimeout(r, PACING_MS));
  }
}

// ---- Summary -------------------------------------------------------------

const passCount = results.filter((r) => r.result.success).length;
const totalCost = results.reduce((s, r) => s + (r.result.diagnostics?.cost ?? 0), 0);

console.log();
console.log("=".repeat(72));
console.log(`Phase 2 result: ${passCount}/4 passed region detection first-try`);
console.log("=".repeat(72));
for (const r of results) {
  const status = r.result.success ? "PASS" : "FAIL→escalate";
  const dims = r.regionW !== null ? `${r.regionW}×${r.regionH}` : "(no region)";
  console.log(`  page ${String(r.pageNum).padStart(2)}: ${status.padEnd(14)} detected ${dims}`);
}
console.log();
console.log(`  Total cost: $${totalCost.toFixed(2)}`);
console.log();
console.log("PNGs/PDFs for aesthetic judgment (does the contained vignette still");
console.log("read intimate without the old decorative framing?):");
for (const r of results) {
  if (r.result.pdfPath) console.log(`  - ${displayPath(r.result.pdfPath)}`);
  else if (r.result.imagePath) console.log(`  - ${displayPath(r.result.imagePath)} (PNG only — region failed)`);
}
console.log();
