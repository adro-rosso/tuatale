// worker/src/chosen-sheet-inject.js — character-picker Slice 4.
//
// Inject each durably-copied CHOSEN view-0 as a LOCKED sheet (Slice 1) into the scratch
// character-sheets/ dir BEFORE generateBook, so resolveSheetState returns LOCKED and the
// book reuses the customer's picked view-0 (chaining views 2-3). The chosen PNG was copied
// to stable storage at order-creation (orders/<id>/chosen/<subjectId>.png).
//
// GUARANTEES:
//   - NO PICKS → NO-OP → generateBook is BYTE-IDENTICAL to today (COLD_START).
//   - DEGRADE (C): a durable PNG gone at gen time → SKIP that subject (normal mint) + it
//     is reported as `degraded` so the caller flags the operator. We deliberately DO NOT
//     write a locked meta for a missing PNG, so the Slice-1 LockedSheetMissingError stays a
//     should-never-happen corruption guard — never the normal degrade path. Never a
//     different-face swap: a locked meta ALWAYS has its view-0 (PNG written before meta).
import fs from "node:fs";
import path from "node:path";
import { getClient } from "./db.js";
import { BUCKET } from "./storage.js";

const SHEETS = "character-sheets";

// The protagonist's sheet files use the prefix "sheet" (sheet-01.png); a secondary uses
// its own id (companion-1-01.png). Mirrors buildSubjectListForSheetGen's sheetPathPrefix.
function prefixFor(subjectId) {
  return subjectId === "protagonist" ? "sheet" : subjectId;
}

/**
 * Collect the order's INJECTABLE picks: protagonist chosen_sheet + each secondary card's
 * chosen_sheet, keeping only those with a durable imagePath and NOT flagged degraded.
 */
export function collectPicks(order) {
  const picks = [];
  const p = order?.chosen_sheet;
  if (p && p.imagePath && !p.degraded) picks.push({ subjectId: "protagonist", imagePath: p.imagePath });
  const secs = Array.isArray(order?.secondaries) ? order.secondaries : [];
  for (const s of secs) {
    const c = s?.chosen_sheet;
    const id = s?.id || s?.secondary_id;
    if (c && c.imagePath && !c.degraded && id) picks.push({ subjectId: id, imagePath: c.imagePath });
  }
  return picks;
}

/** The minimal locked sheet-meta resolveSheetState needs (fingerprint EXEMPT under LOCKED). */
function lockedMeta(subjectId, prefix) {
  return {
    subject_name: subjectId,
    subject_type: null,
    gender: null,
    marker_fingerprint: "locked",
    sheet_path_prefix: prefix,
    minted_at: null,
    minted_for_book: null,
    locked_shirt_colour: null,
    views: [{ view_index: 1, filename: `${prefix}-01.png` }],
    locked: true,
  };
}

async function realDownload(imagePath) {
  const { data, error } = await getClient().storage.from(BUCKET).download(imagePath);
  if (error) throw new Error(`download ${imagePath}: ${error.message}`);
  return Buffer.from(await data.arrayBuffer());
}

/**
 * @returns {Promise<{ injected: string[], degraded: string[] }>} subjectIds by outcome.
 */
export async function injectChosenSheets(order, scratchDir, deps = {}) {
  const picks = collectPicks(order);
  const injected = [];
  const degraded = [];
  if (!picks.length) return { injected, degraded }; // NO-OP — byte-identical

  const download = deps.download ?? realDownload;
  const log = deps.log ?? console;
  const sheetsDir = path.join(scratchDir, SHEETS);
  fs.mkdirSync(sheetsDir, { recursive: true });

  for (const pick of picks) {
    let buf;
    try {
      buf = await download(pick.imagePath);
    } catch (e) {
      // C: durable PNG gone at gen time → degrade to a normal mint (never a stranger's face).
      degraded.push(pick.subjectId);
      log.warn?.(`  ⚠ chosen-sheet: durable PNG gone for ${pick.subjectId} (${pick.imagePath}) — degrading to normal mint: ${e.message}`);
      continue;
    }
    const prefix = prefixFor(pick.subjectId);
    // PNG FIRST, then meta — so a locked meta on disk ALWAYS has its view-0 (the Slice-1
    // invariant; a meta-without-PNG is the only thing that fires LockedSheetMissingError).
    fs.writeFileSync(path.join(sheetsDir, `${prefix}-01.png`), buf);
    fs.writeFileSync(path.join(sheetsDir, `${pick.subjectId}-meta.json`), JSON.stringify(lockedMeta(pick.subjectId, prefix)));
    injected.push(pick.subjectId);
    log.log?.(`  🔒 chosen-sheet LOCKED: ${pick.subjectId} ← ${pick.imagePath}`);
  }
  return { injected, degraded };
}
