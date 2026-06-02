// scripts/generate-story.js
// One-off CLI to exercise src/anthropic.js's generateStory() with real
// parent inputs. First paid Anthropic call per Week 1 Day 3.
//
// Usage:
//   node scripts/generate-story.js --name "Lila" --age 6 \
//     --appearance "curly red hair, freckles, blue overalls" \
//     --theme "exploring an enchanted forest"
//
// Both --flag value and --flag=value forms are accepted. Quote any value
// containing spaces.
//
// Output: output/stories/<YYYY-MM-DD>-<name-slug>-<HHMM>/{story,meta}.json

import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { generateStory, MODEL, MAX_TOKENS, EFFORT, THINKING_TYPE } from "../src/anthropic.js";
import { createStatusFile, updateStatus, finalizeStatus, registerAbortHandlers } from "../src/status-writer.js";

// ---- Paths -----------------------------------------------------------------
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, "..");
const STORIES_DIR = path.join(PROJECT_ROOT, "output", "stories");

// ---- Pricing (Sonnet 4.6, per Anthropic docs as of 2026-05-15) -------------
// Used to compute actual-cost estimate from returned token usage. Note these
// are estimates against published per-token rates — bills may differ slightly
// (rounding, cache reads, etc.).
const SONNET_INPUT_USD_PER_1M = 3.00;
const SONNET_OUTPUT_USD_PER_1M = 15.00;

// ---- Argument parsing ------------------------------------------------------
const USAGE = `
Usage: node scripts/generate-story.js [flags]

Single-protagonist mode (legacy, backward-compatible):
  --name <string>      Child's name
  --age <integer>      Child's age
  --gender <enum>      boy | girl | non_binary (required; no silent default)
  --theme <string>     What the story is about
  --appearance <string>  (optional) Visual description (strongly recommended)

Multi-character mode (new — protagonist + 0-4 companions):
  --input <path>       Path to a JSON file with the full input schema:
                       {
                         child: { name, age, gender, appearance? },
                         secondaries: [
                           { name, age, relationship, subject_type?,
                             anchor, gender?, appearance_markers, id? }
                         ],
                         theme: "..."
                       }
                       gender: REQUIRED on child (boy|girl|non_binary).
                               REQUIRED on each HUMAN secondary; MUST be
                               OMITTED for non_human (pet/toy). No default
                               — wrong gender on a personalized book is a
                               refund-event failure, so missing values are
                               rejected at script entry.
                       anchor: REQUIRED on every secondary. "tier2" = ref-
                               anchored (sheet minted, consumes 1 of 4 ref
                               slots at render time; required for humans).
                               "tier1" = text-anchored (no sheet, no ref
                               slot, entity is woven into action prose;
                               non-human only). At most 3 tier-2 secondaries
                               allowed (protagonist + 3 = 4 ref-anchored max).
                       relationship: sibling | friend | cousin | parent |
                                     grandparent | pet | toy | other
                       subject_type: "human" | "non_human" (default: pet/toy
                                     auto → non_human, else human)
                       appearance_markers: REQUIRED for each secondary —
                                     2-3 specific features spanning hair /
                                     face / clothes.
                       Cannot be combined with --name/--age/--theme/--appearance.

Always available:
  --yes / --auto-confirm Skip the interactive CONFIRM gate (unattended runs).
                         Equivalent to env var AUTO_CONFIRM=1.

Both --flag value and --flag=value forms are accepted.
Strings with spaces must be quoted.
`.trim();

// Value-less boolean flags. parseArgs must NOT consume a following token as
// their "value" (and must NOT throw "missing value" when they're bare).
const BOOLEAN_FLAGS = new Set(["yes", "auto-confirm"]);

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) {
      throw new Error(
        `Unexpected positional argument: ${a}. All inputs must be passed as --flag.`
      );
    }
    const eqIndex = a.indexOf("=");
    if (eqIndex >= 0) {
      const key = a.slice(2, eqIndex);
      args[key] = a.slice(eqIndex + 1);
    } else {
      const key = a.slice(2);
      if (BOOLEAN_FLAGS.has(key)) {
        args[key] = true;
        continue;
      }
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new Error(`Missing value for --${key}`);
      }
      args[key] = value;
      i++;
    }
  }
  return args;
}

