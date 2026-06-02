// scripts/test-text-aware-zone.js
// Stage-2 integration test: prove the architecture supports text-aware
// image zones (measured text dimensions drive image-zone constraints
// sent to Gemini). One-off, hardcoded to Mateo p9 in prompt-3-iter-2
// typography. Cost: ~$0.04 (1 Gemini call).
//
// Flow: measureText → compute cream-zone dims → CONFIRM gate → Gemini
// regen with explicit dim constraints → save PNG → render PDF via
// scripts/render-pdf-template.js (subprocess).

import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import { measureText } from "../src/text-measurement.js";
import { generateImage, MODEL as GEMINI_MODEL } from "../src/gemini.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, "..");

// ---- Hardcoded targets -----------------------------------------------------
const BOOK_DIR = path.join(PROJECT_ROOT, "output", "books", "2026-05-17-mateo-0002");
const TEMPLATE_DIR = path.join(PROJECT_ROOT, "templates", "prompt-3-iter-2");
const STORY_PATH = path.join(BOOK_DIR, "story.json");
const SHEETS_DIR = path.join(BOOK_DIR, "character-sheets");
const SHEET_FILENAMES = ["sheet-01.png", "sheet-02.png", "sheet-03.png"];
const SCENE_PAGE = 9;
const NAME = "Mateo";
const AGE = 6;

const OUTPUT_PNG = path.join(TEMPLATE_DIR, "test-image-page-09-text-aware-zone-v4.png");
const OUTPUT_PDF_NAME = "spike-output-text-aware-zone-v4.pdf";

// ---- Typography (prompt-3-iter-2 settings) ---------------------------------
const TYPOGRAPHY = {
  fontFamily: "Architects Daughter",
  fontSize: 16,
  lineHeight: 1.6,
  maxWidth: "70%",
  pageWidth: "11in",
  pageHeight: "8.5in",
  letterSpacing: "0.01em",
};

// ---- Padding for cream-zone derivation -------------------------------------
const PADDING_VERTICAL_IN = 2.5;   // 1.25 top + 1.25 bottom — target detected clean region ≥ text height
const PADDING_HORIZONTAL_IN = 2.0; // 1.0 left + 1.0 right — test horizontal clearing absorption

// ---- Brand overrides (same as v5a_untouched_paper variation) ---------------
// story.composition_rules' "centered subject" rule conflicts with the
// template-aware composition. CUSTOM_COMPOSITION_RULES drops it.
const CUSTOM_COMPOSITION_RULES =
  "full body, clean uncluttered background, consistent framing, face clearly visible.";

// Sophie Blackall painter vocab — same as v5a's accepted ceiling.
const STYLE_OVERRIDE =
  "watercolor on cold-press paper, wet-on-wet wash technique, visible " +
  "pigment granulation, organic uneven boundaries where wash absorbs " +
  "into paper fiber. Loose, painterly, with intentional white space and " +
  "atmospheric bleeding. Inspired by contemporary picture book " +
  "illustration in the style of Sophie Blackall. Warm earthy palette.";

// ---- Helpers (mirror scripts/regen-image-template-aware.js) ----------------
function maskName(text, name) {
  const tokens = name.trim().split(/\s+/);
  let result = text;
  for (const token of tokens) {
    const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(`\\b${escaped}(?:'s)?\\b`, "g");
    result = result.replace(pattern, "");
  }
  result = result.replace(/\s+/g, " ").trim();
  if (result.startsWith("is a ")) result = "A " + result.slice(5);
  else if (result.startsWith("is an ")) result = "An " + result.slice(6);
  return result;
}

function replaceName(text, name, replacement = "the child") {
  const tokens = name.trim().split(/\s+/);
  let result = text;
  for (const token of tokens) {
    const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    result = result.replace(new RegExp(`\\b${escaped}\\b`, "g"), replacement);
  }
  return result.replace(/\s+/g, " ").trim();
}

function displayPath(p) {
  return path.relative(PROJECT_ROOT, p).replace(/\\/g, "/");
}

// ---- Load story + scene + sheets -------------------------------------------
const story = JSON.parse(fs.readFileSync(STORY_PATH, "utf8"));
const scene = story.scenes.find((s) => s.page === SCENE_PAGE);
if (!scene) {
  console.error(`FAIL: scene page ${SCENE_PAGE} not found in story.json`);
  process.exit(1);
}

const sheetBuffers = SHEET_FILENAMES.map((fn) => {
  const p = path.join(SHEETS_DIR, fn);
  if (!fs.existsSync(p)) {
    console.error(`FAIL: character sheet missing: ${displayPath(p)}`);
    process.exit(1);
  }
  return fs.readFileSync(p);
});

