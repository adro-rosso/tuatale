// scripts/generate-flux-scenes.js
// Phase 2 Step 4 — generate the 12 comparison scenes using our trained
// FLUX LoRA on Replicate. Mirrors Phase 1's Gemini scene generation so
// outputs can be compared side-by-side with output/scenes/.
//
// Hard rules:
//   - Confirmation gate before any spend.
//   - Continue on failure: a single bad scene doesn't block the others.
//   - Per-image cost + prediction ID logged; running total tracked.
//   - prompts.json records status per image (succeeded/failed) and summary.
//   - Exit code 0 if all 12 succeed, 1 if any failed.

import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { fileURLToPath } from "node:url";
import Replicate from "replicate";

// ---- Paths -----------------------------------------------------------------
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, "..");
const TRAINED_MODEL_PATH = path.join(PROJECT_ROOT, "output", "lora", "trained-model.json");
const SCRIPT_PATH = path.join(PROJECT_ROOT, "test-script.json");
const OUT_DIR = path.join(PROJECT_ROOT, "output", "flux-scenes");
const PROMPT_LOG_PATH = path.join(OUT_DIR, "prompts.json");

// ---- Config (tweak by editing) --------------------------------------------
const LORA_SCALE = 1.0;        // tight identity lock
const OUTPUT_FORMAT = "png";   // match Gemini outputs for comparison
const ASPECT_RATIO = "1:1";    // match Gemini's 1024×1024 for like-for-like
const DELAY_MS = 1000;         // 1s between calls — politeness, no rate-limit pressure
const H100_USD_PER_SECOND = 0.001525;
const ASSUMED_PREDICT_TIME_SEC = 10; // for upfront cost estimate; actuals are tracked

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- Preflight: token + state files ---------------------------------------
if (!process.env.REPLICATE_API_TOKEN) {
  console.error("FAIL: REPLICATE_API_TOKEN is not set in .env.");
  process.exit(1);
}
if (!fs.existsSync(TRAINED_MODEL_PATH)) {
  console.error(`FAIL: ${TRAINED_MODEL_PATH} not found.`);
  console.error("Phase 2 Step 3 (train-lora.js) must complete successfully before this step.");
  process.exit(1);
}
if (!fs.existsSync(SCRIPT_PATH)) {
  console.error(`FAIL: ${SCRIPT_PATH} not found.`);
  process.exit(1);
}

// ---- Read state and script ------------------------------------------------
const trainedModel = JSON.parse(fs.readFileSync(TRAINED_MODEL_PATH, "utf8"));
const script = JSON.parse(fs.readFileSync(SCRIPT_PATH, "utf8"));

const requiredFields = ["destination_model", "destination_version_id", "trigger_word"];
for (const f of requiredFields) {
  if (!trainedModel[f]) {
    console.error(`FAIL: ${TRAINED_MODEL_PATH} missing required field: ${f}`);
    process.exit(1);
  }
}

const DESTINATION_MODEL = trainedModel.destination_model;        // e.g. "adro-rosso/dabookting-testchild-v1"
const VERSION_ID = trainedModel.destination_version_id;          // 64-char hex
const TRIGGER_WORD = trainedModel.trigger_word;                  // "DBTK1"
const MODEL_REF = `${DESTINATION_MODEL}:${VERSION_ID}`;

const scenes = script.scenes;
if (!Array.isArray(scenes) || scenes.length === 0) {
  console.error(`FAIL: ${SCRIPT_PATH} has no 'scenes' array.`);
  process.exit(1);
}

// ---- Init Replicate -------------------------------------------------------
const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN });

// ---- Fetch destination model schema for verified defaults -----------------
console.log("Fetching destination model schema for default verification...");
const [destOwner, destName] = DESTINATION_MODEL.split("/");

let destDefaults = null;
try {
  const versionDetails = await replicate.models.versions.get(
    destOwner,
    destName,
    VERSION_ID
  );
  const props = versionDetails.openapi_schema?.components?.schemas?.Input?.properties;
  if (props) {
    destDefaults = {
      num_inference_steps: props.num_inference_steps?.default,
      guidance_scale: props.guidance_scale?.default,
      output_quality: props.output_quality?.default,
      model: props.model?.default,
      lora_scale: props.lora_scale?.default,
      output_format: props.output_format?.default,
      aspect_ratio: props.aspect_ratio?.default,
      num_outputs: props.num_outputs?.default,
      disable_safety_checker: props.disable_safety_checker?.default,
    };
  }
} catch (err) {
  console.log(`  (note: schema fetch failed — defaults will print as unverified: ${err?.message ?? err})`);
}