// ---- Run-id helpers --------------------------------------------------------
// Latinize diacritics so output-dir slugs are clean ASCII (Søren → soren,
// not s-ren). NFKD decomposes most accented letters (é→e, ñ→n, ü→u, ç→c)
// into base + combining mark, which the ̀-ͯ strip then removes.
// But stroked/ligature letters (ø, æ, œ, ð, þ, ł, đ, ß) do NOT decompose
// under NFKD — they need an explicit map. (Narrative content keeps the
// original diacritics; this only affects the filesystem slug.)
const LATINIZE_SPECIAL = {
  "ø": "o", "Ø": "O", "æ": "ae", "Æ": "AE", "œ": "oe", "Œ": "OE",
  "ð": "d", "Ð": "D", "þ": "th", "Þ": "TH", "ł": "l", "Ł": "L",
  "đ": "d", "Đ": "D", "ß": "ss",
};
function latinize(s) {
  return s
    .replace(/[øØæÆœŒðÐþÞłŁđĐß]/g, (ch) => LATINIZE_SPECIAL[ch] ?? ch)
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "");
}

function slugify(s) {
  return latinize(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 30);
}

function buildRunId(name, date) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");
  const slug = slugify(name) || "child";
  return `${yyyy}-${mm}-${dd}-${slug}-${hh}${min}`;
}

// Render a path for display in console output — relative to project root,
// with forward slashes regardless of platform.
function displayPath(absolutePath) {
  return path.relative(PROJECT_ROOT, absolutePath).replace(/\\/g, "/");
}

// ---- Parse + validate args -------------------------------------------------
let args;
try {
  args = parseArgs(process.argv.slice(2));
} catch (err) {
  console.error(`FAIL: ${err.message}`);
  console.error("");
  console.error(USAGE);
  process.exit(1);
}

// Two input modes:
//   (a) --input <json-file> — full multi-character schema
//   (b) legacy --name/--age/--theme/--appearance — single-protagonist; produces secondaries=[]
// They are mutually exclusive.
function bail(msg) {
  console.error(`FAIL: ${msg}`);
  console.error("");
  console.error(USAGE);
  process.exit(1);
}

const RELATIONSHIPS = new Set(["sibling", "friend", "cousin", "parent", "grandparent", "pet", "toy", "other"]);
const NON_HUMAN_RELS = new Set(["pet", "toy"]);
const GENDERS = new Set(["boy", "girl", "non_binary"]);
const ANCHORS = new Set(["tier1", "tier2"]);

let name, age, gender, theme, appearance, secondaries;

