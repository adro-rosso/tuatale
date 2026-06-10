// src/book-pipeline.js — importable book-generation core (Track B, Cycle B.3).
//
// EXTRACTED, verbatim-in-logic, from the top-level module body of
// scripts/generate-book.js (Stream 3 multi-template orchestration). The CLI
// concerns that used to be interleaved with the orchestration — argv parsing,
// the interactive CONFIRM gate, the status.json lifecycle, meta.json writing,
// and process.exit — now live in the thin shim scripts/generate-book.js, which
// calls planBook() + generateBook() here.
//
// Two exports:
//   planBook()     — pure: validate inputs, build the subject list + sheet-reuse
//                    plan + cost/template estimates. Throws on invalid input
//                    (the CLI's process.exit validation became throws).
//   generateBook() — async: Section A (sheet mint), Section B (per-scene render
//                    with escalation), Section C (pdf-lib merge). Returns the
//                    merged PDF bytes + a summary; also writes book.pdf, pages/,
//                    character-sheets/, and escalations.log into outputDir.
//                    Throws on fatal failure instead of process.exit.
//
// Behavioural fidelity vs the pre-extraction script:
//   - Image generation, prompts, sheet-reuse state machine, allocator wiring,
//     escalation logic, and the pdf-lib merge are byte-for-byte the same code.
//   - Observability is now injected, not hard-wired: pass `emitStatus` to
//     receive the status events the script used to write to status.json (the
//     CLI shim wires it back to src/status-writer.js; the Track B worker passes
//     nothing, so no status.json is produced — per the B.2 runtime decision).
//   - `resolveImageOverride(scene)` is a test seam: return an existing PNG path
//     to skip the Gemini call for that scene (used by the B.3 verification
//     harness to replay a fixture's images at $0). Omit in production.

import fs from "node:fs";
import path from "node:path";
import { PDFDocument } from "pdf-lib";
import { generateImage } from "./gemini.js";
import { loadTemplateRegistry, findTemplate } from "./template-registry.js";
import { renderPageWithTemplate } from "./page-pipeline.js";
import { allocate } from "./allocator.js";
import { WallCeilingError } from "./wall-ceiling.js";
import {
  computeMarkerFingerprint,
  resolveSheetState,
  writeSheetMeta,
  buildSheetMeta,
  snapshotPreviousMeta,
  SheetState,
} from "./sheet-meta.js";
import { maskName } from "./text-utils.js";

// ---- Constants (verbatim from generate-book.js) ----------------------------
export const GEMINI_IMAGE_USD_PER_CALL = 0.04;
export const CHARACTER_SHEET_PROMPTS = [
  "front-facing portrait, neutral expression, plain cream background",
  "three-quarter view, slight smile, plain cream background",
  "side profile, neutral expression, plain cream background",
];
export const MIN_GEMINI_CALL_GAP_MS = 6000;
// Template tagged with "default" in aesthetic_intent is the fallback when
// originally-chosen template fails. Contract: there must be exactly one such
// template (validated in planBook).
export const FALLBACK_TAG = "default";

// Page-render failure taxonomy used by the Section-B escalation layer:
//   "B" = detected region too small, "C" = no readable font fits — deterministic
//         layout failures (skip the same-template retry).
//   "F" = FATAL availability/billing (Item D2 fatal-stop, 2026-06-10): a Gemini
//         quota/billing 429 ("RESOURCE_EXHAUSTED") or a 300s wall-ceiling. Retrying
//         the same page or escalating to the fallback template just burns more
//         guaranteed-to-fail calls, so the page fails immediately and the loop
//         aborts the remaining pages. Match strings verified against REAL captured
//         errors: the D-H escalations.log billing body ("...RESOURCE_EXHAUSTED...")
//         and WallCeilingError.toJSON().kind === "wall_ceiling_exceeded".
//         Env-gated: D2_FATAL_STOP=off → never returns "F" (byte-for-byte pre-fix).
//   "A" = everything else — genuine transient; retry once + escalate to fallback.
export function classifyFailure(result) {
  const err = result?.error || "";
  if (err.includes("detected region too small")) return "B";
  if (err.includes("no readable font size fits")) return "C";
  if (process.env.D2_FATAL_STOP !== "off") {
    const se = result?.structuredError;
    const fatal =
      se?.kind === "wall_ceiling_exceeded" ||
      err.includes("RESOURCE_EXHAUSTED") ||
      se?.status === 429 ||
      se?.last_error?.status === 429;
    if (fatal) return "F";
  }
  return "A";
}

