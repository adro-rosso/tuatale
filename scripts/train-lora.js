// scripts/train-lora.js
// Phase 2 Step 3 — train a custom FLUX LoRA on Replicate using our 12-image
// training set. End-to-end: zip → gate → upload → create destination model →
// start training → poll → write outputs.
//
// Hard rules:
//   - Confirmation gate before any spend.
//   - Poll every 30s; max 60 min then timeout.
//   - On success: write output/lora/trained-model.json, exit 0.
//   - On failure (failed/canceled): write output/lora/training-failed.json
//     with diagnostics + estimated cost incurred, exit 1.
//   - State file output/lora/training-state.json written at kickoff so a
//     terminal crash doesn't lose the training ID.
//   - No retry, no resume. Fail loudly with all data on disk.

import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { fileURLToPath } from "node:url";
import Replicate from "replicate";
import JSZip from "jszip";

// ---- Paths -----------------------------------------------------------------
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, "..");
const TRAINING_SET_DIR = path.join(PROJECT_ROOT, "output", "training-set");
const LORA_DIR = path.join(PROJECT_ROOT, "output", "lora");
const ZIP_PATH = path.join(LORA_DIR, "training-input.zip");
const STATE_PATH = path.join(LORA_DIR, "training-state.json");
const SUCCESS_PATH = path.join(LORA_DIR, "trained-model.json");
const FAILED_PATH = path.join(LORA_DIR, "training-failed.json");

// ---- Config (tweak by editing these constants) ----------------------------
const TRAINER_OWNER = "ostris";
const TRAINER_NAME = "flux-dev-lora-trainer";
const DESTINATION_NAME = "dabookting-testchild-v1"; // bump to -v2 when retraining
const TRIGGER_WORD = "DBTK1";
const TRAINING_STEPS = 1000;
const POLL_INTERVAL_MS = 30_000;
const MAX_WAIT_MS = 60 * 60 * 1000;
const H100_USD_PER_SECOND = 0.001525;
const TYPICAL_DURATION_SEC = 25 * 60;
const ESTIMATED_COST_USD = TYPICAL_DURATION_SEC * H100_USD_PER_SECOND;

const TRAIN_FILENAMES = Array.from({ length: 12 }, (_, i) =>
  `train-${String(i + 1).padStart(2, "0")}.png`
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- Preflight: token, training images, lora dir --------------------------
if (!process.env.REPLICATE_API_TOKEN) {
  console.error("FAIL: REPLICATE_API_TOKEN is not set in .env.");
  process.exit(1);
}
for (const name of TRAIN_FILENAMES) {
  const p = path.join(TRAINING_SET_DIR, name);
  if (!fs.existsSync(p)) {
    console.error(`FAIL: training image not found: ${p}`);
    console.error("Phase 2 Step 2 (generate-training-set.js) must complete first.");
    process.exit(1);
  }
}
fs.mkdirSync(LORA_DIR, { recursive: true });

// ---- Init Replicate, fetch username and trainer version -------------------
const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN });

console.log("Fetching account and trainer metadata...");
const account = await replicate.accounts.current();
const username = account.username;
const destinationModel = `${username}/${DESTINATION_NAME}`;

const trainerModel = await replicate.models.get(TRAINER_OWNER, TRAINER_NAME);
if (!trainerModel.latest_version) {
  console.error(`FAIL: ${TRAINER_OWNER}/${TRAINER_NAME} has no published version.`);
  process.exit(1);
}
const trainerVersionId = trainerModel.latest_version.id;
const trainerRef = `${TRAINER_OWNER}/${TRAINER_NAME}:${trainerVersionId}`;
console.log(`  Username:        ${username}`);
console.log(`  Trainer version: ${trainerVersionId}`);

