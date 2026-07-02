// scripts/generate-book.js — CLI shim over src/book-pipeline.js
//
// As of Track B Cycle B.3 (2026-06-07), the multi-template orchestration that
// used to live in this file's module body was extracted into the importable
// functions planBook() + generateBook() in src/book-pipeline.js (so the Track B
// Fly.io worker can call the pipeline directly). This file is now a thin CLI
// wrapper that keeps the manual-run ergonomics intact:
//   - argv parsing (--book-dir / --story-path / --name / --age / --yes / --sheets-only)
//   - the interactive CONFIRM cost gate
//   - the status.json observability sidecar (wired via emitStatus/onSlowCall)
//   - meta.json result write-back
//   - process exit codes
//
// All image generation, sheet-reuse, rendering, escalation, and PDF-merge logic
// is unchanged — it now lives in src/book-pipeline.js. See that file's header.

import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { loadTemplateRegistry } from "../src/template-registry.js";
import { planBook, generateBook } from "../src/book-pipeline.js";
import { createStatusFile, updateStatus, finalizeStatus, registerAbortHandlers } from "../src/status-writer.js";

// ---- Paths -----------------------------------------------------------------
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, "..");
const BOOKS_DIR = path.join(PROJECT_ROOT, "output", "books");

// ---- Usage -----------------------------------------------------------------
const USAGE = `
Usage: node scripts/generate-book.js [flags]

Required (one of):
  --book-dir   <path>  Path to an existing book directory containing
                       story.json with layout_intent per scene.
  --story-path <path>  Path to a story.json. Creates a fresh book dir under
                       output/books/<id>/ (id from sibling meta.json run_id,
                       or generated from --name + timestamp). Copies the
                       story.json (and meta.json if found) into the new dir.

Optional:
  --name  <string>     Child name (overrides meta.json child.name).
  --age   <integer>    Child age  (overrides meta.json child.age).
  --yes / --auto-confirm  Skip the interactive CONFIRM gate (unattended runs).
                          Equivalent to env var AUTO_CONFIRM=1.
  --sheets-only           Mint character sheets (Section A) and EXIT before
                          page rendering. For testing the sheet-gen path
                          without the full $0.48 book render. Pairs with
                          --yes for unattended sheet-only runs.

Output:
  Creates/uses output/books/<id>/ with character-sheets/, pages/, book.pdf,
  escalations.log.

Both --flag value and --flag=value forms are accepted.
`.trim();

// ---- Arg parsing -----------------------------------------------------------
const BOOLEAN_FLAGS = new Set(["yes", "auto-confirm", "sheets-only"]);

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

// Latinize diacritics so slugs are clean ASCII (Søren → soren).
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

function displayPath(absolutePath) {
  return path.relative(PROJECT_ROOT, absolutePath).replace(/\\/g, "/");
}

// ---- Parse args + resolve bookDir / storyPath / metaPath -------------------
let args;
try {
  args = parseArgs(process.argv.slice(2));
} catch (err) {
  console.error(`FAIL: ${err.message}`);
  console.error("");
  console.error(USAGE);
  process.exit(1);
}

let bookDir, storyPath, metaPath;

