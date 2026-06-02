// scripts/test-status-writer.js
// No-API-cost unit test for src/status-writer.js. Covers initialization,
// event append + summary updates, terminal states, atomicity (no lingering
// .tmp files, JSON always parseable), and a smoke check for rapid
// interleaved read/write.

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createStatusFile, updateStatus, finalizeStatus, readStatus } from "../src/status-writer.js";

function assert(condition, message) {
  if (!condition) {
    console.error(`FAIL: ${message}`);
    process.exit(1);
  }
}
function assertThrows(fn, partialMessage, testName) {
  let caught = null;
  try { fn(); } catch (err) { caught = err; }
  assert(caught !== null, `${testName}: expected to throw, did not`);
  assert(
    caught.message.includes(partialMessage),
    `${testName}: expected error to include "${partialMessage}", got "${caught.message}"`,
  );
}
function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "daboo-status-test-"));
}
function readRaw(dir) {
  return JSON.parse(fs.readFileSync(path.join(dir, "status.json"), "utf8"));
}

console.log();
console.log("=".repeat(72));
console.log("status-writer unit test (no API cost)");
console.log("=".repeat(72));

// ---- Test 1: createStatusFile initializes ----
console.log();
console.log("Test 1 — createStatusFile initializes with expected shape");
{
  const dir = tempDir();
  const status = createStatusFile(dir, {
    currentState: "starting",
    progress: { sheets_total: 5, pages_total: 12 },
    jobStartPayload: { input_summary: { protagonist: "Iris", age: 5 } },
  });
  assert(fs.existsSync(path.join(dir, "status.json")), "status.json not on disk");
  const parsed = readRaw(dir);
  assert(parsed.job_id === path.basename(dir), `job_id mismatch: ${parsed.job_id}`);
  assert(parsed.current_state === "starting", `current_state: ${parsed.current_state}`);
  assert(parsed.terminal_state === null, "terminal_state should be null initially");
  assert(parsed.progress.sheets_total === 5, "progress.sheets_total not set");
  assert(parsed.progress.pages_total === 12, "progress.pages_total not set");
  assert(parsed.progress.sheets_completed === 0, "progress.sheets_completed default");
  assert(parsed.progress.pages_completed === 0, "progress.pages_completed default");
  assert(parsed.events.length === 1, `expected 1 init event, got ${parsed.events.length}`);
  assert(parsed.events[0].kind === "job_start", `init event kind: ${parsed.events[0].kind}`);
  assert(parsed.events[0].input_summary?.protagonist === "Iris", "jobStartPayload not merged");
  assert(status.events.length === 1, "returned status should match written");
  console.log("  PASS (init shape + jobStartPayload merge)");
}

// ---- Test 2: updateStatus appends events + updates summary ----
console.log();
console.log("Test 2 — updateStatus appends events + applies summary updates");
{
  const dir = tempDir();
  createStatusFile(dir, { progress: { sheets_total: 3, pages_total: 12 } });
  updateStatus(dir, {
    event: { kind: "story_gen_start", protagonist: "Søren" },
    currentState: "story_gen",
  });
  updateStatus(dir, {
    event: { kind: "story_gen_complete", duration_ms: 240_000, tokens: { in: 5000, out: 8000 } },
  });
  updateStatus(dir, {
    event: { kind: "sheet_mint_start", subject: "Søren", view: 1 },
    currentState: "sheet_mint",
    currentStep: { kind: "sheet_mint", detail: "Søren view 1", started_at: new Date().toISOString() },
  });
  updateStatus(dir, {
    event: { kind: "sheet_mint_complete", subject: "Søren", view: 1, duration_ms: 23_000 },
    progressDelta: { sheets_completed: 1 },
  });
  const parsed = readRaw(dir);
  assert(parsed.events.length === 5, `expected 5 events (init+4), got ${parsed.events.length}`);
  assert(parsed.current_state === "sheet_mint", `current_state: ${parsed.current_state}`);
  assert(parsed.current_step?.kind === "sheet_mint", "current_step not updated");
  assert(parsed.progress.sheets_completed === 1, `sheets_completed: ${parsed.progress.sheets_completed}`);
  // Each event should have a ts
  for (const e of parsed.events) {
    assert(typeof e.ts === "string", `event missing ts: ${JSON.stringify(e)}`);
    assert(typeof e.kind === "string", `event missing kind: ${JSON.stringify(e)}`);
  }
  console.log("  PASS (events appended; current_state + current_step + progressDelta applied)");
}

