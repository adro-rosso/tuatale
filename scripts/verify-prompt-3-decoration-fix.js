// scripts/verify-prompt-3-decoration-fix.js
// One-off verification for the prompt-3-iter-2 decoration removal
// (config.json composition-prompt fix, 2026-05-21). Regenerates page 2
// of the 1104 book — a bedroom-window scene that (a) escalated on
// B-class region-too-small in the original book run and (b) had the
// worst autumn-leaf clash (autumn meadow decorations indoors). Tests
// both hypotheses: aesthetic (no more leaf framing) and reliability
// (does region detection now succeed without escalating).
//
// Cost: ~$0.04 (1 fresh Gemini call). Character sheets reused from the
// 1104 book dir (no API call).

import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderPageWithTemplate } from "../src/page-pipeline.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, "..");
const BOOK_DIR = path.join(PROJECT_ROOT, "output", "books", "2026-05-21-iris-1104");
const TEMPLATE_CONFIG = path.join(PROJECT_ROOT, "templates", "prompt-3-iter-2", "config.json");
const OUT_DIR = path.join(PROJECT_ROOT, "templates", "prompt-3-iter-2", "test-output", "decoration-fix");

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
const scene = story.scenes.find((s) => s.page === 2);
const config = JSON.parse(fs.readFileSync(TEMPLATE_CONFIG, "utf8"));
const minSize = config.regionDetection.minSizePx;

const sheetsDir = path.join(BOOK_DIR, "character-sheets");
const sheetBuffers = ["sheet-01.png", "sheet-02.png", "sheet-03.png"]
  .map((f) => fs.readFileSync(path.join(sheetsDir, f)));

fs.mkdirSync(OUT_DIR, { recursive: true });

console.log();
console.log("=".repeat(72));
console.log("Verify — prompt-3-iter-2 decoration-removal fix");
console.log("=".repeat(72));
console.log();
console.log("Scene: 1104 book page 2 (bedroom window — escalated B-class in original run)");
console.log(`Action: ${scene.action}`);
console.log(`Narrative: ${scene.narrative_text.length} chars`);
console.log(`minSizePx for region detection: ${minSize.width}×${minSize.height}`);
console.log();
console.log("Regenerating through fixed prompt-3 config (1 Gemini call, ~$0.04)...");

const tStart = Date.now();
const result = await renderPageWithTemplate({
  templateConfigPath: TEMPLATE_CONFIG,
  scene: { page: "02-decofix", action: scene.action },
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
console.log("Result");
console.log("-".repeat(72));
console.log(`  success:   ${result.success}`);
if (result.error) console.log(`  error:     ${result.error}`);
console.log(`  cost:      $${result.diagnostics.cost.toFixed(2)}`);
console.log(`  wall:      ${(wallMs / 1000).toFixed(1)}s`);

const rd = result.diagnostics.regionDetection;
console.log();
console.log("  Region detection:");
if (rd && rd.region) {
  const r = rd.region;
  const w = Math.round(r.width);
  const h = Math.round(r.height);
  console.log(`    detected region (source px): ${w}×${h}`);
  console.log(`    minSizePx required:          ${minSize.width}×${minSize.height}`);
  console.log(`    width  ${w} >= ${minSize.width}: ${w >= minSize.width ? "PASS" : "FAIL"}`);
  console.log(`    height ${h} >= ${minSize.height}: ${h >= minSize.height ? "PASS" : "FAIL"}`);
  if (rd.warnings && rd.warnings.length) {
    console.log(`    warnings: ${rd.warnings.join("; ")}`);
  }
} else {
  console.log("    (no region-detection diagnostics — unexpected for Type A)");
}

if (result.success) {
  console.log();
  console.log(`  fontSize:  ${result.diagnostics.fontSize}pt`);
  console.log(`  imagePath: ${displayPath(result.imagePath)}`);
  console.log(`  pdfPath:   ${displayPath(result.pdfPath)}`);
}

console.log();
console.log("=".repeat(72));
console.log(result.success
  ? "Render SUCCEEDED first-try — region detection did NOT escalate."
  : "Render FAILED region detection — would escalate to fallback in generate-book.js.");
console.log("=".repeat(72));
console.log();
