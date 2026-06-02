// src/sheet-meta.js
// Per-subject sheet metadata + fingerprint + state-machine resolver for the
// sheet-mint reuse path in scripts/generate-book.js.
//
// Pre-launch defect cleanup Item 3 (2026-06-01). Replaces the implicit
// detect-and-skip logic from Step 2.5 with five explicit states + a marker-
// fingerprint check so customer regen / partial-failure-resume / marker-edit
// scenarios behave predictably.
//
// State legend (matches generate-book.js status.json event kinds):
//   COLD_START      (B) — no sheets, no meta → mint all
//   FULL_SKIP       (A) — all expected sheets present + fingerprint matches → skip
//   LEGACY_SKIP     (A-Legacy) — sheets present, ALL expected views on disk,
//                     but no meta file (pre-Item-3 books) → skip with a
//                     warning event; we can't verify markers, so reuse is on
//                     filename match only
//   LEGACY_PARTIAL  (Item 5 F1, 2026-06-01) — partial sheets present + no
//                     meta. Typical cause: prior run crashed mid-mint before
//                     meta-write (Item 3 only writes meta after a successful
//                     subject loop). Pre-F1 the code routed this to
//                     LEGACY_SKIP and crashed downstream when reading missing
//                     sheets. Now: treat as recovery — full re-mint of all
//                     views, overwriting the partial leftovers.
//   PARTIAL_RESUME  (C) — some expected sheets present + fingerprint matches →
//                     mint only the missing view indices, reuse the rest
//   VIEW_EXCESS     (D) — all expected present + extra sheets on disk →
//                     use only the first N (info log, no re-mint)
//   MISMATCH_REMINT (E) — sheets present + fingerprint MISMATCH → warn loudly +
//                     full re-mint (overwrite both sheets and meta); customer
//                     gets correct kid, change is logged but doesn't block

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export const META_SUFFIX = "-meta.json";

// Upper bound when scanning for excess views beyond expectedViewCount. The
// pipeline never mints more than 3 views per subject by design (protagonist=3,
// human secondary=2, non_human=1), but a future redesign or a manually-dropped
// extra file could leave more on disk. 10 is generous defense-in-depth.
const MAX_VIEW_INDEX = 10;

/**
 * Stable string identifying the subject's identity at mint time. Inputs are
 * normalized (lowercase, whitespace collapsed) so trivial whitespace edits
 * don't trigger false mismatches; material content changes (different markers,
 * different gender, different appearance prose) produce different fingerprints.
 *
 * SHA-256 truncated to 16 hex chars — 64 bits is plenty for the collision
 * surface (a single book has ≤4 subjects; we just need stability across
 * runs of the same input).
 *
 * @param {object} opts
 * @param {string} opts.subjectName
 * @param {string} opts.subjectType  "human" | "non_human"
 * @param {string|null} opts.gender  "boy" | "girl" | "non_binary" | null
 * @param {string} opts.appearanceDescription  The masked-name description used
 *   in the sheet-mint Appearance: block.
 * @param {string} opts.markers  The semicolon-separated markers string.
 * @returns {string} 16-char hex fingerprint.
 */
export function computeMarkerFingerprint({ subjectName, subjectType, gender, appearanceDescription, markers }) {
  const parts = [
    normalize(subjectName),
    normalize(subjectType),
    normalize(gender),
    normalize(appearanceDescription),
    normalize(markers),
  ];
  const input = parts.join("|");
  return crypto.createHash("sha256").update(input).digest("hex").slice(0, 16);
}

