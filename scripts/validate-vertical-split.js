// scripts/validate-vertical-split.js
// Real validation of the vertical-split prototype — fresh Gemini render
// with the aspect-pin lever set to 3:4 portrait + composition prompt
// asking for vertical emphasis (looking up, towering, vertical scale).
//
// Tests three things the mockup couldn't:
//   1. Does the 3:4-pinned image fill the 58%-width × 100%-height column
//      with NO object-fit:cover crop (clean fill, whole scene visible)?
//   2. Does Gemini paint a good tall/vertical-emphasis composition (the
//      new expressive range)?
//   3. Text column still clean alongside the fresh portrait image?
//
// Cost: ~$0.04 (1 Gemini call). Uses the existing 1333 Iris character
// sheets so the protagonist is consistent with the foundation book.

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

// A scene action with explicit vertical emphasis. The composition prompt
// in config asks Gemini for vertical-scale framing; this action gives it
// concrete content (Iris small, towering sky above, looking up).
const SCENE_ACTION =
  "Iris stands small in an open meadow at dusk, her face turned UP toward an enormous towering night sky above her, the Milky Way rising in a great column of stars and pale light from the horizon all the way to the zenith.";

// 234-char narrative — fits the proposed ~280 cap with room.
const NARRATIVE_TEXT =
  "She stood very still and looked up. The sky was bigger than anything. It went up and up and up, past the tops of the trees, past the slow drifting clouds, all the way to where the stars began — and the stars went up and up too, forever.";

console.log();
console.log("=".repeat(72));
console.log("VERTICAL-SPLIT validation — fresh render, 3:4 portrait pin");
console.log("=".repeat(72));
console.log();
console.log(`  Template:    ${displayPath(TEMPLATE_CONFIG)}`);
console.log(`  Sheets:      ${displayPath(SHEETS_DIR)}`);
console.log(`  Scene:       ${SCENE_ACTION}`);
console.log(`  Narrative:   (${NARRATIVE_TEXT.length} chars) ${NARRATIVE_TEXT}`);
console.log();
console.log(`  Aspect pin:  3:4 portrait (matches 58% column exactly)`);
console.log(`  Column %:    image 58% / text 42%`);
console.log(`  Cost:        ~$0.04 (1 fresh Gemini call)`);
console.log();

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ans = await rl.question("Type CONFIRM to proceed (anything else aborts): ");
rl.close();
if (ans.trim() !== "CONFIRM") {
  console.log("Aborted.");
  process.exit(0);
}

const sheetBuffers = ["sheet-01.png", "sheet-02.png", "sheet-03.png"]
  .map((f) => fs.readFileSync(path.join(SHEETS_DIR, f)));

console.log();
console.log("Rendering...");
const t0 = Date.now();
const result = await renderPageWithTemplate({
  templateConfigPath: TEMPLATE_CONFIG,
  scene: { page: 1, action: SCENE_ACTION },
  narrativeText: NARRATIVE_TEXT,
  characterDescription,
  characterAge,
  characterSheets: sheetBuffers,
  sceneStyle: story.style,
  sceneNegativePrompt: story.negative_prompt,
  outputDir: PROTOTYPE_DIR,
});
const wallMs = Date.now() - t0;

console.log();
console.log("=".repeat(72));
console.log("Validation result");
console.log("=".repeat(72));
console.log(`  success:        ${result.success}`);
if (result.error) console.log(`  error:          ${result.error}`);
console.log(`  fontSize:       ${result.diagnostics.fontSize}pt`);
console.log(`  cost:           $${result.diagnostics.cost.toFixed(2)}`);
console.log(`  wall:           ${(wallMs / 1000).toFixed(1)}s`);
if (result.imagePath) {
  console.log(`  Gemini PNG:     ${displayPath(result.imagePath)}`);
  const m = await sharp(result.imagePath).metadata();
  const aspect = (m.width / m.height).toFixed(3);
  console.log(`  Gemini raw:     ${m.width}×${m.height}  (aspect ${aspect} — 3:4 = 0.750)`);
}
if (result.renderedPngPath) console.log(`  rendered PNG:   ${displayPath(result.renderedPngPath)}`);
if (result.pdfPath)         console.log(`  PDF:            ${displayPath(result.pdfPath)}`);
console.log();
console.log("Judge:");
console.log("  1. Image fills the 58% column with NO cut-off (3:4 pin holds)?");
console.log("  2. Gemini paints good tall/vertical-emphasis composition?");
console.log("  3. Text column still clean on pure cream?");
console.log();
