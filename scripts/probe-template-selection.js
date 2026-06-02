// scripts/probe-template-selection.js
// One-off probe: re-run template selection against Iris's existing story
// scenes with the current (3-template) registry, to see which template
// Sonnet picks for each scene. Production generateStory() in
// src/anthropic.js generates scenes + layout_intents in a single call;
// this probe isolates selection by feeding pre-existing scenes as input
// and asking for ONLY layout_intents.
//
// SNAPSHOT NOTE: the TEMPLATE SELECTION section embedded in SYSTEM_PROMPT
// below is a VERBATIM SNAPSHOT of the same section in
// src/anthropic.js's SYSTEM_PROMPT_TEMPLATE (as of 2026-05-20). If that
// prompt changes, this probe drifts. For a recurring tool, export
// SYSTEM_PROMPT_TEMPLATE from src/anthropic.js and import here.
//
// CALL-PARAM POLICY: MODEL, EFFORT, THINKING_TYPE are imported from
// src/anthropic.js so production drift on those is reflected automatically.
// max_tokens is overridden to 4096 (vs production's 16384) because the
// probe's output is layout_intents only (~1100 tokens expected), not a
// full story (~12000 tokens). The probe does NOT include production's
// custom retry policy (callWithRetry); a transient failure means re-run
// the script manually.

import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";
import { MODEL, EFFORT, THINKING_TYPE } from "../src/anthropic.js";
import { loadTemplateRegistry, buildTemplateMetadataForPrompt } from "../src/template-registry.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, "..");

const STORY_DIR = path.join(PROJECT_ROOT, "output", "stories", "2026-05-20-iris-1230");
const STORY_PATH = path.join(STORY_DIR, "story.json");
const OUTPUT_PATH = path.join(STORY_DIR, "probe-3template-layout-intents.json");

const MAX_TOKENS = 4096;

const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) {
  throw new Error("ANTHROPIC_API_KEY is not set.");
}
const client = new Anthropic({ apiKey, maxRetries: 0, timeout: 180_000 });

function displayPath(p) {
  return path.relative(PROJECT_ROOT, p).replace(/\\/g, "/");
}

// ---- Load story + registry -----------------------------------------------

const story = JSON.parse(fs.readFileSync(STORY_PATH, "utf8"));
if (!Array.isArray(story.scenes) || story.scenes.length !== 12) {
  throw new Error(`Expected 12 scenes in story.json; got ${story.scenes?.length}`);
}

const registry = await loadTemplateRegistry();
const templateIds = registry.map((t) => t.id);
const templateRegistryDescription = buildTemplateMetadataForPrompt(registry);

console.log();
console.log("=".repeat(72));
console.log("Probe — template selection against existing Iris story");
console.log("=".repeat(72));
console.log();
console.log(`Story:    ${displayPath(STORY_PATH)}`);
console.log(`Registry: ${templateIds.join(", ")} (${registry.length} templates)`);
console.log(`Model:    ${MODEL} (effort=${EFFORT}, thinking=${THINKING_TYPE}, max_tokens=${MAX_TOKENS})`);

// ---- Build system prompt --------------------------------------------------

// VERBATIM SNAPSHOT — see header note.
const SYSTEM_PROMPT = `You are helping select visual layouts for an existing children's picture-book story. The story has already been written: protagonist description, action descriptions, and read-aloud narrative text for all 12 pages. Your only job is to choose a layout template for each page.

TEMPLATE SELECTION

In addition to action and narrative_text, each scene must include a layout_intent — your choice of visual template for the page. Different templates handle different narrative lengths and aesthetic moods.

${templateRegistryDescription}

Selection rules:
1. Check the narrative_text length for this scene. Filter to templates whose max_narrative_chars is "any length" or >= the scene's narrative_text character count.
2. From the remaining templates, pick the one whose aesthetic_intent tags best match the scene's mood (the mood is your call, based on the narrative you've just written).
3. If multiple templates fit equally well, prefer the template tagged "default".

For each scene, populate layout_intent with:
- template_id: one of the IDs listed above
- rationale: 1-2 sentences explaining your choice (narrative length + aesthetic match)

Examples:
- A quiet scene with 250 chars of contemplative narrative → prompt-3-iter-2 (intimate aesthetic; fits within 300-char limit)
- An action scene with 500 chars of expansive narrative → prompt-2-iter-2 (only template that holds 500 chars)
- An establishing scene with 200 chars of expansive narrative → prompt-2-iter-2 (cinematic aesthetic match, even though prompt-3-iter-2 could also hold it character-wise)

Note: you control both the narrative_text length AND the layout_intent. If you want a scene to feel intimate and use prompt-3-iter-2, write the narrative shorter (under 300 chars) so it qualifies. The layout choice and the prose pacing are linked.`;

