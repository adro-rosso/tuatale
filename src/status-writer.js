// src/status-writer.js
// status.json emitter for generate-story.js and generate-book.js. Writes an
// observability sidecar in the job's output directory so external orchestrators
// (the eventual website) can poll progress without inspecting the pipeline's
// raw stdout.
//
// Pre-launch defect cleanup Item 1 (2026-05-31).
//
// ----------------------------------------------------------------------------
// EVENT SCHEMA — single source of truth for what the pipeline emits.
// ----------------------------------------------------------------------------
//
// All events share { ts: ISO-8601 string, kind: string }. Per-kind payloads:
//
//   { kind: "job_start", input_summary?: {...} }
//   { kind: "story_gen_start", protagonist?: string, secondaries_count?: number }
//   { kind: "story_gen_complete", duration_ms: number, tokens: { in, out } }
//   { kind: "story_gen_failed", error: {...} }
//   { kind: "sheet_mint_start", subject: string, view: number }
//   { kind: "sheet_mint_complete", subject: string, view: number, duration_ms: number }
//   { kind: "sheet_mint_skipped", subject: string, view: number, reason: "reused"|"degraded" }
//   { kind: "sheet_mint_failed", subject: string, view: number, error: {...} }
//   { kind: "page_render_start", page: number, template: string }
//   { kind: "page_render_complete", page: number, template: string, duration_ms: number, fontSize?: number }
//   { kind: "page_render_retry", page: number, attempt: number, error_kind: string }
//   { kind: "page_render_escalated", page: number, from_template: string, to_template: string }
//   { kind: "page_render_failed", page: number, error: {...} }
//   { kind: "slow_call", call_kind, subject_name, view, page_number, elapsed_ms, attempt_count, last_error }
//   { kind: "retry", call_kind, subject_name, view, page_number, attempt_n, wait_ms, error_kind }
//   { kind: "book_merge_start" }
//   { kind: "book_merge_complete", pdf_path: string, size_bytes: number }
//   { kind: "job_terminate", state: "completed"|"failed"|"aborted", error?: {...} }
//
// Summary fields (top-level on status.json):
//   - current_state: enum string — "starting" | "story_gen" | "sheet_mint" |
//     "page_render" | "book_merge" | "completed" | "failed" | "aborted"
//   - current_step: { kind, detail, started_at } | null — fine-grained current activity
//   - progress: { sheets_total, sheets_completed, pages_total, pages_completed }
//   - terminal_state: null until finalizeStatus, then { state, error, finished_at }
//
// Writes are atomic via .tmp + fsync + rename, so external readers see either
// the pre-write or post-write state, never partial. The events array grows
// unbounded — that's fine for a 12-page book (<100 events typical) but is the
// reason this file lives sidecar to the job, not in a shared log.
// ----------------------------------------------------------------------------

import fs from "node:fs";
import path from "node:path";

const STATUS_FILE = "status.json";
const RUNS_MANIFEST_FILE = "runs-manifest.json";

/**
 * Initialize a status.json in outputDir.
 *
 * Item 5 F2 (2026-06-01): if a prior status.json exists, archive it to
 * status-run-<N>.json and append an entry to runs-manifest.json so the
 * forensic reader can trace chained scenarios across runs. The new
 * status.json then starts fresh.
 *
 * Archive flow:
 *   1. If status.json exists: read it, determine next run number from the
 *      manifest, rename status.json → status-run-<N>.json, append manifest
 *      entry (atomic .tmp + rename for the manifest).
 *   2. Write the new status.json fresh.
 *
 * @param {string} outputDir Job output dir; must exist before calling.
 * @param {object} [initial]
 * @param {string} [initial.currentState="starting"] Initial pipeline state.
 * @param {object} [initial.progress] Optional progress totals to pre-populate.
 * @param {object} [initial.jobStartPayload] Optional payload merged into the
 *   initial job_start event (e.g. input_summary).
 * @returns {object} The status object as written.
 */
