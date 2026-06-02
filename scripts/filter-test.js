// scripts/filter-test.js
// Phase 2 Step 1 — single-call FLUX filter test.
// Sends ONE inference request to base flux-dev (no LoRA, no character training)
// to verify whether the safety filter accepts our character prompt before we
// commit ~$2 to a LoRA training run.
//
// Hard rules in this file:
//   - Exactly ONE inference call. No loop, no list, no retry.
//   - Confirmation gate at the start (type CONFIRM to proceed, anything else aborts).
//   - Prediction ID logged so cost can be verified on the Replicate dashboard.
//   - Token never logged. Safety-filter / failure cases surface loudly.

import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { fileURLToPath } from "node:url";
import Replicate from "replicate";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, "..");
const SCRIPT_PATH = path.join(PROJECT_ROOT, "test-script.json");
const OUT_DIR = path.join(PROJECT_ROOT, "output", "flux-filter-test");
const OUT_FILE = path.join(OUT_DIR, "test.png");

// `black-forest-labs/flux-dev` is an official Replicate model — no version
// hash required. Verified via the installed replicate@1.4.0 SDK types:
// predictions.create accepts { model: string } as an alternative to { version }.
const MODEL = "black-forest-labs/flux-dev";

// Replicate's published per-image rate for flux-dev. Source: replicate.com/pricing.
const ESTIMATED_COST_USD = 0.025;

// ---- Build the prompt ------------------------------------------------------
// Same fields and structure as src/pipeline.js so the filter test result is
// directly comparable to Phase 1 Gemini output.
const script = JSON.parse(fs.readFileSync(SCRIPT_PATH, "utf8"));
const { character, style, composition_rules, negative_prompt, scenes } = script;
const action = scenes[0].action; // page 1

const prompt = [
  `Subject: a ${character.age}-year-old boy.`,
  `Appearance: ${character.description}.`,
  `Style: ${style}.`,
  `Composition: ${composition_rules}.`,
  // FLUX has no separate negative_prompt input — same situation as Gemini.
  // Inline as "Avoid:" clause. Soft constraint, not hard.
  `Avoid: ${negative_prompt}.`,
  ``,
  `Scene: the boy is ${action}.`,
].join("\n");

// ---- Confirmation gate -----------------------------------------------------
console.log("=".repeat(60));
console.log("FLUX-dev filter test — about to send ONE inference call.");
console.log("=".repeat(60));
console.log(`Model:           ${MODEL}`);
console.log(`Estimated cost:  $${ESTIMATED_COST_USD.toFixed(3)} USD (well under the $0.20 ceiling)`);
console.log(`Output:          ${OUT_FILE}`);
console.log();
console.log("Prompt being sent:");
console.log("-".repeat(60));
console.log(prompt);
console.log("-".repeat(60));
console.log();

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const answer = await rl.question("Type CONFIRM to proceed (anything else aborts): ");
rl.close();

if (answer.trim() !== "CONFIRM") {
  console.log("Aborted. No API call made. No cost incurred.");
  process.exit(0);
}

// ---- Make the call ---------------------------------------------------------
console.log();
console.log("Calling FLUX-dev...");

const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN });

const t0 = Date.now();
const prediction = await replicate.predictions.create({
  model: MODEL,
  input: { prompt },
  wait: true, // block until completion; no manual polling needed
});
const elapsedMs = Date.now() - t0;

console.log(`Elapsed:         ${(elapsedMs / 1000).toFixed(1)}s`);
console.log(`Prediction ID:   ${prediction.id}`);
console.log(`Status:          ${prediction.status}`);

// ---- Check for failure / safety-filter cases ------------------------------
if (prediction.status !== "succeeded") {
  console.log();
  console.log(`FAIL: prediction did not succeed (status: ${prediction.status}).`);
  if (prediction.error) console.log(`Error: ${prediction.error}`);
  if (prediction.logs)  console.log(`Logs:\n${prediction.logs}`);
  console.log("No image written.");
  process.exit(1);
}

const outputArray = Array.isArray(prediction.output) ? prediction.output : [prediction.output];
const outputUrl = outputArray[0];

if (!outputUrl || typeof outputUrl !== "string") {
  console.log();
  console.log(`FAIL: unexpected output shape. Got: ${JSON.stringify(prediction.output)}`);
  console.log("No image written.");
  process.exit(1);
}

console.log(`Output URL:      ${outputUrl}`);

// ---- Download and save -----------------------------------------------------
fs.mkdirSync(OUT_DIR, { recursive: true });
const response = await fetch(outputUrl);
if (!response.ok) {
  console.log();
  console.log(`FAIL: could not download image. HTTP ${response.status}.`);
  console.log("No image written.");
  process.exit(1);
}
const buffer = Buffer.from(await response.arrayBuffer());
fs.writeFileSync(OUT_FILE, buffer);

console.log();
console.log(`Saved:           ${OUT_FILE} (${buffer.length} bytes)`);

// ---- Cost & timing summary ------------------------------------------------
// SDK exposes only predict_time + total_time on prediction.metrics — no
// direct billed-cost field. For flat-priced models (flux-dev), actual cost
// is the published rate. The "as-if H100/s" line is calibration only —
// shows what this call would have cost if billed per-second on H100, which
// is the rate that WILL apply to LoRA inference later.
console.log();
console.log("Cost & timing:");
const predictTime = prediction.metrics?.predict_time;
const totalTime = prediction.metrics?.total_time;
if (predictTime !== undefined) console.log(`  Predict time:  ${predictTime.toFixed(2)}s (GPU compute)`);
if (totalTime !== undefined)   console.log(`  Total time:    ${totalTime.toFixed(2)}s (incl. queue)`);
console.log(`  Actual cost:   $${ESTIMATED_COST_USD.toFixed(3)} (flat per-image rate; flux-dev is not per-second billed)`);
if (predictTime !== undefined) {
  const hypothetical = predictTime * 0.001525;
  console.log(`  As-if H100/s:  $${hypothetical.toFixed(4)} (calibration vs the LoRA inference path later)`);
}

console.log();
console.log("Done. Open the image to inspect quality and verify the character looks right.");