if (args["book-dir"]) {
  bookDir = path.resolve(args["book-dir"]);
  if (!fs.existsSync(bookDir) || !fs.statSync(bookDir).isDirectory()) {
    console.error(`FAIL: --book-dir does not exist or is not a directory: ${displayPath(bookDir)}`);
    process.exit(1);
  }
  storyPath = path.join(bookDir, "story.json");
  metaPath = path.join(bookDir, "meta.json");
  if (!fs.existsSync(storyPath)) {
    console.error(`FAIL: story.json not found in ${displayPath(bookDir)}`);
    process.exit(1);
  }
} else if (args["story-path"]) {
  const sourcePath = path.resolve(args["story-path"]);
  if (!fs.existsSync(sourcePath)) {
    console.error(`FAIL: --story-path does not exist: ${displayPath(sourcePath)}`);
    process.exit(1);
  }
  const sourceDir = path.dirname(sourcePath);
  const sourceMetaPath = path.join(sourceDir, "meta.json");
  let sourceMeta = null;
  if (fs.existsSync(sourceMetaPath)) {
    sourceMeta = JSON.parse(fs.readFileSync(sourceMetaPath, "utf8"));
  }
  const runId = sourceMeta?.run_id
    || buildRunId(args.name || "child", new Date());
  bookDir = path.join(BOOKS_DIR, runId);
  fs.mkdirSync(bookDir, { recursive: true });
  storyPath = path.join(bookDir, "story.json");
  if (!fs.existsSync(storyPath)) {
    fs.copyFileSync(sourcePath, storyPath);
    console.log(`Copied story.json → ${displayPath(storyPath)}`);
  }
  metaPath = path.join(bookDir, "meta.json");
  if (sourceMeta && !fs.existsSync(metaPath)) {
    fs.copyFileSync(sourceMetaPath, metaPath);
    console.log(`Copied meta.json → ${displayPath(metaPath)}`);
  }
} else {
  console.error("FAIL: must provide --book-dir OR --story-path");
  console.error("");
  console.error(USAGE);
  process.exit(1);
}

// ---- Load story.json + meta.json -------------------------------------------
const story = JSON.parse(fs.readFileSync(storyPath, "utf8"));
let meta = null;
if (fs.existsSync(metaPath)) {
  meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
}

// Child name + age — args override meta.json
const childName = args.name || meta?.inputs?.child?.name;
const childAgeRaw = args.age || meta?.inputs?.child?.age;
const childAge = Number(childAgeRaw);
if (!childName || !Number.isInteger(childAge) || childAge <= 0) {
  console.error(
    `FAIL: need child name + age. Got name="${childName}", age="${childAgeRaw}". ` +
    `Provide via --name/--age or ensure meta.json has inputs.child.name + .age.`
  );
  process.exit(1);
}

// ---- Plan (validation + sheet-reuse + cost estimate) -----------------------
const sheetsDir = path.join(bookDir, "character-sheets");
const registry = await loadTemplateRegistry();

let plan;
try {
  plan = planBook({ story, meta, childName, childAge, sheetsDir, registry });
} catch (err) {
  // planBook throws on invalid input (the validations that used to be inline
  // process.exit gates). Layout-intent validation carries a .validationErrors
  // array for the detailed migration guidance.
  console.error();
  console.error(`FAIL: ${err.message}`);
  if (Array.isArray(err.validationErrors)) {
    console.error();
    console.error("Two migration paths:");
    console.error(`  1. Hand-edit story.json — add 'layout_intent: { template_id, rationale }'`);
    console.error(`     to each scene. Free; preserves existing narrative content.`);
    console.error(`  2. Regenerate via scripts/generate-story.js with v2 system prompt`);
    console.error(`     (~$0.11). May produce different narrative text.`);
  }
  process.exit(1);
}

const {
  subjectList,
  totalSheetsNeeded,
  sheetsToMintCount,
  templateCounts,
  fallbackTemplate,
  costs: { sheetsCost, scenesCost, baseCost, worstEscalationCost },
} = plan;

const bookPdfPath = path.join(bookDir, "book.pdf");
const escalationsLogPath = path.join(bookDir, "escalations.log");
const sheetFiles = ["sheet-01.png", "sheet-02.png", "sheet-03.png"];
const sheetsExist = sheetFiles.every((f) => fs.existsSync(path.join(sheetsDir, f)));