if (args.input !== undefined) {
  // Mode (a): JSON input file.
  if (args.name || args.age || args.theme || args.appearance) {
    bail("--input cannot be combined with --name / --age / --theme / --appearance. Use one mode.");
  }
  if (!fs.existsSync(args.input)) {
    bail(`--input file not found: ${args.input}`);
  }
  let inputData;
  try {
    inputData = JSON.parse(fs.readFileSync(args.input, "utf8"));
  } catch (err) {
    bail(`--input file is not valid JSON: ${err.message}`);
  }
  if (!inputData || typeof inputData !== "object") bail(`--input must be a JSON object.`);
  if (!inputData.child || typeof inputData.child.name !== "string") bail(`--input.child.name is required (string).`);
  if (typeof inputData.child.age !== "number") bail(`--input.child.age is required (number).`);
  if (typeof inputData.child.gender !== "string" || !GENDERS.has(inputData.child.gender)) {
    bail(`--input.child.gender is required and must be one of: ${[...GENDERS].join(", ")}. Got: ${JSON.stringify(inputData.child.gender)}.`);
  }
  if (typeof inputData.theme !== "string" || !inputData.theme.trim()) bail(`--input.theme is required (non-empty string).`);

  name = inputData.child.name;
  age = inputData.child.age;
  gender = inputData.child.gender;
  appearance = typeof inputData.child.appearance === "string" ? inputData.child.appearance : undefined;
  theme = inputData.theme;

  const secsRaw = inputData.secondaries ?? [];
  if (!Array.isArray(secsRaw)) bail(`--input.secondaries must be an array (or omitted).`);
  if (secsRaw.length > 4) bail(`--input.secondaries length must be 0-4 (got ${secsRaw.length}). Architecture supports 4; UI exposes 1 at launch.`);
  let tier2Count = 0;
  secondaries = secsRaw.map((s, i) => {
    if (!s || typeof s !== "object") bail(`secondaries[${i}] must be an object.`);
    if (typeof s.name !== "string" || !s.name.trim()) bail(`secondaries[${i}].name is required (non-empty string).`);
    if (typeof s.age !== "number" || !Number.isInteger(s.age) || s.age <= 0) bail(`secondaries[${i}] (${s.name}) .age must be a positive integer.`);
    if (typeof s.relationship !== "string" || !RELATIONSHIPS.has(s.relationship)) {
      bail(`secondaries[${i}] (${s.name}) .relationship must be one of: ${[...RELATIONSHIPS].join(", ")}. Got "${s.relationship}".`);
    }
    if (typeof s.appearance_markers !== "string" || !s.appearance_markers.trim()) {
      bail(`secondaries[${i}] (${s.name}) .appearance_markers is required (2-3 specific features spanning hair / face / clothes).`);
    }
    let subjectType = s.subject_type;
    if (subjectType === undefined) {
      subjectType = NON_HUMAN_RELS.has(s.relationship) ? "non_human" : "human";
    } else if (subjectType !== "human" && subjectType !== "non_human") {
      bail(`secondaries[${i}] (${s.name}) .subject_type must be "human" or "non_human". Got "${subjectType}".`);
    }
    // Anchor: required explicit choice. tier1 = text-only / no ref slot
    // (non_human only). tier2 = ref-anchored / sheet minted (required for
    // human; default for non_human at customer choice).
    if (typeof s.anchor !== "string" || !ANCHORS.has(s.anchor)) {
      bail(`secondaries[${i}] (${s.name}) .anchor is required and must be one of: ${[...ANCHORS].join(", ")}. Got: ${JSON.stringify(s.anchor)}.`);
    }
    if (s.anchor === "tier1" && subjectType !== "non_human") {
      bail(`secondaries[${i}] (${s.name}) .anchor "tier1" requires subject_type "non_human" (text-only anchoring doesn't survive human faces — Stage B + Step 2.5 evidence). Got subject_type "${subjectType}".`);
    }
    if (s.anchor === "tier2") tier2Count += 1;
    // Gender: required for human, MUST be omitted for non_human (pet/toy/robot —
    // gender doesn't apply). Same architecture as protagonist; no silent default.
    if (subjectType === "human") {
      if (typeof s.gender !== "string" || !GENDERS.has(s.gender)) {
        bail(`secondaries[${i}] (${s.name}) .gender is required for human subjects and must be one of: ${[...GENDERS].join(", ")}. Got: ${JSON.stringify(s.gender)}.`);
      }
    } else if (s.gender !== undefined) {
      bail(`secondaries[${i}] (${s.name}) .gender must NOT be present when subject_type is "non_human" (gender does not apply to pet/toy subjects). Got: ${JSON.stringify(s.gender)}.`);
    }
    const id = typeof s.id === "string" && s.id.trim() ? s.id : `companion-${i + 1}`;
    const entry = {
      id,
      name: s.name,
      age: s.age,
      relationship: s.relationship,
      subject_type: subjectType,
      anchor: s.anchor,
      appearance_markers: s.appearance_markers,
    };
    if (subjectType === "human") entry.gender = s.gender;
    return entry;
  });
  if (tier2Count > 3) {
    bail(`At most 3 tier-2 secondaries allowed (protagonist + 3 tier-2 = 4 ref-anchored subjects max, matching the Gemini 4-ref ceiling). Got ${tier2Count} tier-2 secondaries. Tier-1 (text-only) entities are unlimited.`);
  }
} else {
  // Mode (b): legacy single-protagonist flags. Produces secondaries=[].
  name = args.name;
  const ageStr = args.age;
  theme = args.theme;
  appearance = args.appearance;
  const missing = [];
  if (!name) missing.push("--name");
  if (!ageStr) missing.push("--age");
  if (!theme) missing.push("--theme");
  if (!args.gender) missing.push("--gender");
  if (missing.length > 0) bail(`missing required flags: ${missing.join(", ")}`);
  age = Number(ageStr);
  if (!Number.isInteger(age) || age <= 0) bail(`--age must be a positive integer. Got: "${ageStr}"`);
  if (!GENDERS.has(args.gender)) {
    bail(`--gender must be one of: ${[...GENDERS].join(", ")}. Got: "${args.gender}"`);
  }
  gender = args.gender;
  secondaries = [];
}

