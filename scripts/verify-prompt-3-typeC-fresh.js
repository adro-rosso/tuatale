// scripts/verify-prompt-3-typeC-fresh.js
// Deferred validation for prompt-3-iter-2 Type C: ONE fresh Gemini render
// through the REWRITTEN composition prompt (hardcoded "bottom ~37% blank
// cream" + the CONTAINED VIGNETTE paragraph). The $0 override test reused
// images generated under the OLD prompt — this exercises the new prompt
// at generation time.
//
// Test case: 1104 book page 2 — the bedroom-window scene, the worst
// offender (escalated/failed across the original book run, decofix, and
// Phase 2). If the rewritten prompt forms a contained vignette HERE, it
// works.
//
// Cost: ~$0.04 (1 Gemini call). Sheets reused from the 1104 book dir.

import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { renderPageWithTemplate } from "../src/page-pipeline.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, "..");
const BOOK_DIR = path.join(PROJECT_ROOT, "output", "books", "2026-05-21-iris-1104");
const TEMPLATE_CONFIG = path.join(PROJECT_ROOT, "templates", "prompt-3-iter-2", "config.json");
const OUT_DIR = path.join(PROJECT_ROOT, "templates", "prompt-3-iter-2", "test-output", "typeC-fresh");

function displayPath(p) {
  return path.relative(PROJECT_ROOT, p).replace(/\\/g, "/");
}
function maskName(text, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return text.replace(new RegExp(`\\b${escaped}(?:'s)?\\b`, "g"), "").replace(/\s+/g, " ").trim();
}

const story = JSON.parse(fs.readFileSync(path.join(BOOK_DIR, "story.json"), "utf8"));
const scene = story.scenes.find((s) => s.page === 2); // bedroom window — worst offender
const config = JSON.parse(fs.readFileSync(TEMPLATE_CONFIG, "utf8"));

const sheetsDir = path.join(BOOK_DIR, "character-sheets");
const sheetBuffers = ["sheet-01.png", "sheet-02.png", "sheet-03.png"]
  .map((f) => fs.readFileSync(path.join(sheetsDir, f)));

fs.mkdirSync(OUT_DIR, { recursive: true });

console.log();
console.log("=".repeat(72));
console.log("prompt-3-iter-2 Type C — deferred validation (fresh Gemini render)");
console.log("=".repeat(72));
console.log();
console.log("Test case: 1104 page 2 — bedroom window (worst offender across all attempts)");
console.log(`Action: ${scene.action}`);
console.log(`Narrative: ${scene.narrative_text.length} chars`);
console.log();
console.log("Generating fresh through rewritten Type C composition prompt (~$0.04)...");

const tStart = Date.now();
const result = await renderPageWithTemplate({
  templateConfigPath: TEMPLATE_CONFIG,
  scene: { page: "02-fresh", action: scene.action },
  narrativeText: scene.narrative_text,
  characterDescription: maskName(story.character, "Iris"),
  characterAge: 5,
  characterSheets: sheetBuffers,
  sceneStyle: story.style,
  sceneNegativePrompt: story.negative_prompt,
  outputDir: OUT_DIR,
});
const wallMs = Date.now() - tStart;

console.log();
console.log("-".repeat(72));
console.log("Render result");
console.log("-".repeat(72));
console.log(`  success:   ${result.success}`);
if (result.error) console.log(`  error:     ${result.error}`);
console.log(`  fontSize:  ${result.diagnostics.fontSize}pt  (Type C auto-fit into fixed textRegion)`);
console.log(`  cost:      $${result.diagnostics.cost.toFixed(2)}`);
console.log(`  wall:      ${(wallMs / 1000).toFixed(1)}s`);
const t = result.diagnostics.timing;
console.log(`  timing:    imageGen ${t.imageGenMs}ms, regionDetect ${t.regionDetectMs}ms (expect 0 — Type C), autoFit ${t.autoFitMs}ms, render ${t.renderMs}ms`);
if (result.imagePath) console.log(`  PNG:       ${displayPath(result.imagePath)}`);
if (result.pdfPath) console.log(`  PDF:       ${displayPath(result.pdfPath)}`);

// ---- Lower-gap cleanliness check ----------------------------------------
// textRegion is page x 0.10-0.90, y 0.63-0.93. With object-fit:cover +
// center center on a 1408×768 source into an 11×8.5 page, the horizontal
// crop keeps source x ~15-85%; vertical is uncropped. So the text box
// maps to source x ~22-78%, y ~63-93%. Measure cream cleanliness there.
if (result.imagePath && fs.existsSync(result.imagePath)) {
  console.log();
  console.log("-".repeat(72));
  console.log("Lower-gap cleanliness (the source area where text lands)");
  console.log("-".repeat(72));
  const { data, info } = await sharp(result.imagePath).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  const x0 = Math.floor(width * 0.22), x1 = Math.floor(width * 0.78);
  const y0 = Math.floor(height * 0.63), y1 = Math.floor(height * 0.93);
  // Cream target #F0E8D8 = (240,232,216); RGB Euclidean threshold 30
  // (same classifier the old region detector used).
  const TR = 240, TG = 232, TB = 216, THRESH = 30;
  let cream = 0, total = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * width + x) * channels;
      const dr = data[i] - TR, dg = data[i + 1] - TG, db = data[i + 2] - TB;
      if (Math.sqrt(dr * dr + dg * dg + db * db) < THRESH) cream++;
      total++;
    }
  }
  const pct = (cream / total * 100).toFixed(1);
  console.log(`  Text-box source area: x ${x0}-${x1}, y ${y0}-${y1}`);
  console.log(`  Cream pixels: ${pct}%  (high % = clean blank gap; low % = vignette intruding)`);
}

console.log();
console.log("=".repeat(72));
console.log("Upload the PDF for visual judgment: contained vignette + clean lower");
console.log("gap + backdrop invisible + text legible.");
console.log("=".repeat(72));
console.log();
