// src/pipeline.js
// The two-step image generation pipeline for the spike.
//
//   Section A — generate 3 character-sheet reference views from
//               test-script.json's `character_sheet_prompts`.
//   Section B — for each of the 12 scenes, generate one image using
//               those 3 reference views as character references.
//
// Every Gemini call is spaced 2 seconds apart via sleep() to stay under
// the free-tier rate limit. Output PNGs land in output/character-sheet/
// and output/scenes/, plus a prompts.json log at output/prompts.json.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateImage, MODEL } from "./gemini.js";

// Resolve paths relative to the project root, so this works no matter
// what directory `node` was invoked from.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, "..");
const SCRIPT_PATH = path.join(PROJECT_ROOT, "test-script.json");
const OUTPUT_DIR = path.join(PROJECT_ROOT, "output");
const CHARACTER_SHEET_DIR = path.join(OUTPUT_DIR, "character-sheet");
const SCENES_DIR = path.join(OUTPUT_DIR, "scenes");
const PROMPT_LOG_PATH = path.join(OUTPUT_DIR, "prompts.json");

// Pacing: ensure at least 6 seconds elapse between the START of each
// consecutive Gemini call. This gives Tier 1 paid-quota windows room to
// breathe and avoids triggering the SDK's silent 429 retry storm.
// Implemented as: after each call completes, sleep whatever remains of
// the 6s window (i.e. if the call took 4s, sleep 2s; if it took 25s, 0s).
const MIN_CALL_GAP_MS = 6000;

/** Pause execution for `ms` milliseconds. */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Build the prompt fragment shared by every call: character description,
 * style, composition rules, and the inlined negative-prompt clause.
 *
 * Gemini has no separate negative_prompt field; we inline it as an
 * "Avoid:" clause. Soft constraint, not hard — the model treats it as
 * guidance, not a hard filter.
 *
 * Note: character.name is intentionally NOT included here. The name is
 * only used for filenames/logs; putting it in the prompt risks the model
 * trying to render it as text in the image.
 */
function buildBasePrompt(script) {
  const { character, style, composition_rules, negative_prompt } = script;
  return [
    `Subject: a ${character.age}-year-old boy.`,
    `Appearance: ${character.description}.`,
    `Style: ${style}.`,
    `Composition: ${composition_rules}.`,
    `Avoid: ${negative_prompt}.`,
  ].join("\n");
}

/** Run the full pipeline end to end. */
export async function runPipeline() {
  // Make sure output directories exist (cheap and safe — no-op if present).
  fs.mkdirSync(CHARACTER_SHEET_DIR, { recursive: true });
  fs.mkdirSync(SCENES_DIR, { recursive: true });

  // Read and parse the locked test input.
  const script = JSON.parse(fs.readFileSync(SCRIPT_PATH, "utf8"));
  const basePrompt = buildBasePrompt(script);

  // Per-image prompt log. Keys are paths relative to output/, e.g.
  // "character-sheet/sheet-01.png" or "scenes/page-07.png". Written to
  // prompts.json at the end of the run for debugging consistency failures.
  const promptLog = {};

  // -------------------------------------------------------------------
  // Section A — character sheet (reference views)
  // -------------------------------------------------------------------
  const sheetCount = script.character_sheet_prompts.length;
  console.log(`Step 1/2: Generating character sheet (${sheetCount} reference views)...`);

  const characterSheetBuffers = [];
  for (let i = 0; i < sheetCount; i++) {
    const viewPrompt = script.character_sheet_prompts[i];
    const fullPrompt = `${basePrompt}\n\nView for this image: ${viewPrompt}.`;

    const t0 = Date.now();
    const buf = await generateImage(fullPrompt);
    const ms = Date.now() - t0;

    const sheetNum = String(i + 1).padStart(2, "0");
    const filename = `sheet-${sheetNum}.png`;
    fs.writeFileSync(path.join(CHARACTER_SHEET_DIR, filename), buf);
    characterSheetBuffers.push(buf);
    promptLog[`character-sheet/${filename}`] = fullPrompt;

    console.log(`  → [${i + 1}/${sheetCount}] ${filename}  (${ms}ms)`);
    if (ms > 60000) {
      console.log(`  ⚠ slow call (${(ms / 1000).toFixed(1)}s) — possibly rate-limit retry.`);
    }

    // Pace: enforce ≥6s between this call's start and the next call's start.
    // We're already `ms` past t0; sleep the remainder of the window if any.
    // (Last sheet iteration's sleep also covers the gap into Section B's first
    // call, so no separate cross-section sleep is needed.)
    if (ms < MIN_CALL_GAP_MS) await sleep(MIN_CALL_GAP_MS - ms);
  }

  // -------------------------------------------------------------------
  // Section B — scenes, each conditioned on the 3 character-sheet refs
  // -------------------------------------------------------------------
  const sceneCount = script.scenes.length;
  console.log(`\nStep 2/2: Generating ${sceneCount} scene images (each conditioned on the ${sheetCount} character-sheet references)...`);

  for (let i = 0; i < sceneCount; i++) {
    const scene = script.scenes[i];
    const fullPrompt =
      `${basePrompt}\n\n` +
      `Scene: the boy is ${scene.action}.\n\n` +
      `Use the provided reference images of the character to keep his appearance, clothing, and proportions consistent.`;

    const t0 = Date.now();
    const buf = await generateImage(fullPrompt, characterSheetBuffers);
    const ms = Date.now() - t0;

    const pageNum = String(scene.page).padStart(2, "0");
    const filename = `page-${pageNum}.png`;
    fs.writeFileSync(path.join(SCENES_DIR, filename), buf);
    promptLog[`scenes/${filename}`] = fullPrompt;

    const preview = scene.action.length > 50 ? `${scene.action.slice(0, 50)}…` : scene.action;
    console.log(`  → [${i + 1}/${sceneCount}] ${filename}  ${preview}  (${ms}ms)`);
    if (ms > 60000) {
      console.log(`  ⚠ slow call (${(ms / 1000).toFixed(1)}s) — possibly rate-limit retry.`);
    }

    // Pace: enforce ≥6s between this call's start and the next call's start.
    // Skip on the final iteration to avoid a useless 6s wait at program exit.
    if (i < sceneCount - 1 && ms < MIN_CALL_GAP_MS) {
      await sleep(MIN_CALL_GAP_MS - ms);
    }
  }

  // -------------------------------------------------------------------
  // Write the prompt log for debugging consistency failures.
  // -------------------------------------------------------------------
  const log = {
    model: MODEL,
    timestamp: new Date().toISOString(),
    images: promptLog,
  };
  fs.writeFileSync(PROMPT_LOG_PATH, JSON.stringify(log, null, 2));

  console.log(`\nDone. ${sheetCount + sceneCount} images written:`);
  console.log(`  • ${CHARACTER_SHEET_DIR}`);
  console.log(`  • ${SCENES_DIR}`);
  console.log(`Prompt log: ${PROMPT_LOG_PATH}`);
}
