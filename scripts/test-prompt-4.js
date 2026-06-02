// scripts/test-prompt-4.js
// Two-part integration test for prompt-4-iter-1:
//   Part 1 — No-API: render Iris page 11 through prompt-4 via
//     imagePathOverride. Iris's page 11 image was composed for prompt-3's
//     centered-bottom layout, NOT prompt-4's upper-right anchor — so the
//     visual will be WRONG-LOOKING. The test is about pipeline mechanics:
//     does the template + page-pipeline render path produce a valid PDF
//     with text in the lower-left position? No Gemini cost.
//   Part 2 — Fresh Gemini call ($0.04): render Iris page 4 narrative
//     (216 chars, energetic action — matches prompt-4 aesthetic) through
//     prompt-4 with full image-gen. Validates the architecture path with
//     a composition fit for the asymmetric layout. Real visual test.

import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { renderPageWithTemplate } from "../src/page-pipeline.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, "..");

const BOOK_DIR = path.join(PROJECT_ROOT, "output", "books", "2026-05-20-iris-1230");
const TEMPLATE_DIR = path.join(PROJECT_ROOT, "templates", "prompt-4-iter-1");
const TEMPLATE_CONFIG = path.join(TEMPLATE_DIR, "config.json");
const TEST_OUT_DIR = path.join(TEMPLATE_DIR, "test-output");

function displayPath(p) {
  if (!p) return null;
  return path.relative(PROJECT_ROOT, p).replace(/\\/g, "/");
}

// Minimal name-mask inline (subset of generate-book.js's maskName — no
// "is a/an" fix needed for Iris's "Iris is five years old..." opener).
function maskName(text, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return text
    .replace(new RegExp(`\\b${escaped}(?:'s)?\\b`, "g"), "")
    .replace(/\s+/g, " ")
    .trim();
}

// Load Iris context
const story = JSON.parse(fs.readFileSync(path.join(BOOK_DIR, "story.json"), "utf8"));
const meta = JSON.parse(fs.readFileSync(path.join(BOOK_DIR, "meta.json"), "utf8"));
const characterName = meta.inputs.child.name;
const characterAge = meta.inputs.child.age;
const characterDescription = maskName(story.character, characterName);

console.log();
console.log("=".repeat(72));
console.log("prompt-4-iter-1 integration test — two parts");
console.log("=".repeat(72));

// ============================================================================
// Part 1 — No-API render via imagePathOverride
// ============================================================================

console.log();
console.log("-".repeat(72));
console.log("Part 1 — No-API render via imagePathOverride");
console.log("-".repeat(72));
console.log();
console.log("  Image: Iris's existing page-11.png (composed for prompt-3's");
console.log("         centered-bottom layout — NOT prompt-4's upper-right anchor).");
console.log("  Narrative: Iris page 11 (212 chars, tender bedtime).");
console.log("  Goal: validate prompt-4 template + page-pipeline render mechanics.");
console.log("  VISUAL WILL BE WRONG-LOOKING — the image's composition doesn't match");
console.log("  prompt-4's layout. This is a MECHANICAL test, not a visual judgment.");
console.log();

// Skip flag for iteration loops once Part 1's mechanical path is validated.
// Set SKIP_PART_1=1 to bypass Part 1 entirely and jump straight to Part 2.
const SKIP_PART_1 = process.env.SKIP_PART_1 === "1" || process.env.SKIP_PART_1 === "true";
let result1 = null;

fs.mkdirSync(TEST_OUT_DIR, { recursive: true });

if (SKIP_PART_1) {
  console.log("  Skipped (SKIP_PART_1 set). Part 1 mechanical validation already passed in v1.");
} else {
  const irisP11 = story.scenes.find((s) => s.page === 11);

  const t1Start = Date.now();
  result1 = await renderPageWithTemplate({
    templateConfigPath: TEMPLATE_CONFIG,
    scene: { page: 1, action: irisP11.action },
    narrativeText: irisP11.narrative_text,
    outputDir: TEST_OUT_DIR,
    imagePathOverride: path.join(BOOK_DIR, "pages", "page-11.png"),
  });
  const t1Ms = Date.now() - t1Start;

  console.log("Part 1 result:");
  console.log(`  success:  ${result1.success}`);
  if (result1.error) console.log(`  error:    ${result1.error}`);
  console.log(`  fontSize: ${result1.diagnostics.fontSize}pt`);
  console.log(`  cost:     $${result1.diagnostics.cost.toFixed(2)}`);
  console.log(`  duration: ${(t1Ms / 1000).toFixed(1)}s`);
  console.log(`  pdfPath:  ${displayPath(result1.pdfPath)}`);
  if (result1.pdfPath && fs.existsSync(result1.pdfPath)) {
    const sz = (fs.statSync(result1.pdfPath).size / 1024).toFixed(1);
    console.log(`  PDF size: ${sz} KB`);
  }

  if (!result1.success) {
    console.error();
    console.error(`Part 1 FAILED — template/pipeline path broken. Not proceeding to Part 2.`);
    process.exit(1);
  }

  console.log();
  console.log("  Part 1 PASSED mechanically. Visual unfitness expected.");
}