// ---- Test 3: atomicity — no .tmp lingers post-write ----
console.log();
console.log("Test 3 — atomicity: no .tmp files lingering after writes");
{
  const dir = tempDir();
  createStatusFile(dir, {});
  for (let i = 0; i < 10; i++) {
    updateStatus(dir, { event: { kind: `test_event_${i}` } });
  }
  const filesAfter = fs.readdirSync(dir);
  const tmpFiles = filesAfter.filter((f) => f.endsWith(".tmp"));
  assert(tmpFiles.length === 0, `lingering .tmp files: ${tmpFiles.join(", ")}`);
  assert(filesAfter.includes("status.json"), "status.json missing post-write");
  // status.json must always be valid JSON
  const parsed = readRaw(dir);
  assert(parsed.events.length === 11, `expected 11 events (init+10), got ${parsed.events.length}`);
  console.log("  PASS (no tmp lingering; status.json always valid JSON)");
}

// ---- Test 4: finalizeStatus(completed) ----
console.log();
console.log("Test 4 — finalizeStatus completed");
{
  const dir = tempDir();
  createStatusFile(dir, {});
  finalizeStatus(dir, { state: "completed" });
  const parsed = readRaw(dir);
  assert(parsed.current_state === "completed", "current_state");
  assert(parsed.current_step === null, "current_step should be cleared on finalize");
  assert(parsed.terminal_state.state === "completed", "terminal_state.state");
  assert(parsed.terminal_state.error === null, "terminal_state.error should be null on success");
  assert(typeof parsed.terminal_state.finished_at === "string", "finished_at not stamped");
  const lastEvent = parsed.events[parsed.events.length - 1];
  assert(lastEvent.kind === "job_terminate", "last event should be job_terminate");
  assert(lastEvent.state === "completed", "last event state");
  console.log("  PASS");
}

// ---- Test 5: finalizeStatus(failed) with structured error ----
console.log();
console.log("Test 5 — finalizeStatus failed carries structured error");
{
  const dir = tempDir();
  createStatusFile(dir, {});
  const structuredErr = {
    kind: "wall_ceiling_exceeded",
    call_kind: "sheet_mint",
    subject_name: "Theo",
    view: 0,
    page_number: null,
    elapsed_ms: 300_000,
    attempt_count: 3,
    retry_history: [{ attempt_n: 1, error_kind: "503 from Google", wait_ms_before_next: 5000 }],
    last_error: { message: "504 timeout", status: 504, kind: "504 from Google" },
    message: "sheet_mint call Theo view 0 exceeded 300s wall ceiling",
  };
  finalizeStatus(dir, { state: "failed", error: structuredErr });
  const parsed = readRaw(dir);
  assert(parsed.current_state === "failed", "current_state");
  assert(parsed.terminal_state.error.call_kind === "sheet_mint", "error.call_kind preserved");
  assert(parsed.terminal_state.error.subject_name === "Theo", "error.subject_name preserved");
  assert(parsed.terminal_state.error.retry_history.length === 1, "retry_history preserved");
  const lastEvent = parsed.events[parsed.events.length - 1];
  assert(lastEvent.error?.call_kind === "sheet_mint", "terminal event carries error");
  console.log("  PASS");
}

// ---- Test 6: finalizeStatus(aborted) ----
console.log();
console.log("Test 6 — finalizeStatus aborted");
{
  const dir = tempDir();
  createStatusFile(dir, {});
  finalizeStatus(dir, { state: "aborted" });
  const parsed = readRaw(dir);
  assert(parsed.current_state === "aborted", "current_state");
  assert(parsed.terminal_state.state === "aborted", "terminal_state.state");
  console.log("  PASS");
}

// ---- Test 7: finalizeStatus rejects invalid terminal state ----
console.log();
console.log("Test 7 — finalizeStatus rejects bad terminal state");
{
  const dir = tempDir();
  createStatusFile(dir, {});
  assertThrows(() => finalizeStatus(dir, { state: "halfway" }), "must be", "bad terminal");
  console.log("  PASS");
}

// ---- Test 8: rapid interleaved read/write smoke check ----
console.log();
console.log("Test 8 — rapid read/write loop never sees partial JSON");
{
  const dir = tempDir();
  createStatusFile(dir, {});
  for (let i = 0; i < 100; i++) {
    updateStatus(dir, { event: { kind: `loop_${i}` } });
    const parsed = readRaw(dir);
    assert(parsed.events.length === i + 2, `iter ${i}: events=${parsed.events.length}`);
    assert(typeof parsed.current_state === "string", `iter ${i}: missing current_state`);
  }
  console.log("  PASS (100 read+write cycles, all reads valid JSON)");
}

// ---- Test 9: readStatus on missing file throws cleanly ----
console.log();
console.log("Test 9 — readStatus on missing dir throws cleanly");
{
  const dir = tempDir();
  // dir exists but status.json doesn't
  assertThrows(() => readStatus(dir), "status.json not found", "missing status");
  console.log("  PASS");
}