// ---- Build user message ---------------------------------------------------

const sceneLines = [];
for (const sc of story.scenes) {
  sceneLines.push(`Page ${sc.page} (${sc.narrative_text.length} chars):`);
  sceneLines.push(`  action: ${sc.action}`);
  sceneLines.push(`  narrative_text: ${sc.narrative_text}`);
  sceneLines.push("");
}

const USER_MESSAGE = `Here is the existing story. Generate layout_intents for the 12 scenes.

Character:
${story.character}

Scenes:
${sceneLines.join("\n")}
Return exactly 12 layout_intents (one per page, in page order).`;

// ---- Schema ---------------------------------------------------------------

const schema = {
  type: "object",
  required: ["layout_intents"],
  additionalProperties: false,
  properties: {
    layout_intents: {
      type: "array",
      description: "Exactly twelve layout_intents, one per scene in page order.",
      items: {
        type: "object",
        required: ["page", "template_id", "rationale"],
        additionalProperties: false,
        properties: {
          page: {
            type: "integer",
            description: "Page number, 1 through 12.",
          },
          template_id: {
            type: "string",
            enum: templateIds,
            description: "ID of the chosen template (must be one of the listed templates).",
          },
          rationale: {
            type: "string",
            description: "1-2 sentences explaining the choice (narrative length + aesthetic match).",
          },
        },
      },
    },
  },
};

// ---- Call Sonnet ----------------------------------------------------------

console.log();
console.log("Calling Sonnet...");
const tStart = Date.now();
const response = await client.messages.create({
  model: MODEL,
  max_tokens: MAX_TOKENS,
  system: SYSTEM_PROMPT,
  thinking: { type: THINKING_TYPE },
  output_config: {
    effort: EFFORT,
    format: { type: "json_schema", schema },
  },
  messages: [{ role: "user", content: USER_MESSAGE }],
});
const tMs = Date.now() - tStart;

if (response.stop_reason === "refusal") {
  throw new Error(`Refused: ${response.stop_details?.category ?? "unspecified"}`);
}
if (response.stop_reason === "max_tokens") {
  throw new Error(`Truncated by max_tokens=${MAX_TOKENS}.`);
}

const textBlock = response.content.find((c) => c.type === "text");
if (!textBlock) {
  throw new Error(`No text block in response. stop_reason: ${response.stop_reason}`);
}
const parsed = JSON.parse(textBlock.text);

if (!Array.isArray(parsed.layout_intents) || parsed.layout_intents.length !== 12) {
  throw new Error(
    `Expected 12 layout_intents; got ${Array.isArray(parsed.layout_intents) ? parsed.layout_intents.length : "non-array"}.`
  );
}

// Sort by page in case Sonnet returned out of order.
parsed.layout_intents.sort((a, b) => a.page - b.page);
for (let i = 0; i < 12; i++) {
  if (parsed.layout_intents[i].page !== i + 1) {
    throw new Error(`layout_intents missing or duplicated page at index ${i}: expected page ${i + 1}, got ${parsed.layout_intents[i].page}`);
  }
}

console.log(`Done in ${(tMs / 1000).toFixed(1)}s.`);

// ---- Report: full table ---------------------------------------------------