// ============================================================================
// Part 2 — Fresh Gemini call ($0.04)
// ============================================================================

console.log();
console.log("-".repeat(72));
console.log("Part 2 — Fresh Gemini call ($0.04)");
console.log("-".repeat(72));
console.log();
console.log("  Narrative: Iris page 4 (216 chars, energetic/action — fits prompt-4).");
console.log("  Image: fresh generation via prompt-4 compositionPromptTemplate.");
console.log("  Goal: validate full architecture against the new template.");
console.log(`  Cost: ~$0.04 (1 Gemini call).`);
console.log();

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const answer = await rl.question("Type CONFIRM to proceed with the paid call (anything else aborts): ");
rl.close();

if (answer.trim() !== "CONFIRM") {
  console.log();
  console.log("Aborted. Part 1 result preserved on disk.");
  process.exit(0);
}

// Load Iris's character sheets (already on disk)
const sheetsDir = path.join(BOOK_DIR, "character-sheets");
const sheetBuffers = ["sheet-01.png", "sheet-02.png", "sheet-03.png"]
  .map((f) => fs.readFileSync(path.join(sheetsDir, f)));

const irisP4 = story.scenes.find((s) => s.page === 4);

const t2Start = Date.now();
const result2 = await renderPageWithTemplate({
  templateConfigPath: TEMPLATE_CONFIG,
  scene: { page: "02-v5", action: irisP4.action },
  narrativeText: irisP4.narrative_text,
  characterDescription,
  characterAge,
  characterSheets: sheetBuffers,
  sceneStyle: story.style,
  sceneNegativePrompt: story.negative_prompt,
  outputDir: TEST_OUT_DIR,
});
const t2Ms = Date.now() - t2Start;

console.log();
console.log("Part 2 result:");
console.log(`  success:    ${result2.success}`);
if (result2.error) console.log(`  error:      ${result2.error}`);
console.log(`  fontSize:   ${result2.diagnostics.fontSize}pt`);
console.log(`  cost:       $${result2.diagnostics.cost.toFixed(2)}`);
console.log(`  Timing:`);
console.log(`    imageGen:     ${result2.diagnostics.timing.imageGenMs} ms`);
console.log(`    regionDetect: ${result2.diagnostics.timing.regionDetectMs} ms  (expect 0 for Type B)`);
console.log(`    autoFit:      ${result2.diagnostics.timing.autoFitMs} ms  (expect 0 for Type B)`);
console.log(`    render:       ${result2.diagnostics.timing.renderMs} ms`);
console.log(`    TOTAL:        ${result2.diagnostics.timing.totalMs} ms  (${(t2Ms / 1000).toFixed(1)}s wall)`);
console.log(`  imagePath:  ${displayPath(result2.imagePath)}`);
if (result2.imagePath && fs.existsSync(result2.imagePath)) {
  const sz = (fs.statSync(result2.imagePath).size / 1024).toFixed(1);
  console.log(`  PNG size:   ${sz} KB`);
}
console.log(`  pdfPath:    ${displayPath(result2.pdfPath)}`);
if (result2.pdfPath && fs.existsSync(result2.pdfPath)) {
  const sz = (fs.statSync(result2.pdfPath).size / 1024).toFixed(1);
  console.log(`  PDF size:   ${sz} KB`);
}

if (!result2.success) {
  console.error();
  console.error(`Part 2 FAILED — ${result2.error}`);
  process.exit(1);
}

console.log();
console.log("=".repeat(72));
const totalCost = (result1?.diagnostics?.cost ?? 0) + result2.diagnostics.cost;
console.log("Both tests complete. Cost: $" + totalCost.toFixed(2));
console.log("=".repeat(72));
console.log();
console.log("Upload Part 2's PDF for visual judgment of prompt-4's architectural fit.");
console.log("Part 1's PDF available if needed but mechanical-only validation.");
console.log();