// ---- CONFIRM gate ----------------------------------------------------------
console.log();
console.log("=".repeat(70));
console.log("Book generation — multi-template orchestration");
console.log("=".repeat(70));
console.log();
console.log(`Book directory: ${displayPath(bookDir)}`);
console.log(`Character:      ${childName}, age ${childAge}`);
const charPreview = story.character.length > 180 ? story.character.slice(0, 180) + "..." : story.character;
console.log(`                "${charPreview}"`);
console.log();
console.log(`Per-scene plan (${story.scenes.length} scenes):`);
console.log(`  Page  Chars  Template          Rationale (truncated)`);
console.log(`  ----  -----  ---------------   ----------------------------------`);
for (const scene of story.scenes) {
  const pageStr = String(scene.page).padStart(4);
  const charsStr = String(scene.narrative_text.length).padStart(5);
  const tidStr = scene.layout_intent.template_id.padEnd(17);
  const rat = scene.layout_intent.rationale;
  const ratStr = rat.length > 50 ? rat.slice(0, 50) + "..." : rat;
  console.log(`  ${pageStr}  ${charsStr}  ${tidStr} ${ratStr}`);
}
console.log();
console.log("Template distribution:");
for (const [tid, count] of Object.entries(templateCounts)) {
  const t = registry.find((x) => x.id === tid);
  const isTypeA = t.regionDetection !== null && t.autoFit !== null;
  const typeLabel = isTypeA
    ? "Type A — region detect + auto-fit, ~13s/page"
    : "Type B — static CSS, ~3s/page";
  console.log(`  ${tid}: ${count} scenes (${typeLabel})`);
}
const estMin = Math.round((story.scenes.length * 13) / 60);
const estMax = Math.round((story.scenes.length * 15) / 60);
console.log();
console.log(`Estimated wall time: ~${estMin}-${estMax} min (12 Gemini calls + per-page rendering)`);
console.log();
console.log("Character sheets:");
if (sheetsToMintCount === 0) {
  console.log(`  ${totalSheetsNeeded} already on disk across ${subjectList.length} subject${subjectList.length === 1 ? "" : "s"} — will reuse (no API call)`);
} else {
  const reusedCount = totalSheetsNeeded - sheetsToMintCount;
  const reuseNote = reusedCount > 0 ? ` (${reusedCount} already on disk — reusing)` : "";
  console.log(`  ${sheetsToMintCount} calls × $0.04 = $${sheetsCost.toFixed(2)} across ${subjectList.length} subject${subjectList.length === 1 ? "" : "s"}${reuseNote}:`);
  for (const s of subjectList) {
    const tag = s.isProtagonist
      ? "protagonist (3 views: front + 3/4 + side)"
      : `secondary, ${s.subject_type} (${s.viewCount} view${s.viewCount === 1 ? "" : "s"})`;
    console.log(`    - ${s.name}: ${tag}`);
  }
}
console.log();
console.log("Scene images:");
console.log(`  ${story.scenes.length} calls × $0.04 = $${scenesCost.toFixed(2)}`);
console.log();
console.log("Fallback:");
console.log(`  ${fallbackTemplate.id} (tagged "default")`);
console.log(`  On failure: retry once with same template (only for Failure A);`);
console.log(`  if still fails, escalate to fallback. Worst case: +$${worstEscalationCost.toFixed(2)}`);
console.log(`  if every page retries + escalates.`);
console.log();
console.log(`Total estimated cost: $${baseCost.toFixed(2)} (best) — $${(baseCost + worstEscalationCost).toFixed(2)} (worst case escalation)`);
console.log();
console.log("Output:");
console.log(`  ${displayPath(bookDir)}/`);
console.log(`    character-sheets/  ${sheetsExist ? "(reused)" : "(generated)"}`);
console.log(`    pages/page-NN.png + page-NN.pdf  (${story.scenes.length} pages)`);
console.log(`    book.pdf  (final merged book)`);
console.log(`    escalations.log  (per-scene failure log, if any)`);
console.log();

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

// ---- Initialize status.json sidecar ----------------------------------------
createStatusFile(bookDir, {
  currentState: "starting",
  progress: {
    sheets_total: totalSheetsNeeded,
    sheets_completed: totalSheetsNeeded - sheetsToMintCount,
    pages_total: story.scenes.length,
    pages_completed: 0,
  },
  jobStartPayload: {
    input_summary: {
      protagonist: childName,
      age: childAge,
      subjects_count: subjectList.length,
      scenes_count: story.scenes.length,
    },
  },
});
registerAbortHandlers(bookDir);

