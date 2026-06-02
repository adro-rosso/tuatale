// scripts/stress-vertical-split.js
// N=3 second-pass validation for the vertical-split prototype. Renders
// 2 fresh scenes via the same 3:4 portrait pin + prototype layout:
//
//   Scene 2 (vertical confirmation — easy): towering tree, looking up.
//     Tests whether the easy case repeats reliably across different
//     naturally-vertical content (tree, not just sky/stars).
//
//   Scene 3 (genuine stress — no natural vertical): Iris seated on
//     bedroom rug looking DOWN at a book in her lap. Forces Gemini to
//     find a vertical interpretation of a compact, low, looking-down
//     scene. The N=1 looking-UP success could be Gemini's happy path;
//     this tests whether portrait pin + vertical composition prompt
//     produces well-composed output when the SCENE itself doesn't
//     naturally suggest vertical emphasis.
//
// Cost: ~$0.04 × 2 = ~$0.08.

import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { renderPageWithTemplate } from "../src/page-pipeline.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, "..");

const PROTOTYPE_DIR    = path.join(PROJECT_ROOT, "templates", "_vertical-split-prototype");
const TEMPLATE_CONFIG  = path.join(PROTOTYPE_DIR, "config.json");
const BOOK_DIR         = path.join(PROJECT_ROOT, "output", "books", "2026-05-22-iris-1333");
const SHEETS_DIR       = path.join(BOOK_DIR, "character-sheets");
const STORY_PATH       = path.join(BOOK_DIR, "story.json");
const META_PATH        = path.join(BOOK_DIR, "meta.json");

const story = JSON.parse(fs.readFileSync(STORY_PATH, "utf8"));
const meta  = JSON.parse(fs.readFileSync(META_PATH, "utf8"));
const characterName = meta.inputs.child.name;
const characterAge  = meta.inputs.child.age;

function maskName(text, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return text
    .replace(new RegExp(`\\b${escaped}(?:'s)?\\b`, "g"), "")
    .replace(/\s+/g, " ")
    .trim();
}
const characterDescription = maskName(story.character, characterName);

function displayPath(p) {
  return path.relative(PROJECT_ROOT, p).replace(/\\/g, "/");
}

const SCENES = [
  {
    page: 2,
    label: "VERTICAL CONFIRMATION — towering tree, looking up",
    action:
      "Iris stands at the base of an enormous old tree in the forest, leaning back to look UP its tall trunk toward the canopy high above, the small patches of sky visible between the topmost leaves.",
    narrative_text:
      "She tipped her head all the way back. The tree went up forever. Past her tallest reach, past where the squirrels lived, past every branch, all the way up to where the sky waited between the leaves at the very top.",
  },
  {
    page: 3,
    label: "STRESS — bedroom reading, no natural vertical",
    action:
      "Iris sits cross-legged on the soft rug in her bedroom, an open picture book balanced in her lap, leaning forward with her hair falling around her face to look closely at the pages.",
    narrative_text:
      "She turned the page slowly, one finger marking her place. The story was quiet today. The rug was warm under her knees. Outside the window, the afternoon was going on without her, and she did not mind a bit.",
  },
];

console.log();
console.log("=".repeat(72));
console.log("VERTICAL-SPLIT stress pass — N=3 (renders 2 + 3)");
console.log("=".repeat(72));
console.log();
console.log(`  Template:    ${displayPath(TEMPLATE_CONFIG)}`);
console.log(`  Aspect pin:  3:4 portrait (matches 58% column)`);
console.log(`  Sheets:      ${displayPath(SHEETS_DIR)}`);
console.log(`  Cost:        ~$0.04 × 2 = ~$0.08`);
console.log();
for (const s of SCENES) {
  console.log(`  page-0${s.page} — ${s.label}`);
  console.log(`    action:    ${s.action}`);
  console.log(`    narrative: (${s.narrative_text.length} chars) ${s.narrative_text}`);
  console.log();
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ans = await rl.question("Type CONFIRM to proceed with 2 paid calls (~$0.08): ");
rl.close();
if (ans.trim() !== "CONFIRM") {
  console.log("Aborted.");
  process.exit(0);
}

const sheetBuffers = ["sheet-01.png", "sheet-02.png", "sheet-03.png"]
  .map((f) => fs.readFileSync(path.join(SHEETS_DIR, f)));

const results = [];
let totalCost = 0;

for (const scene of SCENES) {
  console.log();
  console.log("-".repeat(72));
  console.log(`Render — page-0${scene.page} — ${scene.label}`);
  console.log("-".repeat(72));
  const t0 = Date.now();
  const result = await renderPageWithTemplate({
    templateConfigPath: TEMPLATE_CONFIG,
    scene: { page: scene.page, action: scene.action },
    narrativeText: scene.narrative_text,
    characterDescription,
    characterAge,
    characterSheets: sheetBuffers,
    sceneStyle: story.style,
    sceneNegativePrompt: story.negative_prompt,
    outputDir: PROTOTYPE_DIR,
  });
  const wall = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`  success:        ${result.success}`);
  if (result.error) console.log(`  error:          ${result.error}`);
  console.log(`  cost:           $${result.diagnostics.cost.toFixed(2)}`);
  console.log(`  wall:           ${wall}s`);

  let dims = null;
  if (result.imagePath) {
    const m = await sharp(result.imagePath).metadata();
    dims = `${m.width}×${m.height}  (aspect ${(m.width / m.height).toFixed(3)} — target 0.750)`;
    console.log(`  Gemini raw:     ${dims}`);
    console.log(`  Gemini PNG:     ${displayPath(result.imagePath)}`);
  }
  if (result.renderedPngPath) console.log(`  rendered PNG:   ${displayPath(result.renderedPngPath)}`);
  if (result.pdfPath)         console.log(`  PDF:            ${displayPath(result.pdfPath)}`);

  totalCost += result.diagnostics.cost;
  results.push({ ...scene, success: result.success, dims, pdfPath: result.pdfPath, renderedPngPath: result.renderedPngPath });
}

console.log();
console.log("=".repeat(72));
console.log("N=3 stress-pass summary");
console.log("=".repeat(72));
console.log();
console.log(`  Total this-run cost: $${totalCost.toFixed(2)}`);
console.log(`  Total vertical-split validation spend (incl. N=1): $${(totalCost + 0.04).toFixed(2)}`);
console.log();
for (const r of results) {
  console.log(`  page-0${r.page} — ${r.label}`);
  console.log(`    dims: ${r.dims || "(render failed)"}`);
  console.log(`    PDF:  ${r.pdfPath ? displayPath(r.pdfPath) : "(none)"}`);
}
console.log();
console.log("Judge per render:");
console.log("  - Pin held (aspect ≈ 0.750)?");
console.log("  - Image fills column with no crop?");
console.log("  - Gemini composes vertically — or reverts horizontal on the stress scene?");
console.log();