// ---- Build run-id / output dir (don't create dir yet — wait for CONFIRM) --
const runStartDate = new Date();
const runId = buildRunId(name, runStartDate);
const outDir = path.join(STORIES_DIR, runId);

// ---- Confirmation gate -----------------------------------------------------
const appearanceDisplay =
  appearance && appearance.trim()
    ? appearance
    : "(not provided — Sonnet will invent visual details)";

console.log();
console.log("=".repeat(70));
console.log("Story generation — about to make 1 paid Anthropic API call.");
console.log("=".repeat(70));
console.log("Inputs:");
console.log(`  Child name:       ${name}`);
console.log(`  Child age:        ${age}`);
console.log(`  Child gender:     ${gender}`);
console.log(`  Appearance:       ${appearanceDisplay}`);
if (secondaries.length > 0) {
  console.log(`  Companions:       ${secondaries.length}`);
  for (const s of secondaries) {
    const anchorTag = s.anchor === "tier1" ? "TEXT-ANCHORED" : "REF-ANCHORED";
    const genderTag = s.gender ? `, gender ${s.gender}` : "";
    console.log(`    - [${anchorTag}] ${s.name}, ${s.age}, ${s.relationship} (${s.subject_type})${genderTag}: ${s.appearance_markers}`);
  }
} else {
  console.log(`  Companions:       (none — single-protagonist story)`);
}
console.log(`  Theme:            ${theme}`);
console.log();
console.log(`Model:              ${MODEL}`);
console.log(`Effort:             ${EFFORT}`);
console.log(`Thinking:           ${THINKING_TYPE}`);
console.log(`max_tokens:         ${MAX_TOKENS}`);
console.log();
console.log(
  `Estimated cost:     up to ~$0.05 USD (rough upper bound; actuals usually $0.02-0.04)`
);
console.log(`Token budget:       ~1000 in / ~1500 out (estimates)`);
console.log();
console.log(`Output directory:   ${displayPath(outDir)}/`);
console.log();

// Auto-confirm path for unattended runs (website / batch). The flag's
// PRESENCE enables it; AUTO_CONFIRM=1 env var also works. Default (no flag)
// preserves the interactive readline gate for manual runs.
const autoConfirm =
  args.yes !== undefined ||
  args["auto-confirm"] !== undefined ||
  process.env.AUTO_CONFIRM === "1";

let answer;
if (autoConfirm) {
  console.log("Auto-confirm enabled (--yes / --auto-confirm / AUTO_CONFIRM=1) — proceeding without interactive gate.");
  answer = "CONFIRM";
} else {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  answer = await rl.question("Type CONFIRM to proceed (anything else aborts): ");
  rl.close();
}

if (answer.trim() !== "CONFIRM") {
  console.log("Aborted. No API calls made. No cost incurred.");
  process.exit(0);
}

// ---- Build wrapper input + call --------------------------------------------
const child = { name, age, gender };
if (appearance && appearance.trim()) {
  child.appearance = appearance;
}
const input = { child, secondaries, theme };

console.log();
console.log("Generating story...");

