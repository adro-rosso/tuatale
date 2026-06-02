// scripts/generate-book.js — Stream 3 Step 3 (2026-05-19): multi-template orchestration
//
// Reads a story.json with per-scene layout_intent, generates character sheets
// (or reuses existing), renders each scene through src/page-pipeline.js using
// the scene's chosen template, escalates failures to a fallback template, and
// merges per-page PDFs into book.pdf via pdf-lib.
//
// Hybrid CLI: either --book-dir (existing dir with story.json) or
// --story-path (creates a fresh book dir under output/books/<id>/ from a
// story.json located elsewhere — typically output/stories/<id>/story.json).
//
// Section A — character sheets (only if missing)
// Section B — per-scene render via src/page-pipeline.js with escalation
// Section C — pdf-lib merge into book.pdf

import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { PDFDocument } from "pdf-lib";
import { generateImage, MODEL as GEMINI_MODEL } from "../src/gemini.js";
import { loadTemplateRegistry, findTemplate } from "../src/template-registry.js";
import { renderPageWithTemplate } from "../src/page-pipeline.js";
import { allocate } from "../src/allocator.js";
import { createStatusFile, updateStatus, finalizeStatus, registerAbortHandlers } from "../src/status-writer.js";
import { WallCeilingError } from "../src/wall-ceiling.js";
import {
  computeMarkerFingerprint,
  resolveSheetState,
  writeSheetMeta,
  buildSheetMeta,
  snapshotPreviousMeta,
  SheetState,
} from "../src/sheet-meta.js";
import { maskName } from "../src/text-utils.js";

// ---- Paths -----------------------------------------------------------------
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, "..");
const BOOKS_DIR = path.join(PROJECT_ROOT, "output", "books");

// ---- Constants -------------------------------------------------------------
const GEMINI_IMAGE_USD_PER_CALL = 0.04;
const CHARACTER_SHEET_PROMPTS = [
  "front-facing portrait, neutral expression, plain cream background",
  "three-quarter view, slight smile, plain cream background",
  "side profile, neutral expression, plain cream background",
];
const MIN_GEMINI_CALL_GAP_MS = 6000;
// Template tagged with "default" in aesthetic_intent is the fallback when
// originally-chosen template fails. Contract: there must be exactly one such
// template (validated at startup).
const FALLBACK_TAG = "default";

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

// ---- Helpers (preserved verbatim from prior generate-book.js) --------------

/** Pause execution for `ms` milliseconds. */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Value-less boolean flags. parseArgs must NOT consume a following token as
// their "value" (and must NOT throw "missing value" when they're bare).
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

// Latinize diacritics so slugs are clean ASCII (Søren → soren). NFKD
// decomposes most accented letters; stroked/ligature letters (ø, æ, œ,
// ð, þ, ł, đ, ß) don't decompose under NFKD and need an explicit map.
// Only affects the filesystem slug — narrative content keeps diacritics.
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

/**
 * Strip the protagonist's proper-noun name(s) from a paragraph, then fix the
 * leading "is a/an" fragment. Case-sensitive — see prior generate-book.js for
 * the edge-case rationale.
 */
// maskName extracted to src/text-utils.js (Item 4, 2026-06-01) — see the
// imports above. The extraction fixed punctuation orphans, case-sensitivity,
// and smart-quote possessive handling. Existing call sites in this file are
// unchanged (same function signature).

/**
 * Build the prompt scaffold shared by character-sheet calls. Phase-1 mirror,
 * adapted for our story shape. Used only for character sheets in this
 * script — scene-image prompt construction lives inside src/page-pipeline.js.
 */
function buildBasePrompt(story, age, name) {
  const appearance = maskName(story.character, name);
  return [
    `Subject: a ${age}-year-old child.`,
    `Appearance: ${appearance}.`,
    `Style: ${story.style}.`,
    `Composition: ${story.composition_rules}.`,
    `Avoid: ${story.negative_prompt}.`,
  ].join("\n");
}

// ---- Multi-character sheet-gen helpers (Step 2 build, 2026-05-30) --------
// Gender no longer rides as a sheet-mint marker. Step 2.5's first attempt
// (2026-05-30) added an abstract "(0) clearly boyish face, build, and
// presentation" marker prepended to the DEFINING IDENTITY MARKERS line —
// it FAILED on Theo: front read female, three-quarter androgynous + hair
// marker drifted. The Stage B lesson held harder than designed: Gemini
// weighs concrete visual styling cues (like "long straight black hair to
// the jawline") higher than abstract gender-framing language regardless of
// the (0) marker's ordering.
//
// F-approach (Step 2.5 retry, 2026-05-30): bake gender into Sonnet's
// appearance prose itself (CHARACTER DESCRIPTION + COMPANIONS system-prompt
// sections now require gender-coded STYLING vocabulary). The masked
// appearance block that flows to Gemini already carries gendered phrasing
// ("a boy's haircut" wrapping the stated length/color, "boyish build",
// "a boy's striped tee" wrapping the stated colors) — so the sheet-mint
// prompt no longer needs a separate (0) marker. The customer's input
// markers remain as (1)(2)(3) under the unchanged DEFINING IDENTITY
// MARKERS structure.
//
// subject.gender is still threaded through buildSubjectListForSheetGen for
// validation (meta authoritatively records "this is a boy"), but it is no
// longer consumed by the prompt assembly here.

// Format a "DEFINING IDENTITY MARKERS — <name> has: ..." emphasis line per
// the Stage A/B-validated marker-emphasis pattern. Splits on semicolons for
// numbering when 2+ pieces; falls back to verbatim string otherwise.
function formatMarkers(name, markersStr) {
  if (!markersStr || !markersStr.trim()) return null;
  const pieces = markersStr.split(/;\s*/).map((p) => p.trim()).filter(Boolean);
  if (pieces.length >= 2) {
    const numbered = pieces.map((p, i) => `(${i + 1}) ${p}`).join("; ");
    return `DEFINING IDENTITY MARKERS — ${name} has: ${numbered}.`;
  }
  return `DEFINING IDENTITY MARKERS — ${name} has: ${markersStr.trim()}.`;
}

