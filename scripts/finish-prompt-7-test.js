// scripts/finish-prompt-7-test.js
// Recovery one-off: page-01 was rendered in the first test-prompt-7.js
// run before the measurement bug aborted it (aspect-handling now patched
// in test-prompt-7.js). page-01.png on disk is real, $0.04 already spent.
// This script renders scenes 2 + 3 ($0.08) and measures all 3.
//
// After this completes successfully, test-prompt-7.js itself is the
// canonical harness for future iterations (the patched measurement is
// permanent there).

import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { renderPageWithTemplate } from "../src/page-pipeline.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, "..");
const BOOK_DIR = path.join(PROJECT_ROOT, "output", "books", "2026-05-22-iris-1333");
const TEMPLATE_DIR = path.join(PROJECT_ROOT, "templates", "prompt-7-iter-1");
const TEMPLATE_CONFIG = path.join(TEMPLATE_DIR, "config.json");
const TEST_OUT_DIR = path.join(TEMPLATE_DIR, "test-output");

const story = JSON.parse(fs.readFileSync(path.join(BOOK_DIR, "story.json"), "utf8"));
const meta = JSON.parse(fs.readFileSync(path.join(BOOK_DIR, "meta.json"), "utf8"));
const characterName = meta.inputs.child.name;
const characterAge = meta.inputs.child.age;

function maskName(text, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return text
    .replace(new RegExp(`\\b${escaped}(?:'s)?\\b`, "g"), "")
    .replace(/\s+/g, " ")
    .trim();
}
const characterDescription = maskName(story.character, characterName);

function displayPath(p) {
  if (!p) return null;
  return path.relative(PROJECT_ROOT, p).replace(/\\/g, "/");
}

async function measureVignetteArea(pngPath) {
  const img = sharp(pngPath);
  const m = await img.metadata();
  const pageAspect = 11 / 8.5;
  const imgAspect = m.width / m.height;

  let extractLeft, extractTop, extractWidth, extractHeight;
  if (imgAspect > pageAspect) {
    extractHeight = m.height;
    extractWidth = Math.min(m.width, Math.round(m.height * pageAspect));
    extractLeft = Math.max(0, Math.floor((m.width - extractWidth) / 2));
    extractTop = 0;
  } else if (imgAspect < pageAspect) {
    extractWidth = m.width;
    extractHeight = Math.min(m.height, Math.round(m.width / pageAspect));
    extractLeft = 0;
    extractTop = Math.max(0, Math.floor((m.height - extractHeight) / 2));
  } else {
    extractLeft = 0;
    extractTop = 0;
    extractWidth = m.width;
    extractHeight = m.height;
  }

  const { data, info } = await img
    .extract({ left: extractLeft, top: extractTop, width: extractWidth, height: extractHeight })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const TARGET_R = 240, TARGET_G = 232, TARGET_B = 216;
  const TOL = 18;
  const chans = info.channels;
  let creamPixels = 0;
  const total = info.width * info.height;
  for (let i = 0; i < data.length; i += chans) {
    if (
      Math.abs(data[i] - TARGET_R) <= TOL &&
      Math.abs(data[i + 1] - TARGET_G) <= TOL &&
      Math.abs(data[i + 2] - TARGET_B) <= TOL
    ) creamPixels++;
  }
  return {
    imgW: m.width, imgH: m.height, imgAspect,
    cropW: info.width, cropH: info.height,
    totalPixels: total,
    paintedPixels: total - creamPixels,
    creamPixels,
    paintedPct: ((total - creamPixels) / total) * 100,
  };
}

function classify(pct) {
  if (pct <= 33) return { tag: "✓ STRONG PASS", note: "small jewel, cream dominates" };
  if (pct <= 50) return { tag: "⚠ SOFT FAIL",   note: "creeping — barely-more-cream-than-image" };
  return                  { tag: "✗ HARD FAIL",  note: "frame-filling — cream does not dominate" };
}

// Scene 1 already rendered (page-01.png exists from the first run).
// Render scenes 2 + 3 only.
const REMAINING_SCENES = [
  {
    page: 2,
    label: "2 / TENDER MID — firefly in cupped palms",
    action:
      "Iris kneels in the tall grass, hands cupped gently around a single firefly, looking down at the warm yellow glow between her palms.",
    narrative_text:
      "The little light pulses in her hands. She holds her breath. It is the smallest, kindest brightness she has ever seen.",
  },
  {
    page: 3,
    label: "3 / INTERIOR CONTAINED — windowsill snow",
    action:
      "Iris sits cross-legged on the wide windowsill in her pajamas, hands resting in her lap, watching slow snow drift past the dark glass.",
    narrative_text:
      "Snow falls past the window, slow and quiet. She watches each flake. The room is warm. The night is hushed.",
  },
];

