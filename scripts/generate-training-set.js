// scripts/generate-training-set.js
// Phase 2 Step 2 — generate the 12-image LoRA training dataset.
// Uses Gemini (same model and config as src/gemini.js) with the 3 character
// sheet PNGs from Phase 1 Run 3 as references, anchoring the kid's identity
// while varying framing, angle, and expression across the 12 outputs.
//
// Output: output/training-set/train-01.png ... train-12.png
//         + output/training-set/prompts.json (per-image prompt log)
//
// Hard rules in this file:
//   - Confirmation gate at the start (type CONFIRM to proceed).
//   - 6s pacing between calls (same as src/pipeline.js).
//   - Slow-call warning if any call > 60s.
//   - Running cost logged after every successful call.
//   - Re-running overwrites output/training-set/ — snapshot first if comparing.

import "dotenv/config"; // MUST come first; populates process.env before src/gemini.js
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { generateImage, MODEL } from "../src/gemini.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, "..");
const SCRIPT_PATH = path.join(PROJECT_ROOT, "training-script.json");
const REFS_DIR = path.join(PROJECT_ROOT, "output", "character-sheet");
const OUT_DIR = path.join(PROJECT_ROOT, "output", "training-set");
const PROMPT_LOG_PATH = path.join(OUT_DIR, "prompts.json");

// Same numbers as src/pipeline.js — calls paced at ≥6s between starts.
// Replicated locally (rather than refactored out) because total duplication
// is ~10 lines, and refactoring would risk Phase 1's working pipeline.
const MIN_CALL_GAP_MS = 6000;
const COST_PER_IMAGE_USD = 0.04;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// References from Phase 1 Run 3. Script bails if any are missing.
const REF_FILENAMES = ["sheet-01.png", "sheet-02.png", "sheet-03.png"];

/** Build the prompt fragment shared by every call. Same template as pipeline.js. */
function buildBasePrompt(script) {
  const { character, style, composition_rules, negative_prompt } = script;
  return [
    `Subject: a ${character.age}-year-old boy.`,
    `Appearance: ${character.description}.`,
    `Style: ${style}.`,
    `Composition: ${composition_rules}.`,
    // Gemini has no separate negative_prompt field; inline as "Avoid:" clause.
    // Soft constraint, not hard.
    `Avoid: ${negative_prompt}.`,
  ].join("\n");
}

// ---- Preflight: verify the reference PNGs exist ---------------------------
for (const name of REF_FILENAMES) {
  const refPath = path.join(REFS_DIR, name);
  if (!fs.existsSync(refPath)) {
    console.error(`FAIL: reference image not found: ${refPath}`);
    console.error("Phase 1 (Gemini character-sheet generation) must have completed");
    console.error("successfully before running this script.");
    process.exit(1);
  }
}

// ---- Load script and references --------------------------------------------
const script = JSON.parse(fs.readFileSync(SCRIPT_PATH, "utf8"));
const trainingPrompts = script.training_prompts;
const total = trainingPrompts.length;
const basePrompt = buildBasePrompt(script);
const refBuffers = REF_FILENAMES.map((name) =>
  fs.readFileSync(path.join(REFS_DIR, name))
);

// ---- Confirmation gate -----------------------------------------------------
console.log("=".repeat(70));
console.log("LoRA training dataset generation — about to send 12 Gemini calls.");
console.log("=".repeat(70));
console.log(`Model:           ${MODEL}`);
console.log(`Estimated cost:  ${total} × $${COST_PER_IMAGE_USD.toFixed(2)} = $${(total * COST_PER_IMAGE_USD).toFixed(2)} USD`);
console.log(`Output dir:      ${OUT_DIR}`);
console.log();
console.log("Reference images (anchoring the character's identity):");
for (const name of REF_FILENAMES) {
  console.log(`  - ${path.join(REFS_DIR, name)}`);
}
console.log();
console.log("Base prompt (prepended to every variant):");
console.log("-".repeat(70));
console.log(basePrompt);
console.log("-".repeat(70));
console.log();
console.log("Each call sends: base prompt + 'Framing for this image: <variant>.' + reference-image instruction.");
console.log();
console.log("Per-image variant prompts:");
console.log("-".repeat(70));
for (let i = 0; i < total; i++) {
  console.log(`  ${String(i + 1).padStart(2, " ")}. ${trainingPrompts[i]}`);
}
console.log("-".repeat(70));
console.log();

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const answer = await rl.question("Type CONFIRM to proceed (anything else aborts): ");
rl.close();

if (answer.trim() !== "CONFIRM") {
  console.log("Aborted. No API call made. No cost incurred.");
  process.exit(0);
}

// ---- Generate ---------------------------------------------------------------
fs.mkdirSync(OUT_DIR, { recursive: true });

console.log();
console.log(`Generating ${total} training images...`);

const promptLog = {};
let runningCost = 0;

for (let i = 0; i < total; i++) {
  const variantPrompt = trainingPrompts[i];
  const fullPrompt =
    `${basePrompt}\n\n` +
    `Framing for this image: ${variantPrompt}.\n\n` +
    `Use the provided reference images of the character to keep his appearance, clothing, and proportions consistent.`;

  const t0 = Date.now();
  const buf = await generateImage(fullPrompt, refBuffers);
  const ms = Date.now() - t0;

  const num = String(i + 1).padStart(2, "0");
  const filename = `train-${num}.png`;
  fs.writeFileSync(path.join(OUT_DIR, filename), buf);
  promptLog[`training-set/${filename}`] = fullPrompt;

  runningCost += COST_PER_IMAGE_USD;
  console.log(`  → [${i + 1}/${total}] ${filename}  (${ms}ms)  running cost: $${runningCost.toFixed(2)}`);
  if (ms > 60000) {
    console.log(`  ⚠ slow call (${(ms / 1000).toFixed(1)}s) — possibly rate-limit retry.`);
  }

  // Pace: enforce ≥6s between this call's start and the next call's start.
  // Skip on the final iteration to avoid a useless 6s wait at program exit.
  if (i < total - 1 && ms < MIN_CALL_GAP_MS) {
    await sleep(MIN_CALL_GAP_MS - ms);
  }
}

// ---- Write the prompt log --------------------------------------------------
const log = {
  model: MODEL,
  timestamp: new Date().toISOString(),
  references_used: REF_FILENAMES.map((name) => `output/character-sheet/${name}`),
  estimated_total_cost_usd: Number(runningCost.toFixed(2)),
  images: promptLog,
};
fs.writeFileSync(PROMPT_LOG_PATH, JSON.stringify(log, null, 2));

console.log();
console.log(`Done. ${total} images written:`);
console.log(`  • ${OUT_DIR}`);
console.log(`Prompt log:      ${PROMPT_LOG_PATH}`);
console.log(`Estimated total: $${runningCost.toFixed(2)} USD`);