export function createStatusFile(outputDir, initial = {}) {
  // Archive any existing status.json before overwriting.
  rotatePriorStatusIfPresent(outputDir);

  const now = new Date().toISOString();
  const status = {
    job_id: path.basename(outputDir),
    started_at: now,
    current_state: initial.currentState ?? "starting",
    last_updated_at: now,
    current_step: null,
    progress: {
      sheets_total: 0,
      sheets_completed: 0,
      pages_total: 0,
      pages_completed: 0,
      ...(initial.progress ?? {}),
    },
    events: [
      { ts: now, kind: "job_start", ...(initial.jobStartPayload ?? {}) },
    ],
    terminal_state: null,
  };
  writeAtomic(outputDir, status);
  return status;
}

/**
 * If status.json exists at outputDir, archive it to status-run-<N>.json and
 * record an entry in runs-manifest.json. No-op if no prior status.json.
 *
 * The run number is determined from runs-manifest.json (if present) or
 * defaults to 1. Atomic rename preserves the archived contents.
 */
function rotatePriorStatusIfPresent(outputDir) {
  const statusPath = path.join(outputDir, STATUS_FILE);
  if (!fs.existsSync(statusPath)) return;

  // Read prior status to capture its terminal_state (or "unknown" for
  // mid-flight crashes where finalize never fired).
  let priorStatus = null;
  try {
    priorStatus = JSON.parse(fs.readFileSync(statusPath, "utf8"));
  } catch {
    // Malformed status.json — archive it anyway so the forensic reader can
    // inspect it raw, but record terminal_state as "unreadable".
    priorStatus = null;
  }

  // Read the manifest to determine the next run number.
  const manifestPath = path.join(outputDir, RUNS_MANIFEST_FILE);
  let manifest = { runs: [] };
  if (fs.existsSync(manifestPath)) {
    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
      if (!Array.isArray(manifest?.runs)) manifest = { runs: [] };
    } catch {
      manifest = { runs: [] };
    }
  }
  const nextRunN = manifest.runs.length + 1;

  // Rename status.json → status-run-<N>.json (atomic).
  const archivedFilename = `status-run-${nextRunN}.json`;
  const archivedPath = path.join(outputDir, archivedFilename);
  fs.renameSync(statusPath, archivedPath);

  // Append manifest entry.
  const terminalState = priorStatus === null
    ? "unreadable"
    : (priorStatus.terminal_state?.state ?? "unknown");
  manifest.runs.push({
    run_n: nextRunN,
    started_at: priorStatus?.started_at ?? null,
    terminal_state: terminalState,
    archived_filename: archivedFilename,
  });
  writeAtomicJson(outputDir, RUNS_MANIFEST_FILE, manifest);
}

/**
 * Append an event + apply summary updates to status.json.
 *
 * @param {string} outputDir
 * @param {object} update
 * @param {object} update.event Event object (kind + payload). ts is auto-stamped.
 * @param {string} [update.currentState] If provided, replaces current_state.
 * @param {object|null} [update.currentStep] If provided, replaces current_step.
 *   Pass null to clear current_step (e.g. between steps).
 * @param {object} [update.progressDelta] Shallow-merged into status.progress.
 *   Use this to advance completion counters: { sheets_completed: N }.
 * @returns {object} The status object as written.
 */
export function updateStatus(outputDir, { event, currentState, currentStep, progressDelta } = {}) {
  const status = readStatus(outputDir);
  const now = new Date().toISOString();
  status.last_updated_at = now;
  if (currentState !== undefined) status.current_state = currentState;
  if (currentStep !== undefined) status.current_step = currentStep;
  if (progressDelta) {
    for (const [k, v] of Object.entries(progressDelta)) {
      status.progress[k] = v;
    }
  }
  if (event) status.events.push({ ts: now, ...event });
  writeAtomic(outputDir, status);
  return status;
}

/**
 * Write the terminal state. After this, the job is sealed — subsequent
 * updateStatus calls would still work but signal a programming error.
 *
 * @param {string} outputDir
 * @param {object} terminal
 * @param {"completed"|"failed"|"aborted"} terminal.state
 * @param {object} [terminal.error] Structured error (e.g. WallCeilingError.toJSON()
 *   for sheet/page failures, or a hand-built object for other failures).
 * @returns {object} The status object as written.
 */
