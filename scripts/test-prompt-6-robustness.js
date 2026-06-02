// scripts/test-prompt-6-robustness.js
// Render the prompt-6 climax page from each of 3 validated Iris stories
// (1021, 1051, 1104) through full Gemini gen + prompt-6 template render.
// Tests whether prompt-6's full-bleed layout holds across genuinely
// different climactic content.
//
// Cost: ~$0.12 (3 × $0.04 fresh Gemini calls). Character sheets +
// description + style + negative_prompt all pulled from BASELINE Iris
// book (output/books/2026-05-20-iris-1230/) to keep the protagonist
// consistent across all 3 renders — isolates the layout variable from
// character-mismatch noise. Only the scene's action + narrative_text
// vary per render. Layout-robustness test, not character-consistency
// test (though character will be consistent here as a side effect).

import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderPageWithTemplate } from "../src/page-pipeline.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, "..");
const BASELINE_BOOK_DIR = path.join(PROJECT_ROOT, "output", "books", "2026-05-20-iris-1230");
const BASELINE_STORY_PATH = path.join(BASELINE_BOOK_DIR, "story.json");
const TEMPLATE_CONFIG = path.join(PROJECT_ROOT, "templates", "prompt-6-iter-1", "config.json");
const OUT_DIR = path.join(PROJECT_ROOT, "templates", "prompt-6-iter-1", "test-output", "robustness");

const RUNS = [
  { runId: "1021", storyPath: "output/stories/2026-05-21-iris-1021/story.json", climaxPage: 9 },
  { runId: "1051", storyPath: "output/stories/2026-05-21-iris-1051/story.json", climaxPage: 10 },
  { runId: "1104", storyPath: "output/stories/2026-05-21-iris-1104/story.json", climaxPage: 10 },
];

// 6-second pacing between Gemini calls — mirrors generate-book.js's
// MIN_GEMINI_CALL_GAP_MS pattern. Avoids hammering the API.
const PACING_MS = 6000;

function maskName(text, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return text
    .replace(new RegExp(`\\b${escaped}(?:'s)?\\b`, "g"), "")
    .replace(/\s+/g, " ")
    .trim();
}

function displayPath(p) {
  return path.relative(PROJECT_ROOT, p).replace(/\\/g, "/");
}

// ---- Load baseline (consistent across all 3 renders) --------------------

const baselineStory = JSON.parse(fs.readFileSync(BASELINE_STORY_PATH, "utf8"));
const baselineCharacterDescription = maskName(baselineStory.character, "Iris");
const baselineStyle = baselineStory.style;
const baselineNegativePrompt = baselineStory.negative_prompt;

const sheetsDir = path.join(BASELINE_BOOK_DIR, "character-sheets");
const sheetBuffers = ["sheet-01.png", "sheet-02.png", "sheet-03.png"]
  .map((f) => fs.readFileSync(path.join(sheetsDir, f)));

fs.mkdirSync(OUT_DIR, { recursive: true });

console.log();
console.log("=".repeat(72));
console.log("prompt-6-iter-1 render-robustness test (3 climactic scenes, ~$0.12)");
console.log("=".repeat(72));
console.log();
console.log(`Baseline character: ${baselineStory.character.slice(0, 80)}...`);
console.log(`Output:             ${displayPath(OUT_DIR)}/`);
console.log(`Pacing:             ${PACING_MS / 1000}s between Gemini calls`);

// ---- Run each render -----------------------------------------------------

const results = [];
for (let i = 0; i < RUNS.length; i++) {
  const run = RUNS[i];
  const storyAbsPath = path.join(PROJECT_ROOT, run.storyPath);
  const story = JSON.parse(fs.readFileSync(storyAbsPath, "utf8"));
  const scene = story.scenes.find((s) => s.page === run.climaxPage);

  if (!scene) {
    console.error(`FAIL: ${run.runId} has no page ${run.climaxPage}`);
    process.exit(1);
  }
  if (scene.layout_intent.template_id !== "prompt-6-iter-1") {
    console.error(`FAIL: ${run.runId} page ${run.climaxPage} layout_intent is ${scene.layout_intent.template_id}, expected prompt-6-iter-1`);
    process.exit(1);
  }

  console.log();
  console.log("-".repeat(72));
  console.log(`Render ${i + 1}/3 — ${run.runId} page ${run.climaxPage} (${scene.narrative_text.length} chars)`);
  console.log("-".repeat(72));
  console.log(`  Action:    ${scene.action.slice(0, 100)}${scene.action.length > 100 ? "..." : ""}`);
  console.log(`  Narrative: ${scene.narrative_text.slice(0, 100)}${scene.narrative_text.length > 100 ? "..." : ""}`);

  const tStart = Date.now();
  const result = await renderPageWithTemplate({
    templateConfigPath: TEMPLATE_CONFIG,
    scene: {
      page: `${run.runId}-p${String(run.climaxPage).padStart(2, "0")}`,
      action: scene.action,
    },
    narrativeText: scene.narrative_text,
    characterDescription: baselineCharacterDescription,
    characterAge: 5,
    characterSheets: sheetBuffers,
    sceneStyle: baselineStyle,
    sceneNegativePrompt: baselineNegativePrompt,
    outputDir: OUT_DIR,
  });
  const wallMs = Date.now() - tStart;
  results.push({ ...run, result, wallMs });

  console.log();
  console.log(`  success:   ${result.success}`);
  if (result.error) console.log(`  error:     ${result.error}`);
  console.log(`  fontSize:  ${result.diagnostics.fontSize}pt`);
  console.log(`  cost:      $${result.diagnostics.cost.toFixed(2)}`);
  console.log(`  wall:      ${(wallMs / 1000).toFixed(1)}s`);
  if (result.imagePath && fs.existsSync(result.imagePath)) {
    const sz = (fs.statSync(result.imagePath).size / 1024).toFixed(1);
    console.log(`  PNG:       ${displayPath(result.imagePath)} (${sz} KB)`);
  }
  if (result.pdfPath && fs.existsSync(result.pdfPath)) {
    const sz = (fs.statSync(result.pdfPath).size / 1024).toFixed(1);
    console.log(`  PDF:       ${displayPath(result.pdfPath)} (${sz} KB)`);
  }

  if (i < RUNS.length - 1) {
    console.log(`  (pacing — sleeping ${PACING_MS / 1000}s before next call)`);
    await new Promise((r) => setTimeout(r, PACING_MS));
  }
}

// ---- Summary -------------------------------------------------------------

const successCount = results.filter((r) => r.result.success).length;
const totalCost = results.reduce((s, r) => s + (r.result.diagnostics?.cost ?? 0), 0);
const totalWall = results.reduce((s, r) => s + r.wallMs, 0);

console.log();
console.log("=".repeat(72));
console.log("Render-robustness test complete.");
console.log("=".repeat(72));
console.log(`  Successful renders: ${successCount} / ${results.length}`);
console.log(`  Total cost:         $${totalCost.toFixed(2)}`);
console.log(`  Total wall:         ${(totalWall / 1000).toFixed(1)}s`);
console.log();
console.log("PDFs for visual judgment:");
for (const r of results) {
  if (r.result.pdfPath) console.log(`  - ${displayPath(r.result.pdfPath)}`);
}
console.log();