// Sheet-gen prompt for ONE subject (protagonist OR a secondary). Mirrors
// buildBasePrompt's structure but adds the DEFINING IDENTITY MARKERS line
// when a markers source is available — Stage A/B's emphasis pattern. Gender
// signal rides inside the masked appearance block (per the F-approach
// comment above), not as a separate marker.
function buildSubjectSheetBasePrompt(subject, story) {
  // Subject label: protagonist stays anonymous ("a child"); secondaries are
  // named (Gemini doesn't render the name as text; the name in the label is
  // metadata for the model). Name is still masked from the description.
  let subjectLabel;
  if (subject.isProtagonist) {
    subjectLabel = `a ${subject.age}-year-old child`;
  } else if (subject.subject_type === "human") {
    subjectLabel = `a ${subject.age}-year-old child named ${subject.name}`;
  } else {
    subjectLabel = `${subject.name}, a handmade non-human subject`;
  }
  const maskedDesc = maskName(subject.character_description, subject.name);
  const lines = [
    `Subject: ${subjectLabel}. Reference sheet.`,
    `Appearance: ${maskedDesc}.`,
  ];
  const markersLine = formatMarkers(subject.name, subject.markers);
  if (markersLine) lines.push(markersLine);
  lines.push(
    `Style: ${story.style}.`,
    `Composition: ${story.composition_rules}.`,
    `Avoid: ${story.negative_prompt}.`,
  );
  return lines.join("\n");
}