console.log();
console.log("-".repeat(72));
console.log("Layout intents (3-template registry):");
console.log("-".repeat(72));
console.log("Page  Chars  Template          Rationale");
console.log("----  -----  ---------------   --------------------------------------");

for (let i = 0; i < 12; i++) {
  const li = parsed.layout_intents[i];
  const charCount = story.scenes[i].narrative_text.length;
  const rationale = li.rationale.length > 80 ? li.rationale.slice(0, 77) + "..." : li.rationale;
  console.log(
    `  ${String(li.page).padStart(2)}  ${String(charCount).padStart(5)}  ${li.template_id.padEnd(17)} ${rationale}`
  );
}

// ---- Report: distribution -------------------------------------------------

console.log();
console.log("-".repeat(72));
console.log("Distribution (3-template registry):");
console.log("-".repeat(72));
const distribution = {};
for (const li of parsed.layout_intents) {
  if (!distribution[li.template_id]) distribution[li.template_id] = [];
  distribution[li.template_id].push(li.page);
}
for (const tid of templateIds) {
  const pages = distribution[tid] ?? [];
  console.log(
    `  ${tid.padEnd(17)} ${String(pages.length).padStart(2)} scenes` +
    (pages.length > 0 ? `  (pages ${pages.join(", ")})` : "")
  );
}

// ---- Report: per-page diff vs existing ------------------------------------

console.log();
console.log("-".repeat(72));
console.log("Per-page diff vs existing 2-template Iris run:");
console.log("-".repeat(72));
console.log("Page   Existing (2-template)    Probe (3-template)        Change?");
console.log("----   ----------------------   -----------------------   -------");

let changedPages = 0;
const changeDetails = [];
for (let i = 0; i < 12; i++) {
  const existing = story.scenes[i].layout_intent.template_id;
  const probe = parsed.layout_intents[i].template_id;
  const change = existing === probe ? "" : "CHANGED";
  if (change) {
    changedPages++;
    changeDetails.push({ page: i + 1, from: existing, to: probe });
  }
  console.log(
    `  ${String(i + 1).padStart(2)}    ${existing.padEnd(22)}   ${probe.padEnd(23)}   ${change}`
  );
}
console.log();
console.log(`  ${changedPages}/12 pages changed.`);

// ---- Cost -----------------------------------------------------------------

console.log();
console.log("-".repeat(72));
console.log("Cost:");
console.log("-".repeat(72));
const inputTokens = response.usage?.input_tokens ?? 0;
const outputTokens = response.usage?.output_tokens ?? 0;
// Sonnet 4.6 pricing estimate: $3/M input, $15/M output.
const costInput = (inputTokens / 1_000_000) * 3;
const costOutput = (outputTokens / 1_000_000) * 15;
const costTotal = costInput + costOutput;
console.log(`  Input tokens:  ${inputTokens.toLocaleString()}`);
console.log(`  Output tokens: ${outputTokens.toLocaleString()}`);
console.log(`  Cost:          $${costTotal.toFixed(4)} (input $${costInput.toFixed(4)} + output $${costOutput.toFixed(4)})`);

// ---- Save output ----------------------------------------------------------

const output = {
  probe: {
    timestamp: new Date().toISOString(),
    model: MODEL,
    effort: EFFORT,
    thinking_type: THINKING_TYPE,
    max_tokens: MAX_TOKENS,
    registry_ids: templateIds,
    note: "Generated by scripts/probe-template-selection.js. Verbatim TEMPLATE SELECTION snapshot from src/anthropic.js as of 2026-05-20.",
  },
  story_source: displayPath(STORY_PATH),
  layout_intents: parsed.layout_intents,
  usage: {
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    cost_usd: Number(costTotal.toFixed(4)),
  },
  distribution,
  diff_vs_existing: {
    changed_pages: changedPages,
    changes: changeDetails,
  },
};

fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2));

console.log();
console.log(`  Output:  ${displayPath(OUTPUT_PATH)}`);
console.log();
console.log("=".repeat(72));
console.log("Probe complete.");
console.log("=".repeat(72));