// Fetch the trainer's input schema so the gate can print ACTUAL defaults for
// fields we're not setting explicitly. If the fetch or schema parse fails
// for any reason, we still proceed but mark those defaults as "(unverified)"
// in the gate — never lie, never crash.
let trainerDefaults = null;
try {
  const versionDetails = await replicate.models.versions.get(
    TRAINER_OWNER,
    TRAINER_NAME,
    trainerVersionId
  );
  const props = versionDetails.openapi_schema?.components?.schemas?.Input?.properties;
  if (props) {
    trainerDefaults = {
      learning_rate: props.learning_rate?.default,
      lora_rank: props.lora_rank?.default,
      caption_dropout_rate: props.caption_dropout_rate?.default,
      resolution: props.resolution?.default,
      autocaption_prefix: props.autocaption_prefix?.default,
    };
  }
} catch (err) {
  console.log(`  (note: schema fetch failed — defaults will print as unverified: ${err?.message ?? err})`);
}

/** Format a trainer default for display in the gate. */
const fmtDefault = (key) => {
  if (!trainerDefaults) return "trainer default (unverified)";
  const v = trainerDefaults[key];
  return v !== undefined ? `trainer default = ${v}` : "trainer default (unverified)";
};

// ---- Build zip in memory --------------------------------------------------
console.log();
console.log("Building training zip in memory...");
const zip = new JSZip();
let totalUncompressedBytes = 0;
const sizeRows = [];
for (const name of TRAIN_FILENAMES) {
  const buf = fs.readFileSync(path.join(TRAINING_SET_DIR, name));
  zip.file(name, buf);
  totalUncompressedBytes += buf.length;
  sizeRows.push({ name, sizeKB: (buf.length / 1024).toFixed(0) });
}
const zipBuffer = await zip.generateAsync({ type: "nodebuffer" });
console.log(
  `  Built: ${(zipBuffer.length / 1024 / 1024).toFixed(2)} MB compressed ` +
  `(from ${(totalUncompressedBytes / 1024 / 1024).toFixed(2)} MB uncompressed)`
);

// ---- Confirmation gate ----------------------------------------------------
console.log();
console.log("=".repeat(70));
console.log("LoRA training — about to start a paid run on Replicate.");
console.log("=".repeat(70));
console.log(`Trainer:           ${trainerRef}`);
console.log(`Destination:       ${destinationModel}`);
console.log(`Trigger word:      ${TRIGGER_WORD}`);
console.log("Hyperparameters:");
console.log(`  steps:                ${TRAINING_STEPS} (set explicitly)`);
console.log(`  trigger_word:         ${TRIGGER_WORD} (set explicitly)`);
console.log(`  autocaption:          true (set explicitly)`);
console.log(`  learning_rate:        ${fmtDefault("learning_rate")}`);
console.log(`  lora_rank:            ${fmtDefault("lora_rank")}`);
console.log(`  caption_dropout_rate: ${fmtDefault("caption_dropout_rate")}`);
console.log(`  resolution:           ${fmtDefault("resolution")}`);
console.log(`  autocaption_prefix:   ${fmtDefault("autocaption_prefix")}`);
console.log(`Estimated cost:    ~$${ESTIMATED_COST_USD.toFixed(2)} USD (~25 min on H100 at $${H100_USD_PER_SECOND}/s)`);
console.log(`Estimated time:    ~25 minutes (leave the terminal open)`);
console.log();
console.log(`Training images (${TRAIN_FILENAMES.length}):`);
for (const row of sizeRows) {
  console.log(`  - ${row.name}  (${row.sizeKB} KB)`);
}
console.log(`  Total uncompressed: ${(totalUncompressedBytes / 1024 / 1024).toFixed(2)} MB`);
console.log(`  Compressed zip:     ${(zipBuffer.length / 1024 / 1024).toFixed(2)} MB`);
console.log();
console.log("Output on success:");
console.log(`  - destination model populated and runnable`);
console.log(`  - ${SUCCESS_PATH}`);
console.log(`  - ${ZIP_PATH} (kept for reproducibility)`);
console.log("Output on failure:");
console.log(`  - ${FAILED_PATH} (failure reason + cost incurred + last logs)`);
console.log("  - exit code 1");
console.log();

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const answer = await rl.question("Type CONFIRM to proceed (anything else aborts): ");
rl.close();

if (answer.trim() !== "CONFIRM") {
  console.log("Aborted. No upload, no training, no cost incurred.");
  process.exit(0);
}