const narrativeTextPath = path.join(BOOK_DIR, "pages", `page-${String(SCENE_PAGE).padStart(2, "0")}.txt`);
if (!fs.existsSync(narrativeTextPath)) {
  console.error(`FAIL: narrative text missing: ${displayPath(narrativeTextPath)}`);
  process.exit(1);
}
const narrativeText = fs.readFileSync(narrativeTextPath, "utf8").trim();

// ---- Measure text + compute cream-zone dimensions --------------------------
console.log();
console.log("=".repeat(72));
console.log(`Stage-2 integration test — text-aware image zone for prompt-3-iter-2`);
console.log("=".repeat(72));
console.log();
console.log("Step 1/3 — measureText (Mateo p9 in prompt-3-iter-2 typography)");
console.log(`  text source:  ${displayPath(narrativeTextPath)}`);
console.log(`  text length:  ${narrativeText.length} chars`);
console.log(`  typography:   ${TYPOGRAPHY.fontFamily} ${TYPOGRAPHY.fontSize}pt, lh ${TYPOGRAPHY.lineHeight}, maxWidth ${TYPOGRAPHY.maxWidth}, letterSpacing ${TYPOGRAPHY.letterSpacing}`);

const measurement = await measureText({
  text: narrativeText,
  fontFamily: TYPOGRAPHY.fontFamily,
  fontSize: TYPOGRAPHY.fontSize,
  lineHeight: TYPOGRAPHY.lineHeight,
  maxWidth: TYPOGRAPHY.maxWidth,
  pageWidth: TYPOGRAPHY.pageWidth,
  pageHeight: TYPOGRAPHY.pageHeight,
  letterSpacing: TYPOGRAPHY.letterSpacing,
});

console.log(`  lines:             ${measurement.lines}`);
console.log(`  heightPt:          ${measurement.heightPt.toFixed(2)}`);
console.log(`  heightIn:          ${measurement.heightIn.toFixed(4)}`);
console.log(`  widthPt:           ${measurement.widthPt.toFixed(2)}`);
console.log(`  actualMaxWidthPt:  ${measurement.actualMaxWidthPt.toFixed(2)}`);

const cream_zone_height_in = measurement.heightIn + PADDING_VERTICAL_IN;
const cream_zone_width_in = (measurement.actualMaxWidthPt / 72) + PADDING_HORIZONTAL_IN;
const cream_zone_height_pct = cream_zone_height_in / 8.5 * 100;
const cream_zone_width_pct = cream_zone_width_in / 11 * 100;

console.log();
console.log("Derived cream-zone dimensions:");
console.log(`  cream_zone_height_in:  ${cream_zone_height_in.toFixed(3)}  (text + ${PADDING_VERTICAL_IN}in vertical padding)`);
console.log(`  cream_zone_width_in:   ${cream_zone_width_in.toFixed(3)}  (text + ${PADDING_HORIZONTAL_IN}in horizontal breathing room)`);
console.log(`  cream_zone_height_pct: ${cream_zone_height_pct.toFixed(2)}%`);
console.log(`  cream_zone_width_pct:  ${cream_zone_width_pct.toFixed(2)}%`);

// ---- Build the Gemini prompt -----------------------------------------------
const appearance = maskName(story.character, NAME);
const actionMasked = replaceName(scene.action, NAME);

const templateComposition =
  "The image fills a 1408×768 landscape frame. The composition will be " +
  "cropped at render to a 1.29:1 aspect ratio (cropping ~15% from each " +
  "horizontal edge). Critical SCENE content (the protagonist, the main " +
  "focal action, the scene's narrative subjects) MUST be positioned " +
  "within the CENTRAL 70% of the source image width to survive the crop. " +
  "Decorative framing elements (grasses, leaves, splatter at the edges " +
  "of the cream zone) may extend further toward the page edges — they " +
  "exist to frame the cream zone and the crop will trim their outer-most " +
  "portions naturally. " +
  "The upper ~35% of the frame is the painted scene (the main illustration). " +
  "BELOW the painted scene, in the lower portion of the frame: " +
  `The cream zone is a rectangular area of UNTOUCHED CREAM PAPER ` +
  `measuring exactly ${cream_zone_width_pct.toFixed(2)}% of frame width × ` +
  `${cream_zone_height_pct.toFixed(2)}% of frame height ` +
  `(approximately ${cream_zone_width_in.toFixed(2)} inches wide × ` +
  `${cream_zone_height_in.toFixed(2)} inches tall in the final 11×8.5 inch ` +
  `landscape page), centered horizontally at the bottom of the frame. ` +
  `This zone must be tall enough to accommodate ${measurement.lines} lines of body text. ` +
  "The cream zone is completely blank — no paint, no wash, no texture, no " +
  "scene content, no ground, no hills, no terrain. " +
  "FRAMING THE CREAM ZONE on three sides (left, right, bottom): tall " +
  "grasses with seedheads along the left and right edges of the clearing, " +
  "autumn leaves and small sprigs at the bottom corners, watercolor " +
  "splatter scattered around the clearing edges. These framing elements " +
  "are painted decorations on the cream paper itself, sitting at the " +
  "edges of the blank zone. " +
  "CRITICAL: do NOT extend the landscape, hills, ground, or any painted " +
  "scene content into the cream zone. The cream zone is bare paper. The " +
  "painted scene above has a defined lower boundary; below that boundary " +
  "the paper is untouched except for the decorative framing elements at " +
  "the edges. " +
  "Watercolor wash with visible pigment granulation in the scene area. " +
  "NO hard rectangular edges anywhere — the upper scene bleeds organically " +
  "to the page on the top, left, and right sides.";