// ---- Test 10 (Item 5 F2) — archive prior status.json on re-run ----
console.log();
console.log("Test 10 (Item 5 F2) — sequential createStatusFile archives prior runs");
{
  const dir = tempDir();
  // Run 1: create + finalize completed
  createStatusFile(dir, { progress: { sheets_total: 3 } });
  updateStatus(dir, { event: { kind: "story_gen_complete", duration_ms: 1000 } });
  finalizeStatus(dir, { state: "completed" });
  // Run 2: create + finalize failed
  createStatusFile(dir, { progress: { sheets_total: 3 } });
  finalizeStatus(dir, { state: "failed", error: { kind: "test_failure" } });
  // Run 3: create — should archive run 2; then leave current as-is
  createStatusFile(dir, { progress: { sheets_total: 3 } });
  // Now we expect on disk:
  //   status-run-1.json (completed)
  //   status-run-2.json (failed)
  //   status.json (current, run 3, not yet finalized)
  //   runs-manifest.json (2 entries)
  const files = fs.readdirSync(dir).sort();
  assert(files.includes("status-run-1.json"), `missing status-run-1.json (got: ${files.join(", ")})`);
  assert(files.includes("status-run-2.json"), `missing status-run-2.json`);
  assert(files.includes("status.json"), `missing current status.json`);
  assert(files.includes("runs-manifest.json"), `missing runs-manifest.json`);
  // Verify run-1 archived content
  const run1 = JSON.parse(fs.readFileSync(path.join(dir, "status-run-1.json"), "utf8"));
  assert(run1.terminal_state?.state === "completed", `archived run 1 terminal: ${run1.terminal_state?.state}`);
  // Verify run-2 archived content
  const run2 = JSON.parse(fs.readFileSync(path.join(dir, "status-run-2.json"), "utf8"));
  assert(run2.terminal_state?.state === "failed", `archived run 2 terminal: ${run2.terminal_state?.state}`);
  assert(run2.terminal_state?.error?.kind === "test_failure", `run 2 error preserved`);
  // Verify manifest
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, "runs-manifest.json"), "utf8"));
  assert(manifest.runs.length === 2, `manifest runs count: ${manifest.runs.length}`);
  assert(manifest.runs[0].run_n === 1 && manifest.runs[0].terminal_state === "completed", `manifest run 1`);
  assert(manifest.runs[1].run_n === 2 && manifest.runs[1].terminal_state === "failed", `manifest run 2`);
  assert(manifest.runs[0].archived_filename === "status-run-1.json", `archive filename run 1`);
  assert(manifest.runs[1].archived_filename === "status-run-2.json", `archive filename run 2`);
  // Verify current status.json is fresh (not archived run 2 content)
  const current = JSON.parse(fs.readFileSync(path.join(dir, "status.json"), "utf8"));
  assert(current.terminal_state === null, `current run 3 should not be finalized`);
  assert(current.events.length === 1, `current run 3 should have only job_start event`);
  console.log("  PASS (3 runs → 2 archives + 1 current + manifest with 2 entries)");
}

// ---- Test 11 (Item 5 F2) — archive crashed-mid-flight run as "unknown" ----
console.log();
console.log("Test 11 (Item 5 F2) — mid-flight prior status (no terminal_state) archives as 'unknown'");
{
  const dir = tempDir();
  // Run 1: create but DON'T finalize (simulates crash mid-run)
  createStatusFile(dir, {});
  updateStatus(dir, { event: { kind: "sheet_mint_start", subject: "Iris", view: 1 } });
  // No finalize — terminal_state is null
  // Run 2: create — should archive run 1 with terminal_state "unknown"
  createStatusFile(dir, {});
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, "runs-manifest.json"), "utf8"));
  assert(manifest.runs.length === 1, `manifest count: ${manifest.runs.length}`);
  assert(manifest.runs[0].terminal_state === "unknown", `mid-flight archive terminal: ${manifest.runs[0].terminal_state}`);
  console.log("  PASS (mid-flight crash recorded as 'unknown' in manifest)");
}

// ---- Test 12 (Item 5 F2) — no archive on first createStatusFile (no prior) ----
console.log();
console.log("Test 12 (Item 5 F2) — first createStatusFile creates no archive");
{
  const dir = tempDir();
  createStatusFile(dir, {});
  const files = fs.readdirSync(dir);
  assert(files.includes("status.json"), `status.json missing`);
  assert(!files.some((f) => f.startsWith("status-run-")), `unexpected archive: ${files.join(", ")}`);
  assert(!files.includes("runs-manifest.json"), `manifest should not exist before any archive`);
  console.log("  PASS");
}

console.log();
console.log("=".repeat(72));
console.log("All status-writer tests passed.");
console.log("=".repeat(72));
console.log();