function normalize(s) {
  if (s == null) return "";
  return String(s).toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Read the per-subject metadata file, if present.
 *
 * @param {string} sheetsDir
 * @param {string} subjectId  "protagonist" | "companion-1" | ...
 * @returns {object|null} The parsed meta object, or null if absent or malformed.
 */
export function readSheetMeta(sheetsDir, subjectId) {
  const metaPath = path.join(sheetsDir, `${subjectId}${META_SUFFIX}`);
  if (!fs.existsSync(metaPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(metaPath, "utf8"));
  } catch {
    return null;
  }
}

/**
 * Atomic write of the per-subject metadata file. Uses the same .tmp + fsync +
 * rename pattern as src/status-writer.js and the Item 2 max-tokens capture.
 *
 * @param {string} sheetsDir
 * @param {string} subjectId
 * @param {object} meta  Full meta object (see schema below).
 * @returns {string} Absolute path of the written meta file.
 */
export function writeSheetMeta(sheetsDir, subjectId, meta) {
  fs.mkdirSync(sheetsDir, { recursive: true });
  const metaPath = path.join(sheetsDir, `${subjectId}${META_SUFFIX}`);
  const tmpPath = `${metaPath}.tmp`;
  const content = JSON.stringify(meta, null, 2);
  const fd = fs.openSync(tmpPath, "w");
  try {
    fs.writeSync(fd, content);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmpPath, metaPath);
  return metaPath;
}

/**
 * Build the meta object for writeSheetMeta. Pulled out so the same shape is
 * used by both initial mint and partial-resume (which preserves minted_at
 * from the existing meta).
 */
export function buildSheetMeta({
  subjectName,
  subjectType,
  gender,
  appearanceDescription,
  markers,
  fingerprint,
  sheetPathPrefix,
  presentViews,        // [{ view_index, filename }, ...] — all views now present
  mintedAt,            // ISO; preserved from existing meta on partial resume
  mintedForBook,
}) {
  return {
    subject_name: subjectName,
    subject_type: subjectType,
    gender: gender ?? null,
    marker_fingerprint: fingerprint,
    appearance_description_normalized: normalize(appearanceDescription),
    markers_normalized: normalize(markers),
    sheet_path_prefix: sheetPathPrefix,
    minted_at: mintedAt ?? new Date().toISOString(),
    minted_for_book: mintedForBook,
    views: presentViews,
  };
}

/**
 * Snapshot the previous meta to <subject-id>-meta.previous.json before a
 * MISMATCH_REMINT overwrites the live meta. If a snapshot already exists from
 * an earlier remint, rotate it to <subject-id>-meta.previous.N.json so the
 * customer-dispute trail is preserved.
 *
 * Item 5 F4 (2026-06-01).
 *
 * @param {string} sheetsDir
 * @param {string} subjectId
 * @param {object} priorMeta The about-to-be-overwritten meta object.
 * @returns {string} Absolute path of the snapshot.
 */
export function snapshotPreviousMeta(sheetsDir, subjectId, priorMeta) {
  fs.mkdirSync(sheetsDir, { recursive: true });
  const snapshotName = `${subjectId}-meta.previous.json`;
  const snapshotPath = path.join(sheetsDir, snapshotName);

  // If a snapshot already exists, rotate it to a numbered archive first.
  if (fs.existsSync(snapshotPath)) {
    let n = 1;
    while (fs.existsSync(path.join(sheetsDir, `${subjectId}-meta.previous.${n}.json`))) {
      n += 1;
    }
    fs.renameSync(snapshotPath, path.join(sheetsDir, `${subjectId}-meta.previous.${n}.json`));
  }

  // Write the new snapshot atomically.
  const tmpPath = `${snapshotPath}.tmp`;
  const content = JSON.stringify(priorMeta, null, 2);
  const fd = fs.openSync(tmpPath, "w");
  try {
    fs.writeSync(fd, content);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmpPath, snapshotPath);
  return snapshotPath;
}

export const SheetState = Object.freeze({
  COLD_START: "cold_start",
  FULL_SKIP: "full_skip",
  LEGACY_SKIP: "legacy_skip",
  LEGACY_PARTIAL: "legacy_partial",
  PARTIAL_RESUME: "partial_resume",
  VIEW_EXCESS: "view_excess",
  MISMATCH_REMINT: "mismatch_remint",
});

/**
 * Resolve the per-subject reuse state by inspecting on-disk sheets +
 * metadata against the current input fingerprint.
 *
 * @param {object} opts
 * @param {string} opts.subjectId  "protagonist" | "companion-1" | ...
 * @param {string} opts.sheetPathPrefix  "sheet" | "companion-1" | ...
 *   (the filename prefix; sheets are named ${prefix}-NN.png)
 * @param {number} opts.expectedViewCount  Per the subject's design (3 for
 *   protagonist, 2 for human secondary, 1 for non-human secondary).
 * @param {string} opts.currentFingerprint  Computed from the CURRENT input.
 * @param {string} opts.sheetsDir
 *
 * @returns {object} Resolution result:
 *   {
 *     state: <SheetState value>,
 *     presentFiles: string[],         // expected view files actually on disk
 *     missingViewIndices: number[],   // 1-based view indices missing from
 *                                     //   the expected set
 *     excessFiles: string[],          // files with view indices > expectedViewCount
 *     existingMeta: object | null,
 *     fingerprintMatch: boolean | null,  // null if no meta exists
 *   }
 */
export function resolveSheetState({ subjectId, sheetPathPrefix, expectedViewCount, currentFingerprint, sheetsDir }) {
  const presentFiles = [];
  const missingViewIndices = [];
  for (let i = 1; i <= expectedViewCount; i++) {
    const filename = `${sheetPathPrefix}-${String(i).padStart(2, "0")}.png`;
    const filePath = path.join(sheetsDir, filename);
    if (fs.existsSync(filePath) && fs.statSync(filePath).size > 0) {
      presentFiles.push(filename);
    } else {
      missingViewIndices.push(i);
    }
  }

  // Scan for excess views (view indices beyond expectedViewCount) — these
  // are sheets that exist on disk but the current design doesn't ask for.
  // We stop at the first gap to avoid pathological wide scans.
  const excessFiles = [];
  for (let i = expectedViewCount + 1; i <= MAX_VIEW_INDEX; i++) {
    const filename = `${sheetPathPrefix}-${String(i).padStart(2, "0")}.png`;
    const filePath = path.join(sheetsDir, filename);
    if (fs.existsSync(filePath) && fs.statSync(filePath).size > 0) {
      excessFiles.push(filename);
    } else {
      break;
    }
  }

  const existingMeta = readSheetMeta(sheetsDir, subjectId);
  const result = (state, fingerprintMatch) => ({
    state, presentFiles, missingViewIndices, excessFiles, existingMeta, fingerprintMatch,
  });

  // State B — nothing on disk → cold mint.
  if (presentFiles.length === 0 && excessFiles.length === 0) {
    return result(SheetState.COLD_START, null);
  }

  // Some sheets present. Check for metadata.
  if (existingMeta == null) {
    // Distinguish two no-meta cases:
    //   All expected views present → LEGACY_SKIP (genuine pre-Item-3 book)
    //   Some expected views missing → LEGACY_PARTIAL (Item 5 F1 — recovery
    //     from an interrupted prior run that crashed before meta-write)
    if (missingViewIndices.length > 0) {
      return result(SheetState.LEGACY_PARTIAL, null);
    }
    return result(SheetState.LEGACY_SKIP, null);
  }

  // Fingerprint check.
  const fingerprintMatch = existingMeta.marker_fingerprint === currentFingerprint;
  if (!fingerprintMatch) {
    return result(SheetState.MISMATCH_REMINT, false);
  }

  // Fingerprint matches. Distinguish A / C / D by counts.
  // Check missing first — partial resume takes precedence over view excess
  // (if both partial AND excess somehow occurred together).
  if (missingViewIndices.length > 0) {
    return result(SheetState.PARTIAL_RESUME, true);
  }
  if (excessFiles.length > 0) {
    return result(SheetState.VIEW_EXCESS, true);
  }
  return result(SheetState.FULL_SKIP, true);
}