// ---- Upload zip + save locally --------------------------------------------
console.log();
console.log("Uploading training zip to Replicate...");
const fileObj = await replicate.files.create(zipBuffer);
const inputImagesUrl = fileObj.urls.get;
console.log(`  Upload complete. URL: ${inputImagesUrl}`);
fs.writeFileSync(ZIP_PATH, zipBuffer);
console.log(`  Saved locally: ${ZIP_PATH}`);

// ---- Ensure destination model exists --------------------------------------
console.log();
console.log("Ensuring destination model exists...");
try {
  await replicate.models.get(username, DESTINATION_NAME);
  console.log(`  Found existing: ${destinationModel}`);
} catch (err) {
  // Replicate's SDK throws ApiError with .response set. Treat 404 as "create it."
  const status = err?.response?.status;
  if (status === 404 || /not found/i.test(err?.message ?? "")) {
    console.log(`  Not found. Creating private model: ${destinationModel}`);
    // hardware is required by Replicate's API (verified May 2026 against
    // /docs/reference/http models.create endpoint). It controls the GPU
    // SKU used when running PREDICTIONS on this model — i.e. when we run
    // our trained LoRA for inference in Phase 2 Step 4. flux-dev requires
    // H100-class hardware, so "gpu-h100" is deliberate, not speculative.
    await replicate.models.create(username, DESTINATION_NAME, {
      visibility: "private",
      hardware: "gpu-h100",
      description: "Custom LoRA for DaBookTing — character TestChild (Phase 2 spike)",
    });
    console.log(`  Created.`);
  } else {
    throw err;
  }
}