// Build the subject list driving Section A. Protagonist always present;
// companions sourced from story.companion_characters[] joined by name with
// meta.inputs.secondaries[] (for id / subject_type / appearance_markers).
// View count per subject_type per the design (Stage A/B-validated):
//   protagonist (human):     3 (front + three-quarter + side)
//   human secondary:         2 (front + three-quarter; drop side)
//   non_human secondary:     1 (front-facing)
function buildSubjectListForSheetGen(story, meta, protagonistName, protagonistAge) {
  // Gender required on every human subject. We mirror generate-story.js's
  // GENDERS set + reject-on-missing posture here so a meta.json produced
  // before Step 2.5 (no gender field) bails BEFORE any Gemini call.
  const GENDERS = new Set(["boy", "girl", "non_binary"]);
  const protagonistGender = meta?.inputs?.child?.gender;
  if (typeof protagonistGender !== "string" || !GENDERS.has(protagonistGender)) {
    throw new Error(
      `meta.inputs.child.gender is required and must be one of: ${[...GENDERS].join(", ")}. ` +
      `Got: ${JSON.stringify(protagonistGender)}. ` +
      `If this story was generated before the gender-fix (Step 2.5, 2026-05-30), regenerate it.`
    );
  }
  const subjects = [];
  subjects.push({
    id: "protagonist",
    name: protagonistName,
    age: protagonistAge,
    character_description: story.character,
    markers: meta?.inputs?.child?.appearance ?? null,
    subject_type: "human",
    gender: protagonistGender,
    anchor: "tier2", // protagonist is always ref-anchored
    isProtagonist: true,
    viewCount: 3,
    sheetPathPrefix: "sheet", // → sheet-NN.png (legacy convention; unchanged)
  });
  const companions = Array.isArray(story.companion_characters) ? story.companion_characters : [];
  const metaSecs = Array.isArray(meta?.inputs?.secondaries) ? meta.inputs.secondaries : [];
  // Tier-1 (text-anchored) secondaries don't appear in story.companion_characters
  // (per the COMPANIONS system-prompt guidance — story-gen never emits them
  // there). So this loop naturally only sees tier-2 secondaries. But we still
  // tag each entry with anchor explicitly for downstream clarity + apply the
  // backward-compat default ("tier2") for pre-2026-05-31 meta.json files
  // that predate the anchor field.
  for (const c of companions) {
    const ms = metaSecs.find((s) => s.name === c.name);
    if (!ms) {
      console.warn(
        `  ⚠ No meta.inputs.secondaries entry for companion "${c.name}" — skipping sheet-gen for this secondary ` +
        `(cannot determine subject_type, id, or markers).`
      );
      continue;
    }
    // Backward-compat: anchor missing on old meta → default tier2 (the only
    // existing secondary subjects in the codebase before 2026-05-31 were all
    // ref-anchored — Theo, Bolt, Mira). New inputs validated explicit at the
    // CLI layer.
    const anchor = ms.anchor === "tier1" ? "tier1" : "tier2";
    if (anchor === "tier1") {
      // Defensive: tier-1 entities shouldn't make it into story.companion_characters
      // per the system prompt. If they do, treat as input error.
      throw new Error(
        `meta.inputs.secondaries entry for "${c.name}" has anchor "tier1" but appears in story.companion_characters — ` +
        `tier-1 entities are text-only and must NOT be in companion_characters[]. Story-gen layer violated the COMPANIONS guidance.`
      );
    }
    const isHuman = ms.subject_type === "human";
    if (isHuman) {
      if (typeof ms.gender !== "string" || !GENDERS.has(ms.gender)) {
        throw new Error(
          `meta.inputs.secondaries entry for "${c.name}" is human but missing valid 'gender' ` +
          `(must be one of: ${[...GENDERS].join(", ")}; got ${JSON.stringify(ms.gender)}). ` +
          `Regenerate the story with the gender field populated.`
        );
      }
    }
    subjects.push({
      id: ms.id,
      name: c.name,
      age: ms.age,
      character_description: c.character_description,
      markers: ms.appearance_markers,
      subject_type: ms.subject_type,
      gender: isHuman ? ms.gender : null,
      anchor,
      isProtagonist: false,
      viewCount: isHuman ? 2 : 1,
      sheetPathPrefix: ms.id, // → <id>-NN.png (e.g. companion-1-01.png)
    });
  }
  return subjects;
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
  // Determine run-id: prefer meta.json's run_id; else build from --name + now
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

// ---- Validate story.json shape ---------------------------------------------
if (!Array.isArray(story.scenes) || story.scenes.length !== 12) {
  console.error(
    `FAIL: story.json scenes must be an array of exactly 12 (got: ` +
    `${Array.isArray(story.scenes) ? story.scenes.length : "non-array"}).`
  );
  process.exit(1);
}

// ---- Load template registry + validate layout_intents ---------------------
const registry = await loadTemplateRegistry();
const fallbackTemplate = registry.find(
  (t) => t.selection_metadata.aesthetic_intent.includes(FALLBACK_TAG)
);
if (!fallbackTemplate) {
  console.error(
    `FAIL: no template tagged "${FALLBACK_TAG}" in aesthetic_intent. ` +
    `Cannot escalate failures. Tag one template as the fallback.`
  );
  process.exit(1);
}

const validationErrors = [];
for (const scene of story.scenes) {
  if (!scene.layout_intent || !scene.layout_intent.template_id) {
    validationErrors.push(`Scene ${scene.page}: missing layout_intent.`);
    continue;
  }
  try {
    findTemplate(registry, scene.layout_intent.template_id);
  } catch (e) {
    validationErrors.push(`Scene ${scene.page}: ${e.message}`);
  }
}
if (validationErrors.length > 0) {
  console.error();
  console.error("FAIL: story.json validation errors:");
  for (const e of validationErrors) console.error(`  ${e}`);
  console.error();
  console.error("This story.json was likely generated under the v1 system prompt");
  console.error("(pre-Stream-3 of 2026-05-19) and cannot be used by the multi-template");
  console.error("pipeline as-is.");
  console.error();
  console.error("Two migration paths:");
  console.error(`  1. Hand-edit story.json — add 'layout_intent: { template_id, rationale }'`);
  console.error(`     to each scene. Free; preserves existing narrative content.`);
  console.error(`  2. Regenerate via scripts/generate-story.js with v2 system prompt`);
  console.error(`     (~$0.11). May produce different narrative text.`);
  process.exit(1);
}

// ---- Prepare output paths --------------------------------------------------
const sheetsDir = path.join(bookDir, "character-sheets");
const pagesDir = path.join(bookDir, "pages");
const bookPdfPath = path.join(bookDir, "book.pdf");
const escalationsLogPath = path.join(bookDir, "escalations.log");
fs.mkdirSync(sheetsDir, { recursive: true });
fs.mkdirSync(pagesDir, { recursive: true });

// Multi-character sheet plan — protagonist + 0..N secondaries with per-
// subject view counts (Stage A/B-validated). Step 2 build, 2026-05-30.
const subjectList = buildSubjectListForSheetGen(story, meta, childName, childAge);
const totalSheetsNeeded = subjectList.reduce((sum, s) => sum + s.viewCount, 0);

// Per-subject sheet-reuse state machine (Item 3, 2026-06-01). Replaces the
// Step 2.5 detect-and-skip's implicit all-or-nothing logic with five explicit
// states + a marker-fingerprint check. See src/sheet-meta.js for the state
// definitions and resolution algorithm.
//
// We pre-compute each subject's fingerprint + state once here so the cost
// gate display, the mint loop, and status.json events all agree on what
// will happen before any Gemini spend.
function buildAppearanceForFingerprint(subject) {
  // The mint-time Appearance: block uses maskName(character_description, name)
  // for both protagonist and secondaries. We mirror that here so fingerprint
  // changes when the description prose changes (not just when name does).
  return maskName(subject.character_description ?? "", subject.name ?? "");
}
const subjectReuseInfo = new Map();
for (const s of subjectList) {
  const fingerprint = computeMarkerFingerprint({
    subjectName: s.name,
    subjectType: s.subject_type,
    gender: s.gender,
    appearanceDescription: buildAppearanceForFingerprint(s),
    markers: s.markers ?? "",
  });
  const resolution = resolveSheetState({
    subjectId: s.id,
    sheetPathPrefix: s.sheetPathPrefix,
    expectedViewCount: s.viewCount,
    currentFingerprint: fingerprint,
    sheetsDir,
  });
  subjectReuseInfo.set(s.id, { ...resolution, fingerprint });
}
// Sheets-to-mint count per state:
//   COLD_START + MISMATCH_REMINT + LEGACY_PARTIAL → mint all viewCount
//   PARTIAL_RESUME → mint only the missing view indices
//   FULL_SKIP + LEGACY_SKIP + VIEW_EXCESS → 0 (reuse only)
function sheetsToMintForSubject(s) {
  const info = subjectReuseInfo.get(s.id);
  if (info.state === SheetState.COLD_START
      || info.state === SheetState.MISMATCH_REMINT
      || info.state === SheetState.LEGACY_PARTIAL) {
    return s.viewCount;
  }
  if (info.state === SheetState.PARTIAL_RESUME) {
    return info.missingViewIndices.length;
  }
  return 0;
}
const sheetsToMintCount = subjectList.reduce((sum, s) => sum + sheetsToMintForSubject(s), 0);

// Legacy protagonist-only flag kept for the single-protagonist degenerate
// case (CONFIRM gate display + Section B sheet-reuse path). Subsumed by
// subjectReuseInfo but harmless.
const sheetFiles = ["sheet-01.png", "sheet-02.png", "sheet-03.png"];
const sheetsExist = sheetFiles.every((f) => fs.existsSync(path.join(sheetsDir, f)));

// ---- Cost estimate + template distribution ---------------------------------
const sheetsCost = sheetsToMintCount * GEMINI_IMAGE_USD_PER_CALL;
const scenesCost = story.scenes.length * GEMINI_IMAGE_USD_PER_CALL;
const baseCost = sheetsCost + scenesCost;
// Worst case: each scene's first attempt fails (Failure A → retry, +1 call) AND fallback fires (+1 call). So +2 calls per page.
const worstEscalationCost = story.scenes.length * GEMINI_IMAGE_USD_PER_CALL * 2;

const templateCounts = {};
for (const scene of story.scenes) {
  const tid = scene.layout_intent.template_id;
  templateCounts[tid] = (templateCounts[tid] || 0) + 1;
}

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
console.log(`  ${fallbackTemplate.id} (tagged "${FALLBACK_TAG}")`);
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

const tBookStart = Date.now();

// ---- Initialize status.json sidecar (pre-launch defect cleanup Item 1) ----
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
const onSlowCall = (event) => {
  try { updateStatus(bookDir, { event }); } catch { /* never break the call path */ }
};

// Item 5 D4 + D5: register uncaught / unhandled-rejection / SIGINT handlers
// so a process-level crash or Ctrl-C finalizes status.json as "aborted"
// instead of leaving it stuck mid-flight.
registerAbortHandlers(bookDir);

// ---- Section A: character sheets -------------------------------------------
// Subject-list-driven sheet-gen (Step 2 build, 2026-05-30). Loops every
// subject in `subjectList` (protagonist + companions); each subject mints
// its own view count via the existing generateImage text-only recipe with
// the Stage A/B marker-emphasis pattern. Sheets are stored per the design
// convention: protagonist → sheet-NN.png (legacy); secondaries →
// <id>-NN.png. Section B downstream still receives the protagonist's
// sheets via `sheetBuffers` for now — the per-page allocator + secondary-
// aware render path is Step 3.
let sheetBuffers = [];
let sheetsActualCost = 0;
// Running total of sheets either reused or freshly minted — feeds the
// progress.sheets_completed counter in status.json.
let sheetsCompletedCount = totalSheetsNeeded - sheetsToMintCount;
const sheetResults = [];
// Per-subject sheet status — consumed by Step 3's allocator. Schema:
//   { [subjectId]: { sheetFiles: [filename, ...], skipped: boolean } }
const subjectSheetStatus = {};

console.log();
if (sheetsToMintCount === 0) {
  console.log(`Step 1/3: Reusing all ${totalSheetsNeeded} character sheets already on disk across ${subjectList.length} subject${subjectList.length === 1 ? "" : "s"}.`);
} else {
  console.log(`Step 1/3: Generating ${sheetsToMintCount} character sheet${sheetsToMintCount === 1 ? "" : "s"} across ${subjectList.length} subject${subjectList.length === 1 ? "" : "s"}${sheetsToMintCount < totalSheetsNeeded ? ` (${totalSheetsNeeded - sheetsToMintCount} already on disk — reusing)` : ""}...`);
}
updateStatus(bookDir, {
  currentState: "sheet_mint",
  currentStep: { kind: "sheet_mint", detail: `${sheetsToMintCount} sheets to mint`, started_at: new Date().toISOString() },
});
let callIdx = 0;
for (let sIdx = 0; sIdx < subjectList.length; sIdx++) {
  const subject = subjectList[sIdx];
  const subjectTag = subject.isProtagonist
    ? "protagonist"
    : `secondary, ${subject.subject_type}`;
  const reuse = subjectReuseInfo.get(subject.id);

  // ---- Skip-only branches (Item 3 states A / A-Legacy / D) ----------------
  // FULL_SKIP, LEGACY_SKIP, VIEW_EXCESS all mean "use existing sheets, no
  // Gemini call". They differ in the status.json event kind so the
  // orchestrator can show the right message to the customer.
  if (reuse.state === SheetState.FULL_SKIP
      || reuse.state === SheetState.LEGACY_SKIP
      || reuse.state === SheetState.VIEW_EXCESS) {
    const expectedFilenames = Array.from({ length: subject.viewCount }, (_, i) =>
      `${subject.sheetPathPrefix}-${String(i + 1).padStart(2, "0")}.png`,
    );
    const skipReason = reuse.state === SheetState.FULL_SKIP ? "reused"
      : reuse.state === SheetState.LEGACY_SKIP ? "reused_legacy_no_fingerprint"
      : "reused_view_excess";
    const eventKind = reuse.state === SheetState.FULL_SKIP ? "sheet_mint_skip_full"
      : reuse.state === SheetState.LEGACY_SKIP ? "sheet_mint_skip_legacy"
      : "sheet_mint_view_excess";
    const sheetLabel = `${expectedFilenames.length} sheet${expectedFilenames.length === 1 ? "" : "s"}`;
    if (reuse.state === SheetState.LEGACY_SKIP) {
      console.log(`  ↻ ${subject.name} [${subjectTag}, ${subject.viewCount} view${subject.viewCount === 1 ? "" : "s"}]: reusing ${sheetLabel} (LEGACY: no meta fingerprint — cannot verify markers).`);
    } else if (reuse.state === SheetState.VIEW_EXCESS) {
      console.log(`  ↻ ${subject.name} [${subjectTag}, ${subject.viewCount} view${subject.viewCount === 1 ? "" : "s"}]: reusing ${sheetLabel} (${reuse.excessFiles.length} excess sheet${reuse.excessFiles.length === 1 ? "" : "s"} on disk ignored).`);
    } else {
      console.log(`  ↻ ${subject.name} [${subjectTag}, ${subject.viewCount} view${subject.viewCount === 1 ? "" : "s"}]: reusing ${sheetLabel} (skipping mint, fingerprint match).`);
    }
    const reuseBufs = expectedFilenames.map((f) => fs.readFileSync(path.join(sheetsDir, f)));
    if (subject.isProtagonist) {
      sheetBuffers = reuseBufs;
    }
    subjectSheetStatus[subject.id] = { sheetFiles: [...expectedFilenames], skipped: false };
    updateStatus(bookDir, {
      event: {
        kind: eventKind,
        subject: subject.name,
        sheets_reused: expectedFilenames.length,
        excess_ignored: reuse.excessFiles.length,
      },
    });
    // Emit per-view skipped events so the progress counter reads coherently
    // alongside cold-start mints.
    for (let v = 0; v < expectedFilenames.length; v++) {
      updateStatus(bookDir, {
        event: { kind: "sheet_mint_skipped", subject: subject.name, view: v + 1, reason: skipReason },
      });
    }
    continue;
  }

  // ---- Mint branches (Item 3 states B / C / E + Item 5 F1 LEGACY_PARTIAL) -
  // COLD_START → mint all views from scratch
  // PARTIAL_RESUME → mint only the missing view indices, reuse the present
  //   ones (mint-resume after partial failure with matching fingerprint)
  // MISMATCH_REMINT → mint all views, overwriting existing sheets AND the
  //   stale meta file (customer changed markers between runs)
  // LEGACY_PARTIAL → mint all views, overwriting any partial leftovers from
  //   a prior crashed run (no meta to confirm fingerprint; can't trust the
  //   partial sheets)
  const indicesToMint =
    reuse.state === SheetState.PARTIAL_RESUME
      ? reuse.missingViewIndices.map((i1based) => i1based - 1)
      : Array.from({ length: subject.viewCount }, (_, i) => i);
  const headerSuffix =
    reuse.state === SheetState.PARTIAL_RESUME
      ? ` (partial-resume: minting ${indicesToMint.length} of ${subject.viewCount} missing view${indicesToMint.length === 1 ? "" : "s"}, reusing ${reuse.presentFiles.length})`
      : reuse.state === SheetState.MISMATCH_REMINT
      ? ` (MISMATCH: markers changed since last mint — re-painting all ${subject.viewCount} view${subject.viewCount === 1 ? "" : "s"})`
      : reuse.state === SheetState.LEGACY_PARTIAL
      ? ` (LEGACY-PARTIAL: ${reuse.presentFiles.length} of ${subject.viewCount} sheet${reuse.presentFiles.length === 1 ? "" : "s"} on disk from a prior crashed run with no meta — full re-mint to recover)`
      : "";
  console.log(`  ${subject.name} [${subjectTag}, ${subject.viewCount} view${subject.viewCount === 1 ? "" : "s"}]:${headerSuffix}`);
  // Per-state status event prior to minting.
  updateStatus(bookDir, {
    event: {
      kind:
        reuse.state === SheetState.PARTIAL_RESUME ? "sheet_mint_partial_resume"
        : reuse.state === SheetState.MISMATCH_REMINT ? "sheet_mint_marker_mismatch_remint"
        : reuse.state === SheetState.LEGACY_PARTIAL ? "sheet_mint_legacy_partial_recovery"
        : "sheet_mint_cold_start",
      subject: subject.name,
      views_to_mint: indicesToMint.map((i) => i + 1),
      views_reused: reuse.state === SheetState.PARTIAL_RESUME ? reuse.presentFiles.length : 0,
      ...(reuse.state === SheetState.MISMATCH_REMINT
        ? {
          previous_fingerprint: reuse.existingMeta?.marker_fingerprint ?? null,
          current_fingerprint: reuse.fingerprint,
          // Item 5 F4: snapshot the customer-dispute-relevant fields of the
          // previous meta into the event payload, in addition to the on-disk
          // .previous.json snapshot. Saves a future forensic reader from
          // having to find both files.
          previous_meta: {
            appearance_description_normalized: reuse.existingMeta?.appearance_description_normalized ?? null,
            markers_normalized: reuse.existingMeta?.markers_normalized ?? null,
            gender: reuse.existingMeta?.gender ?? null,
            minted_at: reuse.existingMeta?.minted_at ?? null,
            minted_for_book: reuse.existingMeta?.minted_for_book ?? null,
            fingerprint: reuse.existingMeta?.marker_fingerprint ?? null,
          },
        }
        : {}),
      ...(reuse.state === SheetState.LEGACY_PARTIAL
        ? {
          present_files: reuse.presentFiles,
          missing_view_indices: reuse.missingViewIndices,
        }
        : {}),
    },
  });
  if (reuse.state === SheetState.MISMATCH_REMINT) {
    console.warn(`  ⚠ ${subject.name}: marker fingerprint mismatch (was ${reuse.existingMeta?.marker_fingerprint?.slice(0, 8)}…, now ${reuse.fingerprint.slice(0, 8)}…) — overwriting existing sheets + meta.`);
    // Item 5 F4: snapshot the previous meta BEFORE the new mint overwrites
    // it. The snapshot lands at <id>-meta.previous.json (with .previous.N.json
    // archives if older snapshots exist). Customer-dispute artifact: "here's
    // exactly what your character looked like before."
    try {
      const previousMetaSnapshotPath = snapshotPreviousMeta(sheetsDir, subject.id, reuse.existingMeta);
      updateStatus(bookDir, {
        event: {
          kind: "sheet_meta_previous_snapshotted",
          subject: subject.name,
          snapshot_path: path.relative(bookDir, previousMetaSnapshotPath).replace(/\\/g, "/"),
          previous_fingerprint: reuse.existingMeta?.marker_fingerprint ?? null,
        },
      });
    } catch (snapErr) {
      console.warn(`  ⚠ Failed to snapshot previous meta: ${snapErr.message}`);
    }
  }
  const basePrompt = buildSubjectSheetBasePrompt(subject, story);
  const subjectSucceededFiles = [];
  const subjectBufs = [];
  // Iterate ALL views in order so subjectBufs ends up in [front, 3/4, side]
  // order. For PARTIAL_RESUME, reused-from-disk views are inlined here so
  // the order is preserved without a separate compaction pass.
  for (let i = 0; i < subject.viewCount; i++) {
    const sheetNum = String(i + 1).padStart(2, "0");
    const filename = `${subject.sheetPathPrefix}-${sheetNum}.png`;
    const filePath = path.join(sheetsDir, filename);

    // Reuse path (PARTIAL_RESUME only): this view's file is already on disk
    // with a matching fingerprint. Read it and skip the mint.
    if (!indicesToMint.includes(i)) {
      const buf = fs.readFileSync(filePath);
      subjectBufs.push(buf);
      subjectSucceededFiles.push(filename);
      updateStatus(bookDir, {
        event: { kind: "sheet_mint_skipped", subject: subject.name, view: i + 1, reason: "reused_partial_resume" },
      });
      continue;
    }
    // Mint this view.
    const viewPrompt = CHARACTER_SHEET_PROMPTS[i];
    const fullPrompt = `${basePrompt}\n\nView for this image: ${viewPrompt}.`;
    const t0 = Date.now();
    updateStatus(bookDir, {
      event: { kind: "sheet_mint_start", subject: subject.name, view: i + 1 },
      currentStep: { kind: "sheet_mint", detail: `${subject.name} view ${i + 1}`, started_at: new Date().toISOString() },
    });
    try {
      const buf = await generateImage(fullPrompt, [], {}, {
        callKind: "sheet_mint", subjectName: subject.name, view: i + 1, onSlowCall,
      });
      const ms = Date.now() - t0;
      fs.writeFileSync(filePath, buf);
      subjectBufs.push(buf);
      subjectSucceededFiles.push(filename);
      sheetsActualCost += GEMINI_IMAGE_USD_PER_CALL;
      sheetResults.push({ subject: subject.id, filename, ms, status: "succeeded" });
      callIdx++;
      console.log(`    → [${callIdx}/${sheetsToMintCount}] ${filename}  (${(ms / 1000).toFixed(1)}s)`);
      sheetsCompletedCount += 1;
      updateStatus(bookDir, {
        event: { kind: "sheet_mint_complete", subject: subject.name, view: i + 1, duration_ms: ms, filename },
        progressDelta: { sheets_completed: sheetsCompletedCount },
      });
      if (callIdx < sheetsToMintCount && ms < MIN_GEMINI_CALL_GAP_MS) {
        await sleep(MIN_GEMINI_CALL_GAP_MS - ms);
      }
    } catch (err) {
      const ms = Date.now() - t0;
      sheetResults.push({ subject: subject.id, filename, ms, status: "failed", error: err?.message ?? String(err) });
      callIdx++;
      console.error(`    ✗ [${callIdx}/${sheetsToMintCount}] ${filename}: ${err?.message ?? err}`);
      const errorPayload = err instanceof WallCeilingError
        ? err.toJSON()
        : { kind: "sheet_mint_error", message: String(err?.message ?? err).slice(0, 300) };
      updateStatus(bookDir, {
        event: { kind: "sheet_mint_failed", subject: subject.name, view: i + 1, duration_ms: ms, error: errorPayload },
      });
      if (callIdx < sheetsToMintCount && ms < MIN_GEMINI_CALL_GAP_MS) {
        await sleep(MIN_GEMINI_CALL_GAP_MS - ms);
      }
    }
  }
  // Per-subject failure handling per the design:
  //  - Protagonist: < 2 of 3 → HALT (no protagonist = no book; existing rule).
  //  - Secondary: < required count → mark skipped, continue (graceful degrade).
  if (subject.isProtagonist) {
    if (subjectBufs.length < 2) {
      console.error();
      console.error(
        `FAIL: only ${subjectBufs.length} of ${subject.viewCount} protagonist sheets succeeded. ` +
        `Need ≥2 references for scene rendering. Halting.`
      );
      try {
        finalizeStatus(bookDir, {
          state: "failed",
          error: {
            kind: "protagonist_sheets_insufficient",
            subject_name: subject.name,
            succeeded: subjectBufs.length,
            required: 2,
            attempted: subject.viewCount,
          },
        });
      } catch { /* never fail through status emission */ }
      process.exit(1);
    }
    if (subjectBufs.length < subject.viewCount) {
      console.log(
        `  ⚠ ${subject.viewCount - subjectBufs.length} of ${subject.viewCount} protagonist sheets failed — continuing with ${subjectBufs.length}.`
      );
    }
    sheetBuffers = subjectBufs; // legacy: Section B feeds these to per-page render
    subjectSheetStatus[subject.id] = { sheetFiles: subjectSucceededFiles, skipped: false };
  } else {
    if (subjectBufs.length < subject.viewCount) {
      console.warn();
      console.warn(
        `  ⚠ SECONDARY "${subject.name}" sheet-gen INCOMPLETE: ${subjectBufs.length} of ${subject.viewCount} succeeded. ` +
        `Marking this secondary as SKIPPED for the render layer; book continues with protagonist + any remaining secondaries.`
      );
      subjectSheetStatus[subject.id] = { sheetFiles: subjectSucceededFiles, skipped: true };
      updateStatus(bookDir, {
        event: { kind: "sheet_mint_skipped", subject: subject.name, view: null, reason: "degraded", succeeded: subjectBufs.length, required: subject.viewCount },
      });
    } else {
      subjectSheetStatus[subject.id] = { sheetFiles: subjectSucceededFiles, skipped: false };
    }
  }

  // Item 3: write/update per-subject sheet metadata after a successful mint
  // pass. PARTIAL_RESUME preserves the original minted_at; everything else
  // stamps fresh. We only write when at least one new view was minted (i.e.
  // not for FULL_SKIP / LEGACY_SKIP / VIEW_EXCESS, which never enter the
  // mint loop).
  if (subjectSheetStatus[subject.id]?.skipped === false && subjectBufs.length > 0) {
    const presentViews = subjectSucceededFiles.map((filename) => {
      const m = filename.match(/-(\d+)\.png$/);
      return { view_index: m ? parseInt(m[1], 10) : null, filename };
    });
    const metaPath = writeSheetMeta(sheetsDir, subject.id, buildSheetMeta({
      subjectName: subject.name,
      subjectType: subject.subject_type,
      gender: subject.gender,
      appearanceDescription: buildAppearanceForFingerprint(subject),
      markers: subject.markers ?? "",
      fingerprint: reuse.fingerprint,
      sheetPathPrefix: subject.sheetPathPrefix,
      presentViews,
      mintedAt: reuse.state === SheetState.PARTIAL_RESUME
        ? reuse.existingMeta?.minted_at
        : undefined,
      mintedForBook: path.basename(bookDir),
    }));
    updateStatus(bookDir, {
      event: { kind: "sheet_meta_written", subject: subject.name, meta_path: path.relative(bookDir, metaPath).replace(/\\/g, "/") },
    });
  }
}

// --sheets-only: exit cleanly after Section A. For testing the sheet-gen
// path without the per-page render spend.
if (args["sheets-only"]) {
  const succeeded = sheetResults.filter((r) => r.status === "succeeded").length;
  const reusedCount = totalSheetsNeeded - sheetsToMintCount;
  console.log();
  console.log("=".repeat(70));
  console.log("--sheets-only flag set — exiting after sheet-gen (no page rendering).");
  console.log("=".repeat(70));
  console.log(`Sheets minted: ${succeeded} / ${sheetsToMintCount}${reusedCount > 0 ? ` (${reusedCount} reused from disk)` : ""}`);
  console.log(`Total cost:    $${sheetsActualCost.toFixed(2)}`);
  console.log();
  console.log("Per-subject summary:");
  for (const subject of subjectList) {
    const status = subjectSheetStatus[subject.id];
    const tag = subject.isProtagonist
      ? "protagonist"
      : `secondary (${subject.subject_type})`;
    const result = !status
      ? "skipped (no meta entry)"
      : status.skipped
        ? `⚠ skipped: ${status.sheetFiles.length}/${subject.viewCount} sheets`
        : `✓ ${status.sheetFiles.length}/${subject.viewCount} sheets`;
    console.log(`  ${subject.name} [${tag}]: ${result}`);
    if (status) for (const f of status.sheetFiles) console.log(`    - ${displayPath(path.join(sheetsDir, f))}`);
  }
  console.log();
  try {
    finalizeStatus(bookDir, { state: "completed" });
  } catch { /* never fail through status emission */ }
  process.exit(0);
}

// ---- Section B: per-scene render with escalation --------------------------
console.log();
console.log(`Step ${sheetsExist ? "1" : "2"}/${sheetsExist ? "2" : "3"}: Rendering ${story.scenes.length} pages...`);

// ---- Subject metadata for the per-scene allocator -------------------------
// Build once per book: a map from subject NAME → metadata + all loaded sheet
// buffers + name-masked appearance description. The per-scene wiring uses
// this to resolve scene.subjects_present into renderable subject objects.
//
// Sheet buffers are loaded eagerly from disk (the protagonist's buffers
// are already in `sheetBuffers` from Section A; secondaries are loaded
// here from their per-subject filenames). Sheets are in front → 3/4 → side
// order by minting convention, so slicing [0..viewsAllocated) preserves
// the "front always included" priority.
const subjectMetaByName = {};
{
  const protagonistStatus = subjectSheetStatus[subjectList[0].id]; // subjectList[0] is protagonist
  subjectMetaByName[childName] = {
    id: "protagonist",
    name: childName,
    age: childAge,
    description: maskName(story.character, childName),
    subjectType: "human",
    isProtagonist: true,
    allSheets: sheetBuffers, // already in front → 3/4 → side order
    mintedSheetCount: sheetBuffers.length,
    skipped: protagonistStatus?.skipped === true,
  };
  // Secondaries: loop story.companion_characters[] (the authoritative list
  // for per-scene name resolution); join to subjectList for sheet paths +
  // type, then read sheet bytes from disk.
  const companions = Array.isArray(story.companion_characters) ? story.companion_characters : [];
  for (const c of companions) {
    const subj = subjectList.find((s) => !s.isProtagonist && s.name === c.name);
    if (!subj) continue;
    const status = subjectSheetStatus[subj.id];
    const files = status?.sheetFiles ?? [];
    const sheets = files.map((f) => fs.readFileSync(path.join(sheetsDir, f)));
    subjectMetaByName[c.name] = {
      id: subj.id,
      name: c.name,
      age: subj.age,
      description: maskName(c.character_description, c.name),
      subjectType: subj.subject_type,
      isProtagonist: false,
      allSheets: sheets,
      mintedSheetCount: sheets.length,
      skipped: status?.skipped === true,
    };
  }
}

// Resolve a scene's subjects_present into renderable subjects + an allocated
// view-count per subject. Returns { subjects: [...], allocation, droppedNames }.
// Degraded-skipped subjects (Step 2 fallback) and missing-metadata subjects
// are filtered with a warning before the allocator is called, so the page
// still renders with whoever IS available. The protagonist must remain
// after filtering — if not, throws (no protagonist = no page).
function resolveSceneSubjects(scene) {
  const present = Array.isArray(scene.subjects_present) ? scene.subjects_present : [];
  const usable = [];
  const dropped = [];
  for (const name of present) {
    const meta = subjectMetaByName[name];
    if (!meta) {
      // Unknown name — story-gen's shape-validation should have caught this
      // (the names-match-input invariant). Defense-in-depth: throw so the
      // page fails clearly rather than silently rendering with fewer subjects.
      throw new Error(
        `Scene ${scene.page}: subjects_present contains unknown name "${name}" ` +
        `(not protagonist or in story.companion_characters[]). ` +
        `Valid names: [${Object.keys(subjectMetaByName).join(", ")}].`,
      );
    }
    if (meta.skipped || meta.mintedSheetCount === 0) {
      dropped.push({ name, reason: "skipped at Step 2 (no minted sheets)" });
      continue;
    }
    usable.push(name);
  }
  if (!usable.includes(childName)) {
    throw new Error(
      `Scene ${scene.page}: protagonist "${childName}" missing or degraded; cannot render page.`,
    );
  }
  // Build the metadata map the allocator needs (subset of subjectMetaByName).
  const allocatorMeta = {};
  for (const name of usable) {
    const m = subjectMetaByName[name];
    allocatorMeta[name] = {
      id: m.id,
      isProtagonist: m.isProtagonist,
      subjectType: m.subjectType,
      mintedSheetCount: m.mintedSheetCount,
    };
  }
  const allocation = allocate(usable, allocatorMeta);
  // Compose the subjects array in the order: protagonist first, then the
  // remaining subjects in subjects_present order. Matches the allocator's
  // ordering convention and the References line.
  const protagonistFirst = [childName, ...usable.filter((n) => n !== childName)];
  const subjects = protagonistFirst.map((name) => {
    const m = subjectMetaByName[name];
    const viewsCount = allocation[m.id];
    return {
      name: m.name,
      age: m.age,
      description: m.description,
      subjectType: m.subjectType,
      sheets: m.allSheets.slice(0, viewsCount),
    };
  });
  return { subjects, allocation, dropped };
}

async function tryRender(scene, templateId) {
  const template = findTemplate(registry, templateId);
  const { subjects, dropped } = resolveSceneSubjects(scene);
  for (const d of dropped) {
    console.log(`    ⚠ Page ${scene.page}: dropping subject "${d.name}" — ${d.reason}.`);
  }
  return await renderPageWithTemplate({
    templateConfigPath: template.configPath,
    scene: { page: scene.page, action: scene.action },
    narrativeText: scene.narrative_text,
    subjects,
    sceneStyle: story.style,
    sceneNegativePrompt: story.negative_prompt,
    outputDir: pagesDir,
    callContext: { callKind: "page_render", pageNumber: scene.page, onSlowCall },
  });
}

function classifyFailure(result) {
  const err = result.error || "";
  if (err.includes("detected region too small")) return "B";
  if (err.includes("no readable font size fits")) return "C";
  return "A";
}

const perPageResults = [];
let totalScenesCost = 0;
let pagesCompletedCount = 0;
const escalationEntries = [];

updateStatus(bookDir, {
  currentState: "page_render",
  currentStep: { kind: "page_render", detail: `0 / ${story.scenes.length}`, started_at: new Date().toISOString() },
});

for (let i = 0; i < story.scenes.length; i++) {
  const scene = story.scenes[i];
  const originalTemplateId = scene.layout_intent.template_id;
  const iterStart = Date.now();

  console.log(`  Page ${String(scene.page).padStart(2)}/${story.scenes.length}: ${originalTemplateId}...`);
  updateStatus(bookDir, {
    event: { kind: "page_render_start", page: scene.page, template: originalTemplateId },
    currentStep: { kind: "page_render", detail: `page ${scene.page} (${originalTemplateId})`, started_at: new Date().toISOString() },
  });

  // First attempt with originally-chosen template
  let result = await tryRender(scene, originalTemplateId);
  totalScenesCost += result.diagnostics?.cost ?? 0;
  let outcome = "success";
  let finalTemplate = originalTemplateId;

  if (!result.success) {
    const failureType = classifyFailure(result);
    escalationEntries.push({
      page: scene.page,
      timestamp: new Date().toISOString(),
      attempt: 1,
      template: originalTemplateId,
      failureType,
      error: result.error,
    });
    console.log(`    ⚠ ${failureType}-class failure: ${result.error}`);

    // Failure A: retry once with same template (transient errors)
    if (failureType === "A") {
      console.log(`    Retrying with same template...`);
      updateStatus(bookDir, {
        event: { kind: "page_render_retry", page: scene.page, attempt: 2, error_kind: result.error },
      });
      await sleep(2000);
      result = await tryRender(scene, originalTemplateId);
      totalScenesCost += result.diagnostics?.cost ?? 0;
      if (result.success) {
        outcome = "success_after_retry";
        finalTemplate = originalTemplateId;
      } else {
        escalationEntries.push({
          page: scene.page,
          timestamp: new Date().toISOString(),
          attempt: 2,
          template: originalTemplateId,
          failureType: classifyFailure(result),
          error: result.error,
        });
      }
    }

    // If still failed AND original wasn't already the fallback: escalate
    if (!result.success && originalTemplateId !== fallbackTemplate.id) {
      console.log(`    Escalating to fallback: ${fallbackTemplate.id}`);
      updateStatus(bookDir, {
        event: { kind: "page_render_escalated", page: scene.page, from_template: originalTemplateId, to_template: fallbackTemplate.id },
      });
      result = await tryRender(scene, fallbackTemplate.id);
      totalScenesCost += result.diagnostics?.cost ?? 0;
      if (result.success) {
        outcome = "escalated";
        finalTemplate = fallbackTemplate.id;
      } else {
        escalationEntries.push({
          page: scene.page,
          timestamp: new Date().toISOString(),
          attempt: 3,
          template: fallbackTemplate.id,
          failureType: classifyFailure(result),
          error: result.error,
        });
      }
    }

    if (!result.success) {
      outcome = "failed";
      finalTemplate = null;
    }
  }

  perPageResults.push({
    page: scene.page,
    originalTemplate: originalTemplateId,
    finalTemplate,
    outcome,
    pdfPath: result.success ? result.pdfPath : null,
  });

  if (result.success) {
    const fontSize = result.diagnostics?.fontSize;
    const totalMs = result.diagnostics?.timing?.totalMs ?? 0;
    console.log(`    → ${outcome} (template: ${finalTemplate}, fontSize: ${fontSize}pt, ${(totalMs / 1000).toFixed(1)}s)`);
    pagesCompletedCount += 1;
    updateStatus(bookDir, {
      event: { kind: "page_render_complete", page: scene.page, template: finalTemplate, duration_ms: totalMs, fontSize, outcome },
      progressDelta: { pages_completed: pagesCompletedCount },
    });
  } else {
    console.log(`    ✗ FAILED — both original and fallback templates failed`);
    // Item 5 D2: include the structured error from page-pipeline if available
    // (WallCeilingError.toJSON(), retry_history, etc.). Falls back to a string
    // message wrapper for non-structured errors.
    const errorPayload = result.structuredError
      ? { kind: "all_attempts_failed", last_error_kind: result.structuredError.kind, last_error: result.structuredError }
      : { kind: "all_attempts_failed", last_error: result.error };
    updateStatus(bookDir, {
      event: { kind: "page_render_failed", page: scene.page, error: errorPayload },
    });
  }

  // Pacing — ensure ≥MIN_GEMINI_CALL_GAP_MS since iteration start
  const iterMs = Date.now() - iterStart;
  if (i < story.scenes.length - 1 && iterMs < MIN_GEMINI_CALL_GAP_MS) {
    await sleep(MIN_GEMINI_CALL_GAP_MS - iterMs);
  }
}

// Write escalations.log (newline-delimited JSON, one entry per attempt)
if (escalationEntries.length > 0) {
  const logContent = escalationEntries.map((e) => JSON.stringify(e)).join("\n") + "\n";
  fs.writeFileSync(escalationsLogPath, logContent);
}

// ---- Section C: merge per-page PDFs into book.pdf -------------------------
console.log();
console.log(`Step ${sheetsExist ? "2" : "3"}/${sheetsExist ? "2" : "3"}: Merging per-page PDFs into book.pdf...`);
updateStatus(bookDir, {
  event: { kind: "book_merge_start" },
  currentState: "book_merge",
  currentStep: { kind: "book_merge", detail: `${perPageResults.filter((r) => r.outcome !== "failed").length} pages`, started_at: new Date().toISOString() },
});

const successfulPages = perPageResults.filter((r) => r.outcome !== "failed");
const mergedDoc = await PDFDocument.create();
for (const r of successfulPages) {
  const srcBytes = fs.readFileSync(r.pdfPath);
  const src = await PDFDocument.load(srcBytes);
  const copiedPages = await mergedDoc.copyPages(src, src.getPageIndices());
  copiedPages.forEach((p) => mergedDoc.addPage(p));
}
const mergedBytes = await mergedDoc.save();
fs.writeFileSync(bookPdfPath, mergedBytes);
const bookSize = fs.statSync(bookPdfPath).size;
updateStatus(bookDir, {
  event: { kind: "book_merge_complete", pdf_path: displayPath(bookPdfPath), size_bytes: bookSize },
});

// ---- Final summary --------------------------------------------------------
const totalMs = Date.now() - tBookStart;
const counts = {
  success: perPageResults.filter((r) => r.outcome === "success").length,
  success_after_retry: perPageResults.filter((r) => r.outcome === "success_after_retry").length,
  escalated: perPageResults.filter((r) => r.outcome === "escalated").length,
  failed: perPageResults.filter((r) => r.outcome === "failed").length,
};
const totalCost = sheetsActualCost + totalScenesCost;
const totalCalls = Math.round((sheetsActualCost + totalScenesCost) / GEMINI_IMAGE_USD_PER_CALL);

console.log();
console.log("=".repeat(70));
console.log("Book generation complete.");
console.log("=".repeat(70));
console.log(`  Pages:               ${counts.success} success / ${counts.success_after_retry} after-retry / ${counts.escalated} escalated / ${counts.failed} failed`);
console.log(`  Total Gemini calls:  ${totalCalls}`);
console.log(`  Actual cost:         $${totalCost.toFixed(4)} USD`);
console.log(`  Duration:            ${(totalMs / 1000).toFixed(1)}s`);
console.log(`  Output PDF:          ${displayPath(bookPdfPath)} (${(bookSize / 1024).toFixed(1)} KB)`);
if (escalationEntries.length > 0) {
  console.log(`  Escalations:         ${displayPath(escalationsLogPath)} (${escalationEntries.length} entries)`);
}
console.log();

// ---- Update meta.json with book-gen result --------------------------------
const bookGenSummary = {
  completed_at: new Date().toISOString(),
  duration_seconds: Number((totalMs / 1000).toFixed(2)),
  sheets_reused: sheetsExist,
  sheets_generated: sheetResults.filter((r) => r.status === "succeeded").length,
  pages: counts,
  template_distribution: templateCounts,
  escalation_entries: escalationEntries.length,
  total_cost_usd: Number(totalCost.toFixed(4)),
  total_gemini_calls: totalCalls,
};
if (meta) {
  meta.bookGeneration = bookGenSummary;
  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));
} else {
  // Minimal meta.json if none existed
  const minimalMeta = {
    inputs: { child: { name: childName, age: childAge } },
    bookGeneration: bookGenSummary,
  };
  fs.writeFileSync(metaPath, JSON.stringify(minimalMeta, null, 2));
}

// ---- Finalize status.json -------------------------------------------------
try {
  if (counts.failed > 0) {
    finalizeStatus(bookDir, {
      state: "failed",
      error: {
        kind: "page_render_partial_failure",
        pages_failed: counts.failed,
        pages_succeeded: counts.success + counts.success_after_retry + counts.escalated,
        message: `${counts.failed} of ${story.scenes.length} pages failed to render after retry + fallback`,
      },
    });
  } else {
    finalizeStatus(bookDir, { state: "completed" });
  }
} catch (statusErr) {
  console.warn(`(status write failed: ${statusErr.message})`);
}

process.exit(counts.failed > 0 ? 1 : 0);
