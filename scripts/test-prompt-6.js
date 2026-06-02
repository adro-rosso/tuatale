// scripts/test-prompt-6.js
// Two-part integration test for prompt-6-iter-1 (climactic full-bleed):
//   Part 1 — No-API: render Iris page 2 narrative (168 chars) through
//     prompt-6 via imagePathOverride pointing at Iris's page-02.png.
//     The image is split-spread composition, NOT prompt-6's full-bleed,
//     so visual will be wrong-looking. Mechanical test only — does the
//     template + page-pipeline render path produce a valid PDF with
//     text overlay on translucent cream band?
//   Part 2 — Fresh Gemini call ($0.04): render a 190-char climactic
//     cut of Iris page 3 narrative through prompt-6 with full-bleed
//     image-gen. Validates the architecture against a composition fit
//     for the climactic template.

import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { renderPageWithTemplate } from "../src/page-pipeline.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, "..");

const BOOK_DIR = path.join(PROJECT_ROOT, "output", "books", "2026-05-20-iris-1230");
const TEMPLATE_DIR = path.join(PROJECT_ROOT, "templates", "prompt-6-iter-1");
const TEMPLATE_CONFIG = path.join(TEMPLATE_DIR, "config.json");
const TEST_OUT_DIR = path.join(TEMPLATE_DIR, "test-output");

// Climactic-preserving cut of Iris p3 narrative (257 → 190 chars).
// Drops the philosophical "as if..." closer; keeps the "But tonight"
// dramatic pivot + the twinkle-vs-steady contrast that makes the
// moment specifically climactic.
const CLIMACTIC_P3_CUT =
  "But tonight — there is something new. A light she has never seen before, low and steady and much brighter than the rest. It does not twinkle the way stars do. It just shines, calm and still.";

function displayPath(p) {
  if (!p) return null;
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
const meta = JSON.parse(fs.readFileSync(path.join(BOOK_DIR, "meta.json"), "utf8"));
const characterName = meta.inputs.child.name;
const characterAge = meta.inputs.child.age;
const characterDescription = maskName(story.character, characterName);

console.log();
console.log("=".repeat(72));
console.log("prompt-6-iter-1 integration test — two parts");
console.log("=".repeat(72));

const SKIP_PART_1 = process.env.SKIP_PART_1 === "1" || process.env.SKIP_PART_1 === "true";
let result1 = null;

fs.mkdirSync(TEST_OUT_DIR, { recursive: true });

// ============================================================================
// Part 1 — No-API render via imagePathOverride
// ============================================================================

console.log();
console.log("-".repeat(72));
console.log("Part 1 — No-API render via imagePathOverride");
console.log("-".repeat(72));

if (SKIP_PART_1) {
  console.log();
  console.log("  Skipped (SKIP_PART_1 set).");
} else {
  console.log();
  console.log("  Image: Iris's existing page-02.png (composed for prompt-3's");
  console.log("         text-in-painted-clearing layout — NOT prompt-6's full-bleed).");
  console.log("  Narrative: Iris page 2 (168 chars, notebook moment).");
  console.log("  Goal: validate prompt-6 template + page-pipeline render mechanics.");
  console.log("  VISUAL WILL BE WRONG-LOOKING — image composition doesn't match");
  console.log("  prompt-6's full-bleed intent. MECHANICAL test only.");
  console.log();

  const irisP2 = story.scenes.find((s) => s.page === 2);

  const t1Start = Date.now();
  result1 = await renderPageWithTemplate({
    templateConfigPath: TEMPLATE_CONFIG,
    scene: { page: 1, action: irisP2.action },
    narrativeText: irisP2.narrative_text,
    outputDir: TEST_OUT_DIR,
    imagePathOverride: path.join(BOOK_DIR, "pages", "page-02.png"),
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
console.log("  Narrative: Iris p3 climactic cut (190 chars — discovery moment).");
console.log("  Scene action: Iris standing on bed, finger pointing at new bright light.");
console.log("  Image: fresh generation via prompt-6 compositionPromptTemplate (full-bleed).");
console.log("  Goal: validate prompt-6 architecture against a climactic composition.");
console.log(`  Cost: ~$0.04 (1 Gemini call).`);
console.log();

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const answer = await rl.question("Type CONFIRM to proceed with the paid call (anything else aborts): ");
rl.close();

if (answer.trim() !== "CONFIRM") {
  console.log();
  console.log("Aborted.");
  process.exit(0);
}

const sheetsDir = path.join(BOOK_DIR, "character-sheets");
const sheetBuffers = ["sheet-01.png", "sheet-02.png", "sheet-03.png"]
  .map((f) => fs.readFileSync(path.join(sheetsDir, f)));

const irisP3 = story.scenes.find((s) => s.page === 3);

const t2Start = Date.now();
const result2 = await renderPageWithTemplate({
  templateConfigPath: TEMPLATE_CONFIG,
  scene: { page: 2, action: irisP3.action },
  narrativeText: CLIMACTIC_P3_CUT,
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

const totalCost = (result1?.diagnostics?.cost ?? 0) + result2.diagnostics.cost;
console.log();
console.log("=".repeat(72));
console.log("Both tests complete. Cost: $" + totalCost.toFixed(2));
console.log("=".repeat(72));
console.log();
console.log("Upload Part 2's PDF for visual judgment of prompt-6's architectural fit.");
console.log();