const SCENE_1_LABEL = "1 / EXPANSIVE STRESSOR — wide garden + big sky";

console.log();
console.log("=".repeat(72));
console.log("prompt-7-iter-1 — recovery: render scenes 2+3, measure all 3");
console.log("=".repeat(72));
console.log();
console.log("Page-01 already on disk (rendered in first run, $0.04 spent).");
console.log("Renders to do:");
for (const s of REMAINING_SCENES) {
  console.log(`  page-0${s.page}: ${s.label}`);
  console.log(`    narrative: (${s.narrative_text.length} chars) ${s.narrative_text}`);
}
console.log();
console.log("Cost: ~$0.04 × 2 = ~$0.08 (2 fresh Gemini calls).");
console.log();

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ans = await rl.question("Type CONFIRM to proceed (anything else aborts): ");
rl.close();
if (ans.trim() !== "CONFIRM") {
  console.log("Aborted.");
  process.exit(0);
}

const sheetsDir = path.join(BOOK_DIR, "character-sheets");
const sheetBuffers = ["sheet-01.png", "sheet-02.png", "sheet-03.png"]
  .map((f) => fs.readFileSync(path.join(sheetsDir, f)));

let totalCost = 0;

for (const scene of REMAINING_SCENES) {
  console.log();
  console.log("-".repeat(72));
  console.log(`Render — ${scene.label}`);
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
    outputDir: TEST_OUT_DIR,
  });
  const wall = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`  success: ${result.success}`);
  if (result.error) console.log(`  error: ${result.error}`);
  console.log(`  cost: $${result.diagnostics.cost.toFixed(2)}  wall: ${wall}s`);
  if (result.imagePath) console.log(`  PNG: ${displayPath(result.imagePath)}`);
  if (result.pdfPath)   console.log(`  PDF: ${displayPath(result.pdfPath)}`);
  totalCost += result.diagnostics.cost;
}

console.log();
console.log("=".repeat(72));
console.log("Measurement summary (all 3)");
console.log("=".repeat(72));
console.log();

const ALL_LABELS = [SCENE_1_LABEL, REMAINING_SCENES[0].label, REMAINING_SCENES[1].label];
const measurements = [];
for (let i = 0; i < 3; i++) {
  const page = i + 1;
  const pngPath = path.join(TEST_OUT_DIR, `page-0${page}.png`);
  const pdfPath = path.join(TEST_OUT_DIR, `page-0${page}.pdf`);
  if (!fs.existsSync(pngPath)) {
    console.log(`  page-0${page}: MISSING (${ALL_LABELS[i]})`);
    measurements.push({ page, label: ALL_LABELS[i], missing: true });
    continue;
  }
  const m = await measureVignetteArea(pngPath);
  const c = classify(m.paintedPct);
  console.log(`  ${c.tag} — ${ALL_LABELS[i]}`);
  console.log(`    image: ${m.imgW}×${m.imgH} (aspect ${m.imgAspect.toFixed(3)})`);
  console.log(`    crop:  ${m.cropW}×${m.cropH}`);
  console.log(`    painted: ${m.paintedPixels.toLocaleString()} / ${m.totalPixels.toLocaleString()} = ${m.paintedPct.toFixed(1)}%`);
  console.log(`    note:    ${c.note}`);
  console.log(`    PDF:     ${displayPath(pdfPath)}`);
  console.log();
  measurements.push({ page, label: ALL_LABELS[i], ...m, classification: c });
}

const strong = measurements.filter((x) => !x.missing && x.paintedPct <= 33).length;
const soft   = measurements.filter((x) => !x.missing && x.paintedPct > 33 && x.paintedPct <= 50).length;
const hard   = measurements.filter((x) => !x.missing && x.paintedPct > 50).length;

console.log("-".repeat(72));
console.log(`Tally:      strong-pass ${strong}/3 · soft-fail ${soft}/3 · hard-fail ${hard}/3`);
console.log(`This-run cost: $${totalCost.toFixed(2)}  (total spent on prompt-7 validation incl. first run: $${(totalCost + 0.04).toFixed(2)})`);
console.log();
if (strong >= 2) {
  console.log("Overall (script criterion): PASS by ≥2/3 strong-pass.");
} else {
  console.log("Overall (script criterion): NEEDS WORK — <2/3 strong-pass.");
}
console.log();
console.log("Final judgment depends on visual review of the 3 PDFs (vignette POSITION,");
console.log("cream-surround cleanliness on 4 sides, edge softness) — script measures size,");
console.log("not placement or atmospheric encroachment.");
console.log();