export function finalizeStatus(outputDir, terminal) {
  if (!terminal?.state || !["completed", "failed", "aborted"].includes(terminal.state)) {
    throw new Error(`finalizeStatus: terminal.state must be "completed" | "failed" | "aborted"; got ${JSON.stringify(terminal?.state)}`);
  }
  const status = readStatus(outputDir);
  const now = new Date().toISOString();
  status.last_updated_at = now;
  status.current_state = terminal.state;
  status.current_step = null;
  status.terminal_state = {
    state: terminal.state,
    error: terminal.error ?? null,
    finished_at: now,
  };
  status.events.push({
    ts: now,
    kind: "job_terminate",
    state: terminal.state,
    ...(terminal.error ? { error: terminal.error } : {}),
  });
  writeAtomic(outputDir, status);
  return status;
}

// ---- Item 5 D4 + D5: process-level abort handlers --------------------------
// One module-level state slot tracking the current job's outputDir. Scripts
// call registerAbortHandlers(outputDir) after createStatusFile succeeds. If
// uncaughtException / unhandledRejection / SIGINT fire, we finalize the
// status.json as "aborted" with a structured error before exiting.
//
// Multiple registerAbortHandlers calls UPDATE the current outputDir but
// don't double-register the process listeners (that would leak event
// listeners and double-fire handlers).
let _abortOutputDir = null;
let _abortHandlersRegistered = false;

export function registerAbortHandlers(outputDir) {
  _abortOutputDir = outputDir;
  if (_abortHandlersRegistered) return;
  _abortHandlersRegistered = true;

  const finalizeAsAborted = (errorKind, message, stack) => {
    if (!_abortOutputDir) return;
    try {
      finalizeStatus(_abortOutputDir, {
        state: "aborted",
        error: { kind: errorKind, message, stack: stack ?? null },
      });
    } catch { /* swallow — already crashing */ }
  };

  process.on("uncaughtException", (err) => {
    finalizeAsAborted("uncaught_exception", err?.message ?? String(err), err?.stack ?? null);
    console.error(err?.stack ?? err);
    process.exit(1);
  });
  process.on("unhandledRejection", (reason) => {
    finalizeAsAborted("unhandled_rejection", reason?.message ?? String(reason), reason?.stack ?? null);
    console.error(reason);
    process.exit(1);
  });
  process.on("SIGINT", () => {
    finalizeAsAborted("sigint", "Job interrupted by user (SIGINT)", null);
    console.error("\nInterrupted (SIGINT). Status finalized as aborted.");
    process.exit(130);
  });
}

/**
 * Test helper — clears module state so individual tests don't leak handlers
 * across runs. Not exported for production use.
 */
export function _resetAbortHandlersForTesting() {
  _abortOutputDir = null;
  _abortHandlersRegistered = false;
  process.removeAllListeners("uncaughtException");
  process.removeAllListeners("unhandledRejection");
  process.removeAllListeners("SIGINT");
}

/**
 * Read current status from disk. Useful for tests + sanity checks; the
 * normal pipeline path uses createStatusFile/updateStatus/finalizeStatus.
 */
export function readStatus(outputDir) {
  const p = path.join(outputDir, STATUS_FILE);
  if (!fs.existsSync(p)) {
    throw new Error(`status.json not found at ${p}. Call createStatusFile first.`);
  }
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

/**
 * Atomic write: serialize to .tmp, fsync, rename over the target. The rename
 * is atomic on Unix and on modern Windows (Node uses MOVEFILE_REPLACE_EXISTING).
 * External readers see EITHER the pre-write file OR the post-write file —
 * never a partial write.
 *
 * status.json grows unbounded as events accumulate, so we serialize every
 * call; that's fine for a 12-page book (<100 events) but worth noting if
 * the schema ever expands to longer-running jobs.
 */
function writeAtomic(outputDir, data) {
  writeAtomicJson(outputDir, STATUS_FILE, data);
}

/**
 * Generalized atomic JSON write — used for status.json and runs-manifest.json.
 */
function writeAtomicJson(outputDir, filename, data) {
  const tmpPath = path.join(outputDir, `${filename}.tmp`);
  const finalPath = path.join(outputDir, filename);
  const content = JSON.stringify(data, null, 2);
  const fd = fs.openSync(tmpPath, "w");
  try {
    fs.writeSync(fd, content);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmpPath, finalPath);
}