/** Pause execution for `ms` milliseconds. */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- Prompt-assembly helpers (verbatim) ------------------------------------

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

// Secondary-character shirt-colour lock (Spec D-R, 2026-06-08). B.8's render
// outfit-lock works, but human SECONDARIES drift colour because nothing upstream
// pins one (Sonnet's outfit prose is colourless and the model under-honours a
// secondary's reference sheet vs the protagonist's). Fix: pin a deterministic
// shirt colour per human secondary and inject it into the masked Appearance text
// — so it appears in the (re-minted) sheet AND in the Appearance line the
// existing buildWardrobeLock already enforces (no new render directive). The
// injected colour also changes the fingerprint, which forces the re-mint.
// Env-gated SHIRT_COLOUR_LOCK=off for the A/B baseline. Protagonist untouched.
const SECONDARY_SHIRT_PALETTE = ["denim blue", "burgundy", "mustard", "forest teal"];
function secondaryShirtColour(subject) {
  if (process.env.SHIRT_COLOUR_LOCK === "off") return null;
  if (!subject || subject.isProtagonist || subject.subject_type !== "human") return null;
  const m = /companion-(\d+)/.exec(subject.id || "");
  const idx = m ? parseInt(m[1], 10) - 1 : 0;
  const len = SECONDARY_SHIRT_PALETTE.length;
  return SECONDARY_SHIRT_PALETTE[((idx % len) + len) % len];
}
// Append the pinned colour to a (masked) description, gender-appropriate pronoun.
function injectShirtColour(description, subject) {
  const colour = secondaryShirtColour(subject);
  if (!colour) return description ?? "";
  const pronoun = subject.gender === "girl" ? "Her" : subject.gender === "non_binary" ? "Their" : "His";
  return `${description ?? ""} ${pronoun} t-shirt is a solid ${colour}.`;
}

// Bike-colour extraction (Spec D-B). The bike is an action-prose prop (no sheet),
// and story-gen already names its colour ("red bike"). Derive ONE canonical
// colour per book by counting "<colour> bike/bicycle" across the prose and taking
// the most frequent — the single source of truth the render-stage buildBikeLock
// restates on every page. Returns null if the book has no coloured bike.
const BIKE_COLOUR_RE = /\b(red|crimson|scarlet|maroon|blue|navy|teal|turquoise|green|olive|lime|yellow|gold|orange|purple|violet|pink|black|silver|grey|gray|white|brown)\s+(bike|bicycle)\b/gi;
function extractBikeColour(story) {
  const corpus = [story?.cover_concept || "", ...((story?.scenes) || []).map((s) => `${s.action || ""} ${s.narrative_text || ""}`)].join(" ");
  const counts = {};
  for (const m of corpus.matchAll(BIKE_COLOUR_RE)) {
    const c = m[1].toLowerCase();
    counts[c] = (counts[c] || 0) + 1;
  }
  let best = null, bestN = 0;
  for (const [c, n] of Object.entries(counts)) if (n > bestN) { best = c; bestN = n; }
  return best;
}