// ---- Kick off training ----------------------------------------------------
console.log();
console.log("Starting training...");
const startedAtLocal = new Date();
const training = await replicate.trainings.create(
  TRAINER_OWNER,
  TRAINER_NAME,
  trainerVersionId,
  {
    destination: destinationModel,
    input: {
      input_images: inputImagesUrl,
      trigger_word: TRIGGER_WORD,
      steps: TRAINING_STEPS,
      autocaption: true,
    },
  }
);
console.log("  Training started.");
console.log(`  Training ID:   ${training.id}`);
console.log(`  Status:        ${training.status}`);
console.log(`  Dashboard:     ${training.urls?.web ?? `https://replicate.com/p/${training.id}`}`);

// ---- Persist initial state immediately ------------------------------------
const stateData = {
  training_id: training.id,
  started_at: training.created_at ?? startedAtLocal.toISOString(),
  destination_model: destinationModel,
  trigger_word: TRIGGER_WORD,
  trainer_version: trainerRef,
  input_images_count: TRAIN_FILENAMES.length,
  input_images_zip_url: inputImagesUrl,
};
fs.writeFileSync(STATE_PATH, JSON.stringify(stateData, null, 2));
console.log(`  State saved:   ${STATE_PATH}`);

// ---- Poll loop ------------------------------------------------------------
console.log();
console.log("Polling for completion (every 30s, max 60 min)...");
console.log();

const TERMINAL_STATUSES = new Set(["succeeded", "failed", "canceled"]);
const pollStart = Date.now();
let currentTraining = training;

while (!TERMINAL_STATUSES.has(currentTraining.status)) {
  const elapsedMs = Date.now() - pollStart;
  if (elapsedMs > MAX_WAIT_MS) {
    console.log();
    console.log(`TIMEOUT after ${(elapsedMs / 60_000).toFixed(1)} min.`);
    console.log(`Training ${training.id} is still running server-side.`);
    console.log("Check the dashboard for the eventual outcome.");
    process.exit(1);
  }

  await sleep(POLL_INTERVAL_MS);

  try {
    currentTraining = await replicate.trainings.get(training.id);
  } catch (err) {
    console.log(`  [poll error: ${err?.message ?? err}; will retry next tick]`);
    continue;
  }

  const ts = new Date().toISOString().slice(11, 19);
  const elapsedMin = ((Date.now() - pollStart) / 60_000).toFixed(1);
  console.log(`  [${ts}] elapsed ${elapsedMin}min  status: ${currentTraining.status ?? "(unknown)"}`);
}

// ---- Final state handling -------------------------------------------------
const completedAtLocal = new Date();
// Prefer Replicate's metrics for cost calc; fall back to local clock.
const predictTimeSec = currentTraining.metrics?.predict_time;
const localDurationSec = Math.floor((completedAtLocal - startedAtLocal) / 1000);
const billableDurationSec = predictTimeSec ?? localDurationSec;
const estimatedActualCost = billableDurationSec * H100_USD_PER_SECOND;
const durationSource = predictTimeSec !== undefined ? "metrics.predict_time" : "local-clock";

console.log();
console.log("=".repeat(70));

if (currentTraining.status === "succeeded") {
  const trainedModelData = {
    training_id: currentTraining.id,
    trainer_version: trainerRef,
    destination_model: destinationModel,
    destination_version_id: currentTraining.output?.version ?? null,
    trigger_word: TRIGGER_WORD,
    started_at: currentTraining.started_at ?? startedAtLocal.toISOString(),
    completed_at: currentTraining.completed_at ?? completedAtLocal.toISOString(),
    duration_seconds: billableDurationSec,
    duration_source: durationSource,
    training_steps: TRAINING_STEPS,
    estimated_cost_usd: Number(estimatedActualCost.toFixed(2)),
    weights_url: currentTraining.output?.weights ?? null,
    // Belt-and-suspenders: persist the full raw output object alongside
    // the typed fields. The SDK type only documents `version` and `weights`,
    // but Replicate may return additional fields the SDK doesn't enumerate.
    // If the typed fields are ever missing, raw_output preserves the
    // actual response for inspection.
    raw_output: currentTraining.output ?? null,
    input_images_zip_url: inputImagesUrl,
  };
  fs.writeFileSync(SUCCESS_PATH, JSON.stringify(trainedModelData, null, 2));

  console.log("Training SUCCEEDED.");
  console.log("=".repeat(70));
  console.log(`Duration:       ${(billableDurationSec / 60).toFixed(1)} min (${billableDurationSec}s, source: ${durationSource})`);
  console.log(`Estimated cost: $${estimatedActualCost.toFixed(2)} USD`);
  console.log(`Destination:    ${destinationModel}`);
  console.log(`Version ID:     ${trainedModelData.destination_version_id ?? "(not provided by SDK)"}`);
  console.log(`Weights URL:    ${trainedModelData.weights_url ? "(saved to JSON)" : "(not provided)"}`);
  console.log(`Raw output:     ${JSON.stringify(currentTraining.output)}`);
  console.log(`Saved:          ${SUCCESS_PATH}`);
  process.exit(0);
} else {
  const failureData = {
    training_id: currentTraining.id,
    trainer_version: trainerRef,
    destination_model: destinationModel,
    trigger_word: TRIGGER_WORD,
    started_at: currentTraining.started_at ?? startedAtLocal.toISOString(),
    completed_at: currentTraining.completed_at ?? completedAtLocal.toISOString(),
    duration_seconds: billableDurationSec,
    duration_source: durationSource,
    training_steps_attempted: TRAINING_STEPS,
    estimated_cost_incurred_usd: Number(estimatedActualCost.toFixed(2)),
    final_status: currentTraining.status,
    error: currentTraining.error
      ? (typeof currentTraining.error === "string"
          ? currentTraining.error
          : JSON.stringify(currentTraining.error))
      : null,
    logs: currentTraining.logs ?? null,
    input_images_zip_url: inputImagesUrl,
  };
  fs.writeFileSync(FAILED_PATH, JSON.stringify(failureData, null, 2));

  console.log(`Training ${currentTraining.status.toUpperCase()}.`);
  console.log("=".repeat(70));
  console.log(`Status:         ${currentTraining.status}`);
  console.log(`Duration:       ${(billableDurationSec / 60).toFixed(1)} min (${billableDurationSec}s)`);
  console.log(`Estimated cost incurred: $${estimatedActualCost.toFixed(2)} USD`);
  if (failureData.error) {
    console.log(`Error:          ${failureData.error}`);
  }
  if (currentTraining.logs) {
    console.log();
    console.log("Last 30 log lines:");
    console.log("-".repeat(70));
    const tail = currentTraining.logs.split("\n").slice(-30).join("\n");
    console.log(tail);
    console.log("-".repeat(70));
  }
  console.log();
  console.log(`Failure data: ${FAILED_PATH}`);
  process.exit(1);
}
