// scripts/test-wall-ceiling.js
// No-API-cost unit tests for src/wall-ceiling.js's callWithRetry runner.
// Covers the three scenarios from the Item 1b spec:
//   1. fn() resolves quickly — no slow_call, no ceiling, returns value
//   2. fn() takes longer than slowWarnMs but resolves before wallCeilingMs —
//      slow_call fires exactly once via callback, fn() resolves successfully
//   3. fn() hangs (never resolves) — WallCeilingError fires at wallCeilingMs
//      with all structured fields populated, no timer leak
//
// Uses callContext overrides (wallCeilingMs, slowWarnMs) so tests run in
// milliseconds instead of the 5-minute production ceiling.

import { callWithRetry, WallCeilingError } from "../src/wall-ceiling.js";

function assert(condition, message) {
  if (!condition) {
    console.error(`FAIL: ${message}`);
    process.exit(1);
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

console.log();
console.log("=".repeat(72));
console.log("wall-ceiling unit test (no API cost)");
console.log("=".repeat(72));

// ---- Test 1: fast resolve ----
console.log();
console.log("Test 1 — fn() resolves quickly under both timers");
{
  const events = [];
  const onSlowCall = (e) => events.push(e);
  const t0 = Date.now();
  const result = await callWithRetry(
    async () => { await delay(20); return "fast-result"; },
    { callKind: "test", onSlowCall, wallCeilingMs: 500, slowWarnMs: 200 },
  );
  const elapsed = Date.now() - t0;
  assert(result === "fast-result", `expected "fast-result", got ${JSON.stringify(result)}`);
  assert(events.length === 0, `expected 0 slow_call events, got ${events.length}: ${JSON.stringify(events)}`);
  assert(elapsed < 200, `expected elapsed < 200ms, got ${elapsed}ms`);
  console.log(`  PASS (resolved "${result}" in ${elapsed}ms, 0 slow_call events)`);
}

// ---- Test 2: slow resolve (between slowWarnMs and wallCeilingMs) ----
console.log();
console.log("Test 2 — fn() takes longer than slowWarnMs but resolves before ceiling");
{
  const events = [];
  const onSlowCall = (e) => events.push(e);
  const t0 = Date.now();
  const result = await callWithRetry(
    async () => { await delay(250); return "slow-result"; },
    {
      callKind: "test", subjectName: "TestSubj", view: 2,
      onSlowCall, wallCeilingMs: 1000, slowWarnMs: 100,
    },
  );
  const elapsed = Date.now() - t0;
  assert(result === "slow-result", `expected "slow-result", got ${JSON.stringify(result)}`);
  const slowCallEvents = events.filter((e) => e.kind === "slow_call");
  assert(slowCallEvents.length === 1, `expected exactly 1 slow_call event, got ${slowCallEvents.length}`);
  const slowEvent = slowCallEvents[0];
  assert(slowEvent.call_kind === "test", `slow_call.call_kind: ${slowEvent.call_kind}`);
  assert(slowEvent.subject_name === "TestSubj", `slow_call.subject_name: ${slowEvent.subject_name}`);
  assert(slowEvent.view === 2, `slow_call.view: ${slowEvent.view}`);
  assert(slowEvent.elapsed_ms >= 100, `slow_call.elapsed_ms should be >= slowWarnMs (100), got ${slowEvent.elapsed_ms}`);
  assert(slowEvent.attempt_count >= 1, `slow_call.attempt_count: ${slowEvent.attempt_count}`);
  assert(elapsed >= 250 && elapsed < 1000, `expected elapsed between 250 and 1000ms, got ${elapsed}ms`);
  console.log(`  PASS (resolved "${result}" in ${elapsed}ms, 1 slow_call event at ${slowEvent.elapsed_ms}ms)`);
}

// ---- Test 3: hung call → WallCeilingError ----
console.log();
console.log("Test 3 — fn() never resolves: WallCeilingError fires at wallCeilingMs");
{
  const events = [];
  const onSlowCall = (e) => events.push(e);
  let caught = null;
  const t0 = Date.now();
  try {
    await callWithRetry(
      () => new Promise(() => { /* never resolves */ }),
      {
        callKind: "page_render", pageNumber: 7,
        onSlowCall, wallCeilingMs: 200, slowWarnMs: 80,
      },
    );
  } catch (err) {
    caught = err;
  }
  const elapsed = Date.now() - t0;
  assert(caught !== null, "expected WallCeilingError to be thrown");
  assert(caught instanceof WallCeilingError, `expected WallCeilingError, got ${caught?.constructor?.name}: ${caught?.message}`);
  assert(caught.call_kind === "page_render", `error.call_kind: ${caught.call_kind}`);
  assert(caught.subject_name === null, `error.subject_name: ${caught.subject_name}`);
  assert(caught.view === null, `error.view: ${caught.view}`);
  assert(caught.page_number === 7, `error.page_number: ${caught.page_number}`);
  assert(caught.attempt_count === 1, `error.attempt_count: ${caught.attempt_count}`);
  assert(Array.isArray(caught.retry_history) && caught.retry_history.length === 0, `error.retry_history should be empty array`);
  assert(caught.last_error === null, `error.last_error should be null (no error happened), got ${JSON.stringify(caught.last_error)}`);
  assert(caught.elapsed_ms >= 200, `error.elapsed_ms should be >= ceiling, got ${caught.elapsed_ms}`);
  assert(elapsed >= 200 && elapsed < 400, `expected elapsed between 200-400ms (ceiling fires around 200), got ${elapsed}ms`);
  // Also verify slow_call event fired during the hang
  const slowCallEvents = events.filter((e) => e.kind === "slow_call");
  assert(slowCallEvents.length === 1, `expected 1 slow_call event during hang, got ${slowCallEvents.length}`);
  // toJSON should serialize cleanly for status.json
  const serialized = caught.toJSON();
  assert(serialized.kind === "wall_ceiling_exceeded", "toJSON kind discriminator");
  assert(typeof serialized.message === "string" && serialized.message.length > 0, "toJSON message");
  console.log(`  PASS (WallCeilingError fired at ${caught.elapsed_ms}ms, all structured fields populated, 1 slow_call event)`);
}

// ---- Test 4: bonus — successful return clears timers (no zombie soft-warn) ----
console.log();
console.log("Test 4 — bonus: successful fast return doesn't fire a delayed slow_warn");
{
  const events = [];
  const onSlowCall = (e) => events.push(e);
  const result = await callWithRetry(
    async () => { await delay(30); return "ok"; },
    { callKind: "test", onSlowCall, wallCeilingMs: 1000, slowWarnMs: 100 },
  );
  assert(result === "ok", `result: ${result}`);
  // Wait past the slowWarnMs threshold to confirm the timer was cleared
  // (if it weren't, slow_warn would fire here after the call returned).
  await delay(150);
  const slowCallEvents = events.filter((e) => e.kind === "slow_call");
  assert(slowCallEvents.length === 0, `expected 0 slow_call events after successful return, got ${slowCallEvents.length}`);
  console.log(`  PASS (no zombie slow_warn after fast successful return)`);
}

// ---- Test 5 (Item 5 D3) — retry-exhaustion attaches retry_history ----
console.log();
console.log("Test 5 (Item 5 D3) — non-ceiling retry exhaustion bubbles err with retry_history attached");
{
  const events = [];
  const onSlowCall = (e) => events.push(e);
  // Classifier: return retryable for any error, with 2 backoffs (so 3 total
  // attempts allowed, 2 retries).
  const stubClassify = () => ({ reason: "503 stub", backoffs: [5, 5] });
  // fn that always throws (simulating a 503 that keeps coming back).
  let attempts = 0;
  const failingFn = async () => {
    attempts += 1;
    const err = new Error(`503 stub error attempt ${attempts}`);
    err.status = 503;
    throw err;
  };

  let caught = null;
  try {
    await callWithRetry(failingFn, {
      callKind: "test",
      onSlowCall,
      wallCeilingMs: 60_000,
      slowWarnMs: 50_000,
    }, stubClassify);
  } catch (err) {
    caught = err;
  }
  assert(caught !== null, "expected an error after retry exhaustion");
  assert(!(caught instanceof WallCeilingError), `not a WallCeilingError (classifier exhausted): ${caught?.constructor?.name}`);
  assert(Array.isArray(caught.retry_history), `retry_history should be attached as array, got ${typeof caught.retry_history}`);
  assert(caught.retry_history.length === 2, `should have 2 retry entries (3 attempts - 1), got ${caught.retry_history.length}`);
  assert(caught.retry_history[0].attempt_n === 1, `first retry attempt_n: ${caught.retry_history[0].attempt_n}`);
  assert(caught.retry_history[0].error_kind === "503 stub", `first retry error_kind`);
  assert(caught.retry_history[0].wait_ms_before_next === 5, `first retry wait_ms`);
  assert(caught.retry_history[1].attempt_n === 2, `second retry attempt_n`);
  assert(attempts === 3, `should have made 3 attempts total, got ${attempts}`);
  console.log(`  PASS (retry_history attached with ${caught.retry_history.length} entries; ${attempts} attempts)`);
}

// ---- Test 6 (Item 5 D2) — WallCeilingError has toJSON() (boundary preservation) ----
console.log();
console.log("Test 6 (Item 5 D2) — WallCeilingError.toJSON() round-trips structured fields");
{
  // Direct test that the structured payload survives JSON serialization
  // (this is the pattern src/page-pipeline.js D2 uses to preserve the error
  // across the renderPageWithTemplate boundary).
  let caught = null;
  try {
    await callWithRetry(
      () => new Promise(() => { /* never resolves */ }),
      { callKind: "page_render", pageNumber: 5, wallCeilingMs: 100, slowWarnMs: 50 },
    );
  } catch (err) {
    caught = err;
  }
  assert(caught instanceof WallCeilingError, "expected WallCeilingError");
  assert(typeof caught.toJSON === "function", "toJSON exists");
  const serialized = caught.toJSON();
  // Round-trip through stringify + parse
  const reParsed = JSON.parse(JSON.stringify(serialized));
  assert(reParsed.kind === "wall_ceiling_exceeded", "kind preserved");
  assert(reParsed.call_kind === "page_render", "call_kind preserved");
  assert(reParsed.page_number === 5, "page_number preserved");
  assert(typeof reParsed.elapsed_ms === "number", "elapsed_ms numeric");
  console.log(`  PASS (structured payload survives JSON round-trip — D2 boundary preservation works)`);
}

console.log();
console.log("=".repeat(72));
console.log("All wall-ceiling tests passed.");
console.log("=".repeat(72));
console.log();