// ---- Initialize status.json sidecar (observability for the orchestrator) --
// Output dir doesn't exist yet — create it now so status-writer has somewhere
// to land. The previous behavior was to mkdir only after the story succeeded;
// we now mkdir early so failures still leave a status.json behind. Story.json
// + meta.json are still only written on success.
fs.mkdirSync(outDir, { recursive: true });
createStatusFile(outDir, {
  currentState: "story_gen",
  jobStartPayload: {
    input_summary: {
      protagonist: { name, age, gender },
      secondaries_count: secondaries.length,
      theme,
    },
    model: MODEL,
    max_tokens: MAX_TOKENS,
  },
});
// Item 5 D4 + D5: register uncaught / unhandled-rejection / SIGINT handlers
// so a process-level crash or Ctrl-C finalizes status.json as "aborted"
// instead of leaving it stuck mid-flight.
registerAbortHandlers(outDir);
updateStatus(outDir, {
  event: { kind: "story_gen_start", protagonist: name, secondaries_count: secondaries.length },
  currentStep: { kind: "story_gen", detail: `protagonist ${name}`, started_at: new Date().toISOString() },
});
const onSlowCall = (event) => {
  try { updateStatus(outDir, { event }); } catch { /* never break the call path */ }
};

const t0 = Date.now();
let result;
try {
  result = await generateStory(input, { onSlowCall });
} catch (err) {
  console.error();
  console.error(`FAIL: ${err?.message ?? err}`);
  // Emit failure event + finalize status as failed. Any error class with a
  // .toJSON() method (WallCeilingError from Item 1b, MaxTokensError from
  // Item 2, future structured errors) serializes through that. Generic
  // errors get a minimal shape.
  const errorPayload = typeof err?.toJSON === "function"
    ? err.toJSON()
    : { kind: "story_gen_error", message: String(err?.message ?? err).slice(0, 300), status: err?.status ?? null };
  try {
    updateStatus(outDir, { event: { kind: "story_gen_failed", error: errorPayload } });
    finalizeStatus(outDir, { state: "failed", error: errorPayload });
  } catch (statusErr) {
    console.error(`(status write failed: ${statusErr.message})`);
  }
  process.exit(1);
}
const wallMs = Date.now() - t0;
const runEndDate = new Date();

const { story, usage } = result;
const inputTokens = usage.input_tokens ?? 0;
const outputTokens = usage.output_tokens ?? 0;
const estimatedCost =
  (inputTokens * SONNET_INPUT_USD_PER_1M +
    outputTokens * SONNET_OUTPUT_USD_PER_1M) /
  1_000_000;

const storyPath = path.join(outDir, "story.json");
fs.writeFileSync(storyPath, JSON.stringify(story, null, 2));

const meta = {
  run_id: runId,
  started_at: runStartDate.toISOString(),
  completed_at: runEndDate.toISOString(),
  duration_seconds: Number((wallMs / 1000).toFixed(2)),
  model: MODEL,
  effort: EFFORT,
  thinking: THINKING_TYPE,
  // `child` kept at the same key path for backward-compat with generate-book.js
  // (which reads meta.inputs.child.name / .age). secondaries is the additive
  // multi-character field that the render layer will consume in Step 2.
  inputs: { child, secondaries, theme },
  usage: { input_tokens: inputTokens, output_tokens: outputTokens },
  estimated_cost_usd: Number(estimatedCost.toFixed(4)),
};
const metaPath = path.join(outDir, "meta.json");
fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));

// ---- Finalize status.json --------------------------------------------------
updateStatus(outDir, {
  event: {
    kind: "story_gen_complete",
    duration_ms: wallMs,
    tokens: { in: inputTokens, out: outputTokens },
    estimated_cost_usd: Number(estimatedCost.toFixed(4)),
  },
});
finalizeStatus(outDir, { state: "completed" });

// ---- Summary ---------------------------------------------------------------
console.log();
console.log("=".repeat(70));
console.log("Story generated successfully.");
console.log("=".repeat(70));
console.log(`  Duration:        ${(wallMs / 1000).toFixed(2)}s`);
console.log(`  Tokens:          ${inputTokens} in / ${outputTokens} out`);
console.log(`  Estimated cost:  $${estimatedCost.toFixed(4)} USD`);
console.log(`  Outputs:`);
console.log(`    ${displayPath(storyPath)}`);
console.log(`    ${displayPath(metaPath)}`);
console.log();