const fmtDefault = (key) => {
  if (!destDefaults) return "model default (unverified)";
  const v = destDefaults[key];
  return v !== undefined ? `model default = ${v}` : "model default (unverified)";
};

// ---- Build prompts --------------------------------------------------------
const { style, composition_rules, negative_prompt } = script;

/**
 * Prompt template:
 *   <TRIGGER> the boy, a 6-year-old, <action>.
 *
 *   Style: ...
 *   Composition: ...
 *   Avoid: ...
 *
 * Appearance description is intentionally dropped — encoded in the LoRA.
 * Age anchor "a 6-year-old" is a cheap hedge against the LoRA drifting older
 * (a known FLUX failure mode for child character LoRAs). Doesn't fight the
 * LoRA; reinforces it.
 */
function buildPrompt(action) {
  return [
    `${TRIGGER_WORD} the boy, a 6-year-old, ${action}.`,
    ``,
    `Style: ${style}.`,
    `Composition: ${composition_rules}.`,
    `Avoid: ${negative_prompt}.`,
  ].join("\n");
}

const prompts = scenes.map((scene) => ({
  page: scene.page,
  action: scene.action,
  prompt: buildPrompt(scene.action),
}));

// ---- Confirmation gate ----------------------------------------------------
const total = prompts.length;
const upfrontEstimate = total * ASSUMED_PREDICT_TIME_SEC * H100_USD_PER_SECOND;

console.log();
console.log("=".repeat(70));
console.log(`FLUX LoRA scene generation — about to send ${total} inference calls.`);
console.log("=".repeat(70));
console.log(`Destination:       ${DESTINATION_MODEL}`);
console.log(`Version:           ${VERSION_ID}`);
console.log(`Trigger word:      ${TRIGGER_WORD}`);
console.log(`Output dir:        ${OUT_DIR}`);
console.log();
console.log("Inference inputs:");
console.log(`  prompt:                  per-scene (see below)`);
console.log(`  lora_scale:              ${LORA_SCALE} (set explicitly)`);
console.log(`  output_format:           "${OUTPUT_FORMAT}" (set explicitly)`);
console.log(`  aspect_ratio:            "${ASPECT_RATIO}" (set explicitly)`);
console.log(`  num_inference_steps:     ${fmtDefault("num_inference_steps")}`);
console.log(`  guidance_scale:          ${fmtDefault("guidance_scale")}`);
console.log(`  num_outputs:             ${fmtDefault("num_outputs")}`);
console.log(`  model:                   ${fmtDefault("model")}`);
console.log(`  output_quality:          ${fmtDefault("output_quality")}`);
console.log(`  disable_safety_checker:  ${fmtDefault("disable_safety_checker")}`);
console.log();
console.log(`Estimated cost:    ~$${upfrontEstimate.toFixed(2)} USD ` +
  `(${total} × ~${ASSUMED_PREDICT_TIME_SEC}s × $${H100_USD_PER_SECOND}/s on H100)`);
console.log(`                   Worst case ~$${(total * 0.025).toFixed(2)} if billed at flat $0.025/image rate`);
console.log();
console.log(`Per-scene prompts (each starts with "${TRIGGER_WORD} the boy, a 6-year-old, "):`);
console.log("-".repeat(70));
for (const p of prompts) {
  const preview = p.action.length > 55 ? p.action.slice(0, 55) + "…" : p.action;
  console.log(`  ${String(p.page).padStart(2, " ")}. ${preview}`);
}
console.log("-".repeat(70));
console.log();
console.log("Behaviour on per-scene failure: continue, log, summarise at end.");
console.log("Exit code: 0 if all succeed, 1 if any fail.");
console.log();

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const answer = await rl.question("Type CONFIRM to proceed (anything else aborts): ");
rl.close();

if (answer.trim() !== "CONFIRM") {
  console.log("Aborted. No API calls made. No cost incurred.");
  process.exit(0);
}

// ---- Generate -------------------------------------------------------------
fs.mkdirSync(OUT_DIR, { recursive: true });

console.log();
console.log(`Generating ${total} scene images...`);