const basePrompt = [
  `Subject: a ${AGE}-year-old child.`,
  `Appearance: ${appearance}.`,
  `Style: ${STYLE_OVERRIDE}.`,
  `Composition: ${CUSTOM_COMPOSITION_RULES}`,
  `Template composition: ${templateComposition}`,
  `Avoid: ${story.negative_prompt}.`,
].join("\n");

const fullPrompt =
  `${basePrompt}\n\n` +
  `Scene: ${actionMasked}\n\n` +
  `Use the provided reference images of the character to keep their appearance, clothing, and proportions consistent.`;

// ---- Surface the plan + CONFIRM gate ---------------------------------------
console.log();
console.log("Step 2/3 — Gemini regen (paid call)");
console.log(`  Model:        ${GEMINI_MODEL}`);
console.log(`  References:   ${SHEET_FILENAMES.length} character sheets`);
console.log(`  Estimated:    ~$0.04 USD`);
console.log(`  Output PNG:   ${displayPath(OUTPUT_PNG)}`);
console.log();
console.log("Prompt being sent to Gemini:");
console.log("-".repeat(72));
console.log(fullPrompt);
console.log("-".repeat(72));
console.log();

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const answer = await rl.question("Type CONFIRM to proceed (anything else aborts): ");
rl.close();

if (answer.trim() !== "CONFIRM") {
  console.log("Aborted. No API call made. No cost incurred.");
  process.exit(0);
}

// ---- Generate image --------------------------------------------------------
const t0 = Date.now();
let buf;
try {
  buf = await generateImage(fullPrompt, sheetBuffers);
} catch (err) {
  console.error(`FAIL: Gemini call failed: ${err?.message ?? err}`);
  process.exit(1);
}
const ms = Date.now() - t0;

fs.mkdirSync(path.dirname(OUTPUT_PNG), { recursive: true });
fs.writeFileSync(OUTPUT_PNG, buf);

console.log();
console.log(`OK image saved: ${displayPath(OUTPUT_PNG)}  (${(ms / 1000).toFixed(1)}s, ${(buf.length / 1024).toFixed(1)} KB)`);

// ---- Render PDF via subprocess ---------------------------------------------
console.log();
console.log("Step 3/3 — render PDF via scripts/render-pdf-template.js");

const renderArgs = [
  "scripts/render-pdf-template.js",
  "--template-path", "templates/prompt-3-iter-2",
  "--book-dir", "output/books/2026-05-17-mateo-0002",
  "--page-number", "9",
  "--image-override", OUTPUT_PNG,
  "--output-name", OUTPUT_PDF_NAME,
];
const renderResult = spawnSync("node", renderArgs, { stdio: "inherit", cwd: PROJECT_ROOT });

if (renderResult.status !== 0) {
  console.error(`FAIL: render-pdf-template.js exited with status ${renderResult.status}`);
  process.exit(1);
}

// ---- Final summary ---------------------------------------------------------
const outputPdfPath = path.join(TEMPLATE_DIR, OUTPUT_PDF_NAME);
const pdfSizeKB = fs.existsSync(outputPdfPath)
  ? (fs.statSync(outputPdfPath).size / 1024).toFixed(1)
  : "?";

console.log();
console.log("=".repeat(72));
console.log("Stage-2 integration test complete.");
console.log("=".repeat(72));
console.log(`  Measurement:        ${measurement.lines} lines / ${measurement.heightPt.toFixed(2)}pt`);
console.log(`  Cream-zone target:  ${cream_zone_width_in.toFixed(2)}in × ${cream_zone_height_in.toFixed(2)}in (${cream_zone_width_pct.toFixed(2)}% × ${cream_zone_height_pct.toFixed(2)}%)`);
console.log(`  Image:              ${displayPath(OUTPUT_PNG)}  (${(buf.length / 1024).toFixed(1)} KB, ${(ms / 1000).toFixed(1)}s gen)`);
console.log(`  PDF:                ${displayPath(outputPdfPath)}  (${pdfSizeKB} KB)`);
console.log();