// Sheet-gen prompt for ONE subject (protagonist OR a secondary). Gender signal
// rides inside the masked appearance block (F-approach), not as a separate
// marker.
function buildSubjectSheetBasePrompt(subject, story) {
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
function buildSubjectListForSheetGen(story, meta, protagonistName, protagonistAge) {
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
  for (const c of companions) {
    const ms = metaSecs.find((s) => s.name === c.name);
    if (!ms) {
      // Caller's logger handles this warning; planBook is pure, so we skip
      // silently here and let generateBook's loop surface dropped subjects.
      continue;
    }
    const anchor = ms.anchor === "tier1" ? "tier1" : "tier2";
    if (anchor === "tier1") {
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
      // Spec D-R: pin the secondary's shirt colour into the description so it
      // flows to the fingerprint (forces re-mint), the sheet-mint Appearance,
      // and the render Appearance (via subj.character_description below).
      character_description: injectShirtColour(c.character_description, {
        id: ms.id, subject_type: ms.subject_type, isProtagonist: false, gender: isHuman ? ms.gender : null,
      }),
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

// The mint-time Appearance: block uses maskName(character_description, name)
// for both protagonist and secondaries. Mirror that here so the fingerprint
// changes when the description prose changes (not just when name does).
function buildAppearanceForFingerprint(subject) {
  return maskName(subject.character_description ?? "", subject.name ?? "");
}

// Sheets-to-mint count per reuse state.
function sheetsToMintForSubject(subject, subjectReuseInfo) {
  const info = subjectReuseInfo.get(subject.id);
  if (info.state === SheetState.COLD_START
      || info.state === SheetState.MISMATCH_REMINT
      || info.state === SheetState.LEGACY_PARTIAL) {
    return subject.viewCount;
  }
  if (info.state === SheetState.PARTIAL_RESUME) {
    return info.missingViewIndices.length;
  }
  return 0;
}

// ---- planBook --------------------------------------------------------------

/**
 * Validate inputs and compute the sheet-reuse plan + cost/template estimates.
 * Pure (no I/O beyond reading existing sheet files on disk via resolveSheetState
 * for reuse detection). Throws on any validation failure that the CLI used to
 * handle with process.exit.
 *
 * @returns {{
 *   subjectList: object[],
 *   subjectReuseInfo: Map<string, object>,
 *   totalSheetsNeeded: number,
 *   sheetsToMintCount: number,
 *   templateCounts: Record<string, number>,
 *   fallbackTemplate: object,
 *   costs: { sheetsCost, scenesCost, baseCost, worstEscalationCost },
 * }}
 */
export function planBook({ story, meta, childName, childAge, sheetsDir, registry }) {
  // ---- Validate story.json shape ----
  if (!Array.isArray(story.scenes) || story.scenes.length !== 12) {
    throw new Error(
      `story.json scenes must be an array of exactly 12 (got: ` +
      `${Array.isArray(story.scenes) ? story.scenes.length : "non-array"}).`
    );
  }

  // ---- Fallback template ----
  const fallbackTemplate = registry.find(
    (t) => t.selection_metadata.aesthetic_intent.includes(FALLBACK_TAG)
  );
  if (!fallbackTemplate) {
    throw new Error(
      `no template tagged "${FALLBACK_TAG}" in aesthetic_intent. ` +
      `Cannot escalate failures. Tag one template as the fallback.`
    );
  }

  // ---- Validate layout_intents ----
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
    const err = new Error(
      `story.json validation errors:\n  ${validationErrors.join("\n  ")}\n` +
      `This story.json was likely generated under the v1 system prompt ` +
      `(pre-Stream-3 of 2026-05-19) and cannot be used by the multi-template pipeline as-is.`
    );
    err.validationErrors = validationErrors;
    throw err;
  }

  // ---- Subject list + per-subject reuse state ----
  const subjectList = buildSubjectListForSheetGen(story, meta, childName, childAge);
  const totalSheetsNeeded = subjectList.reduce((sum, s) => sum + s.viewCount, 0);

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
  const sheetsToMintCount = subjectList.reduce(
    (sum, s) => sum + sheetsToMintForSubject(s, subjectReuseInfo),
    0,
  );

  // ---- Template distribution + cost estimate ----
  const templateCounts = {};
  for (const scene of story.scenes) {
    const tid = scene.layout_intent.template_id;
    templateCounts[tid] = (templateCounts[tid] || 0) + 1;
  }
  const sheetsCost = sheetsToMintCount * GEMINI_IMAGE_USD_PER_CALL;
  const scenesCost = story.scenes.length * GEMINI_IMAGE_USD_PER_CALL;
  const baseCost = sheetsCost + scenesCost;
  const worstEscalationCost = story.scenes.length * GEMINI_IMAGE_USD_PER_CALL * 2;

  return {
    subjectList,
    subjectReuseInfo,
    totalSheetsNeeded,
    sheetsToMintCount,
    templateCounts,
    fallbackTemplate,
    costs: { sheetsCost, scenesCost, baseCost, worstEscalationCost },
  };
}

// ---- generateBook ----------------------------------------------------------

/**
 * Run Sections A (sheet mint), B (per-scene render + escalation), C (merge).
 *
 * @param {object} opts
 * @param {object}   opts.story                 parsed story.json
 * @param {object}   opts.meta                  parsed meta.json (for gender + secondaries)
 * @param {string}   opts.childName
 * @param {number}   opts.childAge
 * @param {string}   opts.outputDir             book dir; character-sheets/, pages/,
 *                                              book.pdf, escalations.log land here
 * @param {object[]} [opts.registry]            template registry; loaded if omitted
 * @param {(scene)=>string|null} [opts.resolveImageOverride]  TEST-ONLY SEAM.
 *   Production callers MUST pass null (the default). This exists solely to
 *   replay existing rendered images in tests/verification without hitting
 *   Gemini: return an on-disk PNG path for a scene to reuse it as that page's
 *   image; return null to generate via Gemini as normal. See
 *   scripts/verify-book-extraction.mjs.
 * @param {boolean}  [opts.sheetsOnly=false]    mint sheets then return (no render)
 * @param {(payload)=>void} [opts.emitStatus]   status-event sink (CLI wires to status.json)
 * @param {(event)=>void}   [opts.onSlowCall]   slow-call sink threaded to generateImage
 * @param {Console}  [opts.logger=console]      progress logging sink
 * @returns {Promise<object>} result incl. bookPdfBytes, summary, counts, perPageResults
 */
export async function generateBook({
  story,
  meta,
  childName,
  childAge,
  outputDir,
  registry,
  resolveImageOverride = null,
  sheetsOnly = false,
  emitStatus,
  onSlowCall,
  logger = console,
}) {
  const log = logger;
  const emit = typeof emitStatus === "function" ? emitStatus : () => {};
  registry = registry ?? (await loadTemplateRegistry());

  const sheetsDir = path.join(outputDir, "character-sheets");
  const pagesDir = path.join(outputDir, "pages");
  const bookPdfPath = path.join(outputDir, "book.pdf");
  const escalationsLogPath = path.join(outputDir, "escalations.log");
  fs.mkdirSync(sheetsDir, { recursive: true });
  fs.mkdirSync(pagesDir, { recursive: true });

  const displayPath = (abs) => path.relative(outputDir, abs).replace(/\\/g, "/");

  const plan = planBook({ story, meta, childName, childAge, sheetsDir, registry });
  const {
    subjectList,
    subjectReuseInfo,
    totalSheetsNeeded,
    sheetsToMintCount,
    templateCounts,
    fallbackTemplate,
  } = plan;

  // Legacy protagonist-only flag kept for the single-protagonist degenerate
  // case (Section B sheet-reuse path + step numbering). Subsumed by
  // subjectReuseInfo but harmless.
  const sheetFiles = ["sheet-01.png", "sheet-02.png", "sheet-03.png"];
  const sheetsExist = sheetFiles.every((f) => fs.existsSync(path.join(sheetsDir, f)));

  const tBookStart = Date.now();

  // =====================================================================
  // Section A — character sheets
  // =====================================================================
  let sheetBuffers = [];
  let sheetsActualCost = 0;
  let sheetsCompletedCount = totalSheetsNeeded - sheetsToMintCount;
  const sheetResults = [];
  const subjectSheetStatus = {};

  log.log();
  if (sheetsToMintCount === 0) {
    log.log(`Step 1/3: Reusing all ${totalSheetsNeeded} character sheets already on disk across ${subjectList.length} subject${subjectList.length === 1 ? "" : "s"}.`);
  } else {
    log.log(`Step 1/3: Generating ${sheetsToMintCount} character sheet${sheetsToMintCount === 1 ? "" : "s"} across ${subjectList.length} subject${subjectList.length === 1 ? "" : "s"}${sheetsToMintCount < totalSheetsNeeded ? ` (${totalSheetsNeeded - sheetsToMintCount} already on disk — reusing)` : ""}...`);
  }
  emit({
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

    // ---- Skip-only branches (states FULL_SKIP / LEGACY_SKIP / VIEW_EXCESS) --
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
        log.log(`  ↻ ${subject.name} [${subjectTag}, ${subject.viewCount} view${subject.viewCount === 1 ? "" : "s"}]: reusing ${sheetLabel} (LEGACY: no meta fingerprint — cannot verify markers).`);
      } else if (reuse.state === SheetState.VIEW_EXCESS) {
        log.log(`  ↻ ${subject.name} [${subjectTag}, ${subject.viewCount} view${subject.viewCount === 1 ? "" : "s"}]: reusing ${sheetLabel} (${reuse.excessFiles.length} excess sheet${reuse.excessFiles.length === 1 ? "" : "s"} on disk ignored).`);
      } else {
        log.log(`  ↻ ${subject.name} [${subjectTag}, ${subject.viewCount} view${subject.viewCount === 1 ? "" : "s"}]: reusing ${sheetLabel} (skipping mint, fingerprint match).`);
      }
      const reuseBufs = expectedFilenames.map((f) => fs.readFileSync(path.join(sheetsDir, f)));
      if (subject.isProtagonist) {
        sheetBuffers = reuseBufs;
      }
      subjectSheetStatus[subject.id] = { sheetFiles: [...expectedFilenames], skipped: false };
      emit({
        event: {
          kind: eventKind,
          subject: subject.name,
          sheets_reused: expectedFilenames.length,
          excess_ignored: reuse.excessFiles.length,
        },
      });
      for (let v = 0; v < expectedFilenames.length; v++) {
        emit({
          event: { kind: "sheet_mint_skipped", subject: subject.name, view: v + 1, reason: skipReason },
        });
      }
      continue;
    }

    // ---- Mint branches (COLD_START / PARTIAL_RESUME / MISMATCH_REMINT / LEGACY_PARTIAL) --
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
    log.log(`  ${subject.name} [${subjectTag}, ${subject.viewCount} view${subject.viewCount === 1 ? "" : "s"}]:${headerSuffix}`);
    emit({
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
      log.warn(`  ⚠ ${subject.name}: marker fingerprint mismatch (was ${reuse.existingMeta?.marker_fingerprint?.slice(0, 8)}…, now ${reuse.fingerprint.slice(0, 8)}…) — overwriting existing sheets + meta.`);
      try {
        const previousMetaSnapshotPath = snapshotPreviousMeta(sheetsDir, subject.id, reuse.existingMeta);
        emit({
          event: {
            kind: "sheet_meta_previous_snapshotted",
            subject: subject.name,
            snapshot_path: path.relative(outputDir, previousMetaSnapshotPath).replace(/\\/g, "/"),
            previous_fingerprint: reuse.existingMeta?.marker_fingerprint ?? null,
          },
        });
      } catch (snapErr) {
        log.warn(`  ⚠ Failed to snapshot previous meta: ${snapErr.message}`);
      }
    }
    const basePrompt = buildSubjectSheetBasePrompt(subject, story);
    const subjectSucceededFiles = [];
    const subjectBufs = [];
    for (let i = 0; i < subject.viewCount; i++) {
      const sheetNum = String(i + 1).padStart(2, "0");
      const filename = `${subject.sheetPathPrefix}-${sheetNum}.png`;
      const filePath = path.join(sheetsDir, filename);

      // Reuse path (PARTIAL_RESUME only): view already on disk, fingerprint matches.
      if (!indicesToMint.includes(i)) {
        const buf = fs.readFileSync(filePath);
        subjectBufs.push(buf);
        subjectSucceededFiles.push(filename);
        emit({
          event: { kind: "sheet_mint_skipped", subject: subject.name, view: i + 1, reason: "reused_partial_resume" },
        });
        continue;
      }
      // Mint this view.
      const viewPrompt = CHARACTER_SHEET_PROMPTS[i];
      const fullPrompt = `${basePrompt}\n\nView for this image: ${viewPrompt}.`;
      const t0 = Date.now();
      emit({
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
        log.log(`    → [${callIdx}/${sheetsToMintCount}] ${filename}  (${(ms / 1000).toFixed(1)}s)`);
        sheetsCompletedCount += 1;
        emit({
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
        log.error(`    ✗ [${callIdx}/${sheetsToMintCount}] ${filename}: ${err?.message ?? err}`);
        const errorPayload = err instanceof WallCeilingError
          ? err.toJSON()
          : { kind: "sheet_mint_error", message: String(err?.message ?? err).slice(0, 300) };
        emit({
          event: { kind: "sheet_mint_failed", subject: subject.name, view: i + 1, duration_ms: ms, error: errorPayload },
        });
        if (callIdx < sheetsToMintCount && ms < MIN_GEMINI_CALL_GAP_MS) {
          await sleep(MIN_GEMINI_CALL_GAP_MS - ms);
        }
      }
    }
    // Per-subject failure handling:
    //  - Protagonist: < 2 of 3 → THROW (no protagonist = no book).
    //  - Secondary: < required count → mark skipped, continue (graceful degrade).
    if (subject.isProtagonist) {
      if (subjectBufs.length < 2) {
        emit({
          event: {
            kind: "protagonist_sheets_insufficient",
            subject: subject.name,
            succeeded: subjectBufs.length,
            required: 2,
            attempted: subject.viewCount,
          },
        });
        const err = new Error(
          `only ${subjectBufs.length} of ${subject.viewCount} protagonist sheets succeeded. ` +
          `Need ≥2 references for scene rendering. Halting.`
        );
        err.kind = "protagonist_sheets_insufficient";
        err.detail = { subject_name: subject.name, succeeded: subjectBufs.length, required: 2, attempted: subject.viewCount };
        throw err;
      }
      if (subjectBufs.length < subject.viewCount) {
        log.log(
          `  ⚠ ${subject.viewCount - subjectBufs.length} of ${subject.viewCount} protagonist sheets failed — continuing with ${subjectBufs.length}.`
        );
      }
      sheetBuffers = subjectBufs;
      subjectSheetStatus[subject.id] = { sheetFiles: subjectSucceededFiles, skipped: false };
    } else {
      if (subjectBufs.length < subject.viewCount) {
        log.warn();
        log.warn(
          `  ⚠ SECONDARY "${subject.name}" sheet-gen INCOMPLETE: ${subjectBufs.length} of ${subject.viewCount} succeeded. ` +
          `Marking this secondary as SKIPPED for the render layer; book continues with protagonist + any remaining secondaries.`
        );
        subjectSheetStatus[subject.id] = { sheetFiles: subjectSucceededFiles, skipped: true };
        emit({
          event: { kind: "sheet_mint_skipped", subject: subject.name, view: null, reason: "degraded", succeeded: subjectBufs.length, required: subject.viewCount },
        });
      } else {
        subjectSheetStatus[subject.id] = { sheetFiles: subjectSucceededFiles, skipped: false };
      }
    }

    // Write/update per-subject sheet metadata after a successful mint pass.
    if (subjectSheetStatus[subject.id]?.skipped === false && subjectBufs.length > 0) {
      const presentViews = subjectSucceededFiles.map((filename) => {
        const m = filename.match(/-(\d+)\.png$/);
        return { view_index: m ? parseInt(m[1], 10) : null, filename };
      });
      const metaWritePath = writeSheetMeta(sheetsDir, subject.id, buildSheetMeta({
        subjectName: subject.name,
        subjectType: subject.subject_type,
        gender: subject.gender,
        appearanceDescription: buildAppearanceForFingerprint(subject),
        markers: subject.markers ?? "",
        fingerprint: reuse.fingerprint,
        sheetPathPrefix: subject.sheetPathPrefix,
        presentViews,
        lockedShirtColour: secondaryShirtColour(subject), // Spec D-R (null for protagonist/non-human)
        mintedAt: reuse.state === SheetState.PARTIAL_RESUME
          ? reuse.existingMeta?.minted_at
          : undefined,
        mintedForBook: path.basename(outputDir),
      }));
      emit({
        event: { kind: "sheet_meta_written", subject: subject.name, meta_path: path.relative(outputDir, metaWritePath).replace(/\\/g, "/") },
      });
    }
  }

  // ---- sheets-only short-circuit ----
  if (sheetsOnly) {
    const succeeded = sheetResults.filter((r) => r.status === "succeeded").length;
    return {
      sheetsOnly: true,
      bookPdfBytes: null,
      bookPdfPath: null,
      subjectList,
      subjectSheetStatus,
      sheetResults,
      sheetsActualCost,
      sheetsGenerated: succeeded,
      sheetsToMintCount,
      totalSheetsNeeded,
      durationMs: Date.now() - tBookStart,
    };
  }

  // =====================================================================
  // Section B — per-scene render with escalation
  // =====================================================================
  log.log();
  log.log(`Step ${sheetsExist ? "1" : "2"}/${sheetsExist ? "2" : "3"}: Rendering ${story.scenes.length} pages...`);

  // ---- Subject metadata for the per-scene allocator ----
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
      allSheets: sheetBuffers,
      mintedSheetCount: sheetBuffers.length,
      skipped: protagonistStatus?.skipped === true,
    };
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
        // subj.character_description carries the Spec D-R colour injection.
        description: maskName(subj.character_description, c.name),
        subjectType: subj.subject_type,
        isProtagonist: false,
        allSheets: sheets,
        mintedSheetCount: sheets.length,
        skipped: status?.skipped === true,
      };
    }
  }

  function resolveSceneSubjects(scene) {
    const present = Array.isArray(scene.subjects_present) ? scene.subjects_present : [];
    const usable = [];
    const dropped = [];
    for (const name of present) {
      const m = subjectMetaByName[name];
      if (!m) {
        throw new Error(
          `Scene ${scene.page}: subjects_present contains unknown name "${name}" ` +
          `(not protagonist or in story.companion_characters[]). ` +
          `Valid names: [${Object.keys(subjectMetaByName).join(", ")}].`,
        );
      }
      if (m.skipped || m.mintedSheetCount === 0) {
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

  // Spec D-B: derive the book's canonical bike colour once; the render restates
  // it on every page (conditionally) so it can't drift on pages whose prose omits it.
  const bikeColour = process.env.BIKE_COLOUR_LOCK === "off" ? null : extractBikeColour(story);
  // Spec D-H: the helmet colour IS the bike colour (not extracted from prose — the
  // prose has no consensus helmet colour). Conditional COLOUR lock only; presence
  // is governed by the scene, not this directive.
  const helmetColour = process.env.HELMET_COLOUR_LOCK === "off" ? null : bikeColour;

  async function tryRender(scene, templateId) {
    const template = findTemplate(registry, templateId);
    const { subjects, dropped } = resolveSceneSubjects(scene);
    for (const d of dropped) {
      log.log(`    ⚠ Page ${scene.page}: dropping subject "${d.name}" — ${d.reason}.`);
    }
    const imagePathOverride = resolveImageOverride ? resolveImageOverride(scene) : null;
    return await renderPageWithTemplate({
      templateConfigPath: template.configPath,
      scene: { page: scene.page, action: scene.action },
      narrativeText: scene.narrative_text,
      subjects,
      sceneStyle: story.style,
      sceneNegativePrompt: story.negative_prompt,
      outputDir: pagesDir,
      imagePathOverride,
      callContext: { callKind: "page_render", pageNumber: scene.page, onSlowCall },
      bikeColour,
      helmetColour,
    });
  }

  const perPageResults = [];
  let totalScenesCost = 0;
  let pagesCompletedCount = 0;
  const escalationEntries = [];

  emit({
    currentState: "page_render",
    currentStep: { kind: "page_render", detail: `0 / ${story.scenes.length}`, started_at: new Date().toISOString() },
  });

  for (let i = 0; i < story.scenes.length; i++) {
    const scene = story.scenes[i];
    const originalTemplateId = scene.layout_intent.template_id;
    const iterStart = Date.now();

    log.log(`  Page ${String(scene.page).padStart(2)}/${story.scenes.length}: ${originalTemplateId}...`);
    emit({
      event: { kind: "page_render_start", page: scene.page, template: originalTemplateId },
      currentStep: { kind: "page_render", detail: `page ${scene.page} (${originalTemplateId})`, started_at: new Date().toISOString() },
    });

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
      log.log(`    ⚠ ${failureType}-class failure: ${result.error}`);

      if (failureType === "A") {
        log.log(`    Retrying with same template...`);
        emit({
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

      if (!result.success && failureType !== "F" && originalTemplateId !== fallbackTemplate.id) {
        log.log(`    Escalating to fallback: ${fallbackTemplate.id}`);
        emit({
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
      log.log(`    → ${outcome} (template: ${finalTemplate}, fontSize: ${fontSize}pt, ${(totalMs / 1000).toFixed(1)}s)`);
      pagesCompletedCount += 1;
      emit({
        event: { kind: "page_render_complete", page: scene.page, template: finalTemplate, duration_ms: totalMs, fontSize, outcome },
        progressDelta: { pages_completed: pagesCompletedCount },
      });
    } else {
      log.log(`    ✗ FAILED — both original and fallback templates failed`);
      const errorPayload = result.structuredError
        ? { kind: "all_attempts_failed", last_error_kind: result.structuredError.kind, last_error: result.structuredError }
        : { kind: "all_attempts_failed", last_error: result.error };
      emit({
        event: { kind: "page_render_failed", page: scene.page, error: errorPayload },
      });
    }

    // Item D2 fatal-stop (2026-06-10): a fatal billing-429 / wall-ceiling failure
    // means every remaining page fails the same way — abort instead of burning up
    // to 300s/page on a doomed book. Remaining scenes are recorded as failed so
    // counts.failed + the merge stay correct. classifyFailure is env-gated, so when
    // D2_FATAL_STOP=off it never returns "F" and this never triggers (pre-fix path).
    if (outcome === "failed" && classifyFailure(result) === "F") {
      for (let j = i + 1; j < story.scenes.length; j++) {
        perPageResults.push({
          page: story.scenes[j].page,
          originalTemplate: story.scenes[j].layout_intent.template_id,
          finalTemplate: null,
          outcome: "failed",
          pdfPath: null,
        });
      }
      log.log(`    ⛔ fatal failure — aborting ${story.scenes.length - 1 - i} remaining page(s).`);
      break;
    }

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

  // =====================================================================
  // Section C — merge per-page PDFs into book.pdf
  // =====================================================================
  log.log();
  log.log(`Step ${sheetsExist ? "2" : "3"}/${sheetsExist ? "2" : "3"}: Merging per-page PDFs into book.pdf...`);
  emit({
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
  emit({
    event: { kind: "book_merge_complete", pdf_path: displayPath(bookPdfPath), size_bytes: bookSize },
  });

  // ---- Summary ----
  const totalMs = Date.now() - tBookStart;
  const counts = {
    success: perPageResults.filter((r) => r.outcome === "success").length,
    success_after_retry: perPageResults.filter((r) => r.outcome === "success_after_retry").length,
    escalated: perPageResults.filter((r) => r.outcome === "escalated").length,
    failed: perPageResults.filter((r) => r.outcome === "failed").length,
  };
  const totalCost = sheetsActualCost + totalScenesCost;
  const totalCalls = Math.round((sheetsActualCost + totalScenesCost) / GEMINI_IMAGE_USD_PER_CALL);

  log.log();
  log.log("=".repeat(70));
  log.log("Book generation complete.");
  log.log("=".repeat(70));
  log.log(`  Pages:               ${counts.success} success / ${counts.success_after_retry} after-retry / ${counts.escalated} escalated / ${counts.failed} failed`);
  log.log(`  Total Gemini calls:  ${totalCalls}`);
  log.log(`  Actual cost:         $${totalCost.toFixed(4)} USD`);
  log.log(`  Duration:            ${(totalMs / 1000).toFixed(1)}s`);
  log.log(`  Output PDF:          ${displayPath(bookPdfPath)} (${(bookSize / 1024).toFixed(1)} KB)`);
  if (escalationEntries.length > 0) {
    log.log(`  Escalations:         ${displayPath(escalationsLogPath)} (${escalationEntries.length} entries)`);
  }
  log.log();

  // The bookGeneration summary object — the CLI shim writes this into meta.json;
  // the Track B worker returns it as generationMetadata.
  const summary = {
    completed_at: new Date().toISOString(),
    duration_seconds: Number((totalMs / 1000).toFixed(2)),
    sheets_reused: sheetsExist,
    sheets_generated: sheetResults.filter((r) => r.status === "succeeded").length,
    pages: counts,
    template_distribution: templateCounts,
    escalation_entries: escalationEntries.length,
    total_cost_usd: Number(totalCost.toFixed(4)),
    total_gemini_calls: totalCalls,
    locked_bike_colour: bikeColour ?? null, // Spec D-B: canonical bike colour (audit)
    locked_helmet_colour: helmetColour ?? null, // Spec D-H: helmet colour = bike colour (audit)
  };

  return {
    sheetsOnly: false,
    bookPdfBytes: mergedBytes,
    bookPdfPath,
    bookSize,
    perPageResults,
    escalationEntries,
    escalationsLogPath,
    counts,
    totalCost,
    totalCalls,
    summary,
    durationMs: totalMs,
    subjectSheetStatus,
    sheetResults,
    sheetsExist,
  };
}
