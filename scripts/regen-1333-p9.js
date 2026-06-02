// scripts/regen-1333-p9.js
// One-off: regenerate the 1333 Shimmer book's page 9 (climax) with an
// orientation nudge to fix Gemini's inverted-face composition, then
// re-merge book.pdf. The original 1333 climax had Iris's face upside-
// down (head-toward-viewer); the augmented action pins the camera to
// foot-toward-viewer / head-at-top, with negative-direction reinforce-
// ment ("Do NOT paint her face inverted...") forbidding the failure mode.
//
// Cost: ~$0.04 (1 fresh Gemini image-gen). Re-merge is $0 (pdf-lib).

import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PDFDocument } from "pdf-lib";
import { renderPageWithTemplate } from "../src/page-pipeline.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, "..");
const BOOK_DIR = path.join(PROJECT_ROOT, "output", "books", "2026-05-22-iris-1333");
const PAGES_DIR = path.join(BOOK_DIR, "pages");
const SHEETS_DIR = path.join(BOOK_DIR, "character-sheets");
const TEMPLATE_CONFIG = path.join(PROJECT_ROOT, "templates", "prompt-6-iter-1", "config.json");
const BOOK_PDF = path.join(BOOK_DIR, "book.pdf");

// Augmented action — orientation nudge over the original "lies looking
// straight up." Pins camera to foot-toward-viewer + head-at-top so the
// face reads right-side-up; negative-direction reinforcement forbids
// the inverted composition Gemini picked on the first render.
const AUGMENTED_ACTION =
  "Iris lies on the blanket with her feet toward the viewer and her head at the top of the frame, gazing UP at one blazing star directly above her, arms spread wide, as a dark cloud slides away. Her face is right-side-up and clearly visible. Do NOT paint her face inverted, head-toward-viewer, or in any disorienting orientation.";

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

// ---- Load story + meta ---------------------------------------------------
const story = JSON.parse(fs.readFileSync(path.join(BOOK_DIR, "story.json"), "utf8"));
const meta = JSON.parse(fs.readFileSync(path.join(BOOK_DIR, "meta.json"), "utf8"));
const scene = story.scenes.find((s) => s.page === 9);
const characterName = meta.inputs.child.name;
const characterAge = meta.inputs.child.age;
const characterDescription = maskName(story.character, characterName);

const sheetBuffers = ["sheet-01.png", "sheet-02.png", "sheet-03.png"]
  .map((f) => fs.readFileSync(path.join(SHEETS_DIR, f)));

console.log();
console.log("=".repeat(72));
console.log("Regenerate 1333 page 9 climax with orientation nudge");
console.log("=".repeat(72));

// ---- Back up originals ---------------------------------------------------
const origPng = path.join(PAGES_DIR, "page-09.png");
const origPdf = path.join(PAGES_DIR, "page-09.pdf");
const backupPng = path.join(PAGES_DIR, "page-09-original.png");
const backupPdf = path.join(PAGES_DIR, "page-09-original.pdf");

if (fs.existsSync(origPng)) {
  fs.copyFileSync(origPng, backupPng);
  console.log(`  Backed up: ${displayPath(backupPng)}`);
}
if (fs.existsSync(origPdf)) {
  fs.copyFileSync(origPdf, backupPdf);
  console.log(`  Backed up: ${displayPath(backupPdf)}`);
}

// ---- Regenerate ----------------------------------------------------------
console.log();
console.log("Regenerating with augmented action (~$0.04, ~30-60s)...");
const tStart = Date.now();
const result = await renderPageWithTemplate({
  templateConfigPath: TEMPLATE_CONFIG,
  scene: { page: 9, action: AUGMENTED_ACTION },
  narrativeText: scene.narrative_text,
  characterDescription,
  characterAge,
  characterSheets: sheetBuffers,
  sceneStyle: story.style,
  sceneNegativePrompt: story.negative_prompt,
  outputDir: PAGES_DIR,
});
const wallMs = Date.now() - tStart;

console.log();
console.log("Regen result:");
console.log(`  success:  ${result.success}`);
if (result.error) console.log(`  error:    ${result.error}`);
console.log(`  fontSize: ${result.diagnostics.fontSize}pt`);
console.log(`  cost:     $${result.diagnostics.cost.toFixed(2)}`);
console.log(`  wall:     ${(wallMs / 1000).toFixed(1)}s`);
if (result.imagePath) console.log(`  PNG:      ${displayPath(result.imagePath)}`);
if (result.pdfPath) console.log(`  PDF:      ${displayPath(result.pdfPath)}`);

if (!result.success) {
  console.error();
  console.error("Regen FAILED — book.pdf NOT re-merged. Backups preserved.");
  process.exit(1);
}

// ---- Re-merge book.pdf ---------------------------------------------------
console.log();
console.log("Re-merging book.pdf...");
const merged = await PDFDocument.create();
for (let p = 1; p <= 12; p++) {
  const pageNumStr = String(p).padStart(2, "0");
  const pdfPath = path.join(PAGES_DIR, `page-${pageNumStr}.pdf`);
  if (!fs.existsSync(pdfPath)) {
    console.error(`MISSING: ${displayPath(pdfPath)} — aborting merge.`);
    process.exit(1);
  }
  const pdfBytes = fs.readFileSync(pdfPath);
  const src = await PDFDocument.load(pdfBytes);
  const copied = await merged.copyPages(src, src.getPageIndices());
  copied.forEach((pg) => merged.addPage(pg));
}
const mergedBytes = await merged.save();
fs.writeFileSync(BOOK_PDF, mergedBytes);
const sz = (fs.statSync(BOOK_PDF).size / 1024).toFixed(1);
console.log(`  Wrote: ${displayPath(BOOK_PDF)} (${sz} KB)`);

console.log();
console.log("=".repeat(72));
console.log("Done. New page 9:");
console.log(`  ${displayPath(result.pdfPath)}`);
console.log("Original preserved at:");
console.log(`  ${displayPath(backupPdf)}`);
console.log("Re-merged book:");
console.log(`  ${displayPath(BOOK_PDF)}`);
console.log("=".repeat(72));
console.log();
