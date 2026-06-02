// scripts/test-prompt-7.js
// Validation test for prompt-7-iter-1 (quiet-vignette).
//
// Renders 3 quiet scenes via the Type C pipeline, measures the painted-
// area fraction of each rendered Gemini image (so the "is it actually
// small?" judgment is concrete, not vibes), and surfaces all 3 PDFs +
// per-render measurements for human visual judgment.
//
// Scene mix per the refined plan:
//   1. EXPANSIVE STRESSOR — "wide open garden at dusk, big sky" — the
//      scene that begs to fill the frame. Real test of whether the
//      composition prompt holds SMALL against Gemini's frame-filling
//      instinct. If this fails, the prompt needs harder size constraint
//      before scaling.
//   2. TENDER MID — "firefly in cupped palms" — natural fit for an
//      intimate vignette; baseline that the template works on its
//      ideal scene.
//   3. INTERIOR CONTAINED — "windowsill watching snow" — Gemini's
//      natural inclination is already small here; the easy case.
//
// Pass criterion (sharpened per the user's refinement):
//   Vignette reads as a SMALL JEWEL with cream CLEARLY DOMINATING.
//   Concrete bar: painted area roughly a third of visible page or less
//   (≤~33% = strong pass; 33-50% = creeping / soft fail; >50% = hard
//   fail). Pass = ≥2/3 land in the strong-pass band.
//
// Cost: ~$0.04 × 3 = ~$0.12. No retry budget on this pass; if a render
// misses, capture the failure mode and decide next move before re-
// spending.

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