const results = {};
let successes = 0;
let failures = 0;
let runningCostEstimate = 0;
const startedAt = new Date();

for (let i = 0; i < total; i++) {
  const { page, action, prompt } = prompts[i];
  const pageNum = String(page).padStart(2, "0");
  const filename = `flux-page-${pageNum}.png`;
  const filePath = path.join(OUT_DIR, filename);
  const logKey = `flux-scenes/${filename}`;

  try {
    const t0 = Date.now();
    const prediction = await replicate.predictions.create({
      version: VERSION_ID,
      input: {
        prompt: prompt,
        lora_scale: LORA_SCALE,
        output_format: OUTPUT_FORMAT,
        aspect_ratio: ASPECT_RATIO,
      },
      wait: true,
    });
    const wallMs = Date.now() - t0;

    if (prediction.status !== "succeeded") {
      throw new Error(
        `prediction status: ${prediction.status}` +
        (prediction.error
          ? ` — ${typeof prediction.error === "string" ? prediction.error : JSON.stringify(prediction.error)}`
          : "")
      );
    }

    const outputArray = Array.isArray(prediction.output) ? prediction.output : [prediction.output];
    const outputUrl = outputArray[0];
    if (!outputUrl || typeof outputUrl !== "string") {
      throw new Error(`unexpected output shape: ${JSON.stringify(prediction.output)}`);
    }

    const response = await fetch(outputUrl);
    if (!response.ok) {
      throw new Error(`download failed HTTP ${response.status}`);
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    fs.writeFileSync(filePath, buffer);

    const predictTimeSec = prediction.metrics?.predict_time;
    const billableSec = predictTimeSec ?? wallMs / 1000;
    const costEstimate = billableSec * H100_USD_PER_SECOND;
    runningCostEstimate += costEstimate;

    results[logKey] = {
      prompt: prompt,
      prediction_id: prediction.id,
      predict_time_seconds: predictTimeSec ?? null,
      wall_time_seconds: Number((wallMs / 1000).toFixed(2)),
      estimated_cost_usd: Number(costEstimate.toFixed(4)),
      status: "succeeded",
    };
    successes++;

    const preview = action.length > 50 ? action.slice(0, 50) + "…" : action;
    console.log(
      `  → [${i + 1}/${total}] ${filename}  ${preview}  ` +
      `(predict: ${(predictTimeSec ?? wallMs / 1000).toFixed(1)}s, $${costEstimate.toFixed(4)})  ` +
      `running: $${runningCostEstimate.toFixed(2)}`
    );
  } catch (err) {
    const message = err?.message ?? String(err);
    results[logKey] = {
      prompt: prompt,
      status: "failed",
      error: message,
    };
    failures++;
    console.log(`  ✗ [${i + 1}/${total}] ${filename}  FAILED: ${message}`);
  }

  if (i < total - 1) {
    await sleep(DELAY_MS);
  }
}

// ---- Write prompts.json ---------------------------------------------------
const completedAt = new Date();
const log = {
  model: MODEL_REF,
  trigger_word: TRIGGER_WORD,
  lora_scale: LORA_SCALE,
  output_format: OUTPUT_FORMAT,
  aspect_ratio: ASPECT_RATIO,
  started_at: startedAt.toISOString(),
  completed_at: completedAt.toISOString(),
  duration_seconds: Math.floor((completedAt - startedAt) / 1000),
  successes: successes,
  failures: failures,
  estimated_total_cost_usd: Number(runningCostEstimate.toFixed(2)),
  images: results,
};
fs.writeFileSync(PROMPT_LOG_PATH, JSON.stringify(log, null, 2));

// ---- Final summary --------------------------------------------------------
console.log();
console.log("=".repeat(70));
console.log(`Summary: ${successes} succeeded, ${failures} failed`);
console.log("=".repeat(70));
if (failures > 0) {
  console.log("Failed scenes:");
  for (const [key, info] of Object.entries(results)) {
    if (info.status === "failed") {
      console.log(`  - ${key}: ${info.error}`);
    }
  }
  console.log();
}
console.log(`Estimated total cost: $${runningCostEstimate.toFixed(2)} USD`);
console.log("Outputs:");
console.log(`  • ${OUT_DIR} (${successes} PNG${successes !== 1 ? "s" : ""})`);
console.log(`  • ${PROMPT_LOG_PATH}`);
console.log();
process.exit(failures > 0 ? 1 : 0);