const emitStatus = (payload) => {
  try { updateStatus(bookDir, payload); } catch { /* never break the call path */ }
};
const onSlowCall = (event) => {
  try { updateStatus(bookDir, { event }); } catch { /* never break the call path */ }
};

// ---- Run the pipeline ------------------------------------------------------
let result;
try {
  result = await generateBook({
    story,
    meta,
    childName,
    childAge,
    outputDir: bookDir,
    registry,
    sheetsOnly: Boolean(args["sheets-only"]),
    onlyPages: args["only-pages"]
      ? new Set(String(args["only-pages"]).split(",").map((n) => parseInt(n.trim(), 10)).filter(Number.isFinite))
      : null,
    emitStatus,
    onSlowCall,
  });
} catch (err) {
  console.error();
  console.error(`FAIL: ${err?.message ?? err}`);
  const errorPayload = err?.kind
    ? { kind: err.kind, ...(err.detail ?? {}) }
    : { kind: "book_gen_error", message: String(err?.message ?? err).slice(0, 300) };
  try {
    finalizeStatus(bookDir, { state: "failed", error: errorPayload });
  } catch { /* never fail through status emission */ }
  process.exit(1);
}

// ---- --sheets-only: report + exit after Section A ---------------------------
if (result.sheetsOnly) {
  const succeeded = result.sheetResults.filter((r) => r.status === "succeeded").length;
  const reusedCount = totalSheetsNeeded - sheetsToMintCount;
  console.log();
  console.log("=".repeat(70));
  console.log("--sheets-only flag set — exiting after sheet-gen (no page rendering).");
  console.log("=".repeat(70));
  console.log(`Sheets minted: ${succeeded} / ${sheetsToMintCount}${reusedCount > 0 ? ` (${reusedCount} reused from disk)` : ""}`);
  console.log(`Total cost:    $${result.sheetsActualCost.toFixed(2)}`);
  console.log();
  console.log("Per-subject summary:");
  for (const subject of subjectList) {
    const status = result.subjectSheetStatus[subject.id];
    const tag = subject.isProtagonist
      ? "protagonist"
      : `secondary (${subject.subject_type})`;
    const summaryText = !status
      ? "skipped (no meta entry)"
      : status.skipped
        ? `⚠ skipped: ${status.sheetFiles.length}/${subject.viewCount} sheets`
        : `✓ ${status.sheetFiles.length}/${subject.viewCount} sheets`;
    console.log(`  ${subject.name} [${tag}]: ${summaryText}`);
    if (status) for (const f of status.sheetFiles) console.log(`    - ${displayPath(path.join(sheetsDir, f))}`);
  }
  console.log();
  try {
    finalizeStatus(bookDir, { state: "completed" });
  } catch { /* never fail through status emission */ }
  process.exit(0);
}

// ---- Update meta.json with book-gen result ---------------------------------
if (meta) {
  meta.bookGeneration = result.summary;
  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));
} else {
  const minimalMeta = {
    inputs: { child: { name: childName, age: childAge } },
    bookGeneration: result.summary,
  };
  fs.writeFileSync(metaPath, JSON.stringify(minimalMeta, null, 2));
}

// ---- Finalize status.json --------------------------------------------------
try {
  if (result.counts.failed > 0) {
    finalizeStatus(bookDir, {
      state: "failed",
      error: {
        kind: "page_render_partial_failure",
        pages_failed: result.counts.failed,
        pages_succeeded: result.counts.success + result.counts.success_after_retry + result.counts.escalated,
        message: `${result.counts.failed} of ${story.scenes.length} pages failed to render after retry + fallback`,
      },
    });
  } else {
    finalizeStatus(bookDir, { state: "completed" });
  }
} catch (statusErr) {
  console.warn(`(status write failed: ${statusErr.message})`);
}

process.exit(result.counts.failed > 0 ? 1 : 0);