// ---- Vignette-area measurement -------------------------------------------
// Measures painted (non-cream) pixel fraction of the visible-page region of
// a Gemini-rendered image. Visible region = the slice that survives CSS
// object-fit:cover into the 1.294:1 (11×8.5) page.
//
// Gemini returns variable aspects despite the prompt asking for 1408×768
// — observed 1.833 (1408×768) AND 1.281 (1168×912, near page-aspect) in
// existing renders. So the crop direction depends on the actual image
// aspect:
//   image_aspect > page_aspect  → image is too wide  → crop horizontally
//   image_aspect < page_aspect  → image is too tall  → crop vertically
//   image_aspect ≈ page_aspect  → no crop (whole image visible)
//
// Cream tolerance ±18 per RGB channel — loose enough to absorb minor
// paper-texture variation Gemini sometimes paints into "blank" zones,
// tight enough that any actual painted content is flagged non-cream.
async function measureVignetteArea(pngPath) {
  const img = sharp(pngPath);
  const m = await img.metadata();
  const pageAspect = 11 / 8.5;
  const imgAspect = m.width / m.height;

  let extractLeft, extractTop, extractWidth, extractHeight;
  if (imgAspect > pageAspect) {
    // Too wide — crop horizontally.
    extractHeight = m.height;
    extractWidth = Math.min(m.width, Math.round(m.height * pageAspect));
    extractLeft = Math.max(0, Math.floor((m.width - extractWidth) / 2));
    extractTop = 0;
  } else if (imgAspect < pageAspect) {
    // Too tall — crop vertically.
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
  const painted = total - creamPixels;
  return {
    visibleWidth: info.width,
    visibleHeight: info.height,
    totalPixels: total,
    paintedPixels: painted,
    creamPixels,
    paintedPct: (painted / total) * 100,
  };
}

function classifyVignette(pct) {
  if (pct <= 33) return "STRONG PASS (small jewel, cream dominates)";
  if (pct <= 50) return "SOFT FAIL (creeping — barely-more-cream-than-image)";
  return "HARD FAIL (frame-filling — cream does not dominate)";
}

// ---- Scenes --------------------------------------------------------------
const SCENES = [
  {
    label: "1 / EXPANSIVE STRESSOR — wide garden + big sky",
    action:
      "Iris stands small in the wide open garden at dusk, the big sky stretching above her, fireflies just beginning to wake in the grass around her feet.",
    narrative_text:
      "The sky leans down over the garden, soft and wide. She breathes it in. The first fireflies blink awake, one by one.",
  },
  {
    label: "2 / TENDER MID — firefly in cupped palms",
    action:
      "Iris kneels in the tall grass, hands cupped gently around a single firefly, looking down at the warm yellow glow between her palms.",
    narrative_text:
      "The little light pulses in her hands. She holds her breath. It is the smallest, kindest brightness she has ever seen.",
  },
  {
    label: "3 / INTERIOR CONTAINED — windowsill snow",
    action:
      "Iris sits cross-legged on the wide windowsill in her pajamas, hands resting in her lap, watching slow snow drift past the dark glass.",
    narrative_text:
      "Snow falls past the window, slow and quiet. She watches each flake. The room is warm. The night is hushed.",
  },
];

// Sanity-check narrative lengths against the 150 cap
for (const s of SCENES) {
  const len = s.narrative_text.length;
  if (len > 150) {
    console.error(`Scene "${s.label}" narrative is ${len} chars — exceeds 150 cap. Aborting.`);
    process.exit(1);
  }
}

console.log();
console.log("=".repeat(72));
console.log("prompt-7-iter-1 (quiet-vignette) — 3-scene validation");
console.log("=".repeat(72));
console.log();
console.log("Scenes:");
for (const s of SCENES) {
  console.log(`  ${s.label}`);
  console.log(`    action:    ${s.action}`);
  console.log(`    narrative: (${s.narrative_text.length} chars) ${s.narrative_text}`);
}
console.log();
console.log("Pipeline:    Type C (no detection, fixed textRegion, auto-fit)");
console.log("Sheets:      output/books/2026-05-22-iris-1333/character-sheets/");
console.log("Output dir:  templates/prompt-7-iter-1/test-output/");
console.log("Cost:        ~$0.04 × 3 = ~$0.12 (3 fresh Gemini calls)");
console.log();
console.log("Pass criterion: painted area ≤~33% of visible page = strong pass");
console.log("                33-50% = soft fail (creeping)");
console.log("                >50%   = hard fail (frame-filling)");
console.log("                Overall pass = ≥2/3 strong-pass");
console.log();

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const answer = await rl.question("Type CONFIRM to proceed with the 3 paid calls (anything else aborts): ");
rl.close();
if (answer.trim() !== "CONFIRM") {
  console.log();
  console.log("Aborted.");
  process.exit(0);
}

fs.mkdirSync(TEST_OUT_DIR, { recursive: true });

const sheetsDir = path.join(BOOK_DIR, "character-sheets");
const sheetBuffers = ["sheet-01.png", "sheet-02.png", "sheet-03.png"]
  .map((f) => fs.readFileSync(path.join(sheetsDir, f)));

const results = [];
let totalCost = 0;

for (let i = 0; i < SCENES.length; i++) {
  const scene = SCENES[i];
  const pageNum = i + 1;
  console.log();
  console.log("-".repeat(72));
  console.log(`Render ${pageNum}/3 — ${scene.label}`);
  console.log("-".repeat(72));

  const tStart = Date.now();
  const result = await renderPageWithTemplate({
    templateConfigPath: TEMPLATE_CONFIG,
    scene: { page: pageNum, action: scene.action },
    narrativeText: scene.narrative_text,
    characterDescription,
    characterAge,
    characterSheets: sheetBuffers,
    sceneStyle: story.style,
    sceneNegativePrompt: story.negative_prompt,
    outputDir: TEST_OUT_DIR,
  });
  const wallMs = Date.now() - tStart;

  console.log(`  success:  ${result.success}`);
  if (result.error) console.log(`  error:    ${result.error}`);
  console.log(`  fontSize: ${result.diagnostics.fontSize}pt`);
  console.log(`  cost:     $${result.diagnostics.cost.toFixed(2)}`);
  console.log(`  wall:     ${(wallMs / 1000).toFixed(1)}s`);

  totalCost += result.diagnostics.cost;

  if (!result.success) {
    console.error(`  ✗ Render failed. Continuing to next scene (failure captured).`);
    results.push({ scene: scene.label, success: false, error: result.error });
    continue;
  }

  console.log(`  Gemini PNG:    ${displayPath(result.imagePath)}`);
  console.log(`  rendered PNG:  ${displayPath(result.renderedPngPath)}`);
  console.log(`  PDF:           ${displayPath(result.pdfPath)}`);

  // Print Gemini's raw returned dimensions on EVERY render — this is how we
  // confirm the aspectRatio pin is being honored (or detect when it isn't).
  // Was originally only-on-render-1 per the validation plan; making it
  // per-render is cheap and surfaces any per-call drift.
  const rawMeta = await sharp(result.imagePath).metadata();
  console.log(`  Gemini raw:    ${rawMeta.width}×${rawMeta.height}  (aspect ${(rawMeta.width / rawMeta.height).toFixed(3)})`);

  console.log();
  console.log(`  Measuring vignette area on RENDERED page...`);
  const measure = await measureVignetteArea(result.renderedPngPath);
  const verdict = classifyVignette(measure.paintedPct);
  console.log(`    visible region:   ${measure.visibleWidth}×${measure.visibleHeight} px`);
  console.log(`    painted pixels:   ${measure.paintedPixels.toLocaleString()} / ${measure.totalPixels.toLocaleString()}`);
  console.log(`    painted area:     ${measure.paintedPct.toFixed(1)}% of visible page`);
  console.log(`    verdict:          ${verdict}`);

  results.push({
    scene: scene.label,
    success: true,
    imagePath: result.imagePath,
    pdfPath: result.pdfPath,
    paintedPct: measure.paintedPct,
    verdict,
  });
}

console.log();
console.log("=".repeat(72));
console.log("Validation summary");
console.log("=".repeat(72));
console.log();
console.log("Per-render results:");
console.log();
const strongPassCount = results.filter((r) => r.success && r.paintedPct <= 33).length;
const softFailCount = results.filter((r) => r.success && r.paintedPct > 33 && r.paintedPct <= 50).length;
const hardFailCount = results.filter((r) => r.success && r.paintedPct > 50).length;
const renderFailCount = results.filter((r) => !r.success).length;

for (const r of results) {
  if (!r.success) {
    console.log(`  ✗ ${r.scene}`);
    console.log(`    render failed: ${r.error}`);
  } else {
    const tag =
      r.paintedPct <= 33 ? "✓ STRONG PASS" :
      r.paintedPct <= 50 ? "⚠ SOFT FAIL"   :
                          "✗ HARD FAIL";
    console.log(`  ${tag} — ${r.scene}`);
    console.log(`    painted: ${r.paintedPct.toFixed(1)}%   PDF: ${displayPath(r.pdfPath)}`);
  }
}
console.log();
console.log(`Tally:    strong-pass ${strongPassCount}/3 · soft-fail ${softFailCount}/3 · hard-fail ${hardFailCount}/3 · render-fail ${renderFailCount}/3`);
console.log(`Total cost: $${totalCost.toFixed(2)}`);
console.log();
if (strongPassCount >= 2) {
  console.log("Overall: PASS (≥2/3 strong-pass — template holds SMALL across the scene mix).");
} else {
  console.log("Overall: NEEDS WORK (<2/3 strong-pass — composition prompt needs harder size constraint).");
  console.log("        Do not re-spend blindly. Inspect the failed renders' compositions and");
  console.log("        diagnose the failure mode (frame-filling? creeping near-half? hard");
  console.log("        rectangular edge?) before refining the prompt.");
}
console.log();
console.log("Upload all 3 PDFs for visual judgment.");
console.log();
