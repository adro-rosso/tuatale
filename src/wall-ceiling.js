// src/wall-ceiling.js
// Wall-time governor for paid API calls. Shared between src/gemini.js (Gemini
// image calls) and src/anthropic.js (Sonnet story-gen calls). Both wrap their
// own callWithRetry around this module's primitives so a hung call can't burn
// arbitrary wall-time during retry chains.
//
// Pre-launch defect cleanup Item 1 (2026-05-31). Added because the Step 2.5
// mint observed 20+ min wall on a single sheet under sustained Google bad-
// night — the D2 retry classifier was firing correctly but the retry chain
// itself had no upper bound on total time.

// Soft-warn threshold: 60s elapsed on a single call (including retries) fires
// one console warning + one onSlowCall callback. Fires once per call, not per
// retry attempt — don't spam.
export const SLOW_WARN_MS = 60_000;

// Hard ceiling: 5 min total wall time per call, INCLUDING all retries +
// backoff sleeps + network setup. This is "how long has the caller been
// waiting." Exceeds the SDK timeout, so it only fires when retries are
// stacked or a single attempt is over the configured per-attempt timeout
// (5 min on Anthropic SDK, no SDK ceiling on Gemini).
export const WALL_CEILING_MS = 300_000;

/**
 * Structured error thrown when a paid API call's total wall time (including
 * retries + backoff sleeps) exceeds WALL_CEILING_MS.
 *
 * Includes enough context for the caller to log the failure to a book's
 * failure log and emit a status.json event without needing to inspect the
 * raw error chain.
 */
export class WallCeilingError extends Error {
  constructor({
    callKind,        // "sheet_mint" | "page_render" | "story_gen" | string
    subjectName,     // null | string — subject minted (sheet_mint) or main char (story_gen)
    view,            // null | number — sheet index (1-based) for sheet_mint
    pageNumber,      // null | number — scene page number for page_render
    elapsedMs,       // total wall time at the moment the ceiling fired
    attemptCount,    // total attempts made (1 = no retries, 2 = one retry, etc.)
    retryHistory,    // array of { attempt_n, error_kind, wait_ms_before_next }
    lastError,       // { message, status, kind } | null — most recent error caught
  }) {
    const subject = subjectName ? ` ${subjectName}` : "";
    const detail = view != null ? ` view ${view}` : pageNumber != null ? ` page ${pageNumber}` : "";
    super(
      `${callKind} call${subject}${detail} exceeded ${WALL_CEILING_MS / 1000}s wall ceiling ` +
      `(${Math.round(elapsedMs / 1000)}s, ${attemptCount} attempt${attemptCount === 1 ? "" : "s"})`
    );
    this.name = "WallCeilingError";
    this.call_kind = callKind;
    this.subject_name = subjectName ?? null;
    this.view = view ?? null;
    this.page_number = pageNumber ?? null;
    this.elapsed_ms = elapsedMs;
    this.attempt_count = attemptCount;
    this.retry_history = retryHistory;
    this.last_error = lastError;
  }

  /**
   * Serialize to a plain object suitable for status.json or a failure log.
   */
  toJSON() {
    return {
      kind: "wall_ceiling_exceeded",
      call_kind: this.call_kind,
      subject_name: this.subject_name,
      view: this.view,
      page_number: this.page_number,
      elapsed_ms: this.elapsed_ms,
      attempt_count: this.attempt_count,
      retry_history: this.retry_history,
      last_error: this.last_error,
      message: this.message,
    };
  }
}

/**
 * Format a one-line soft-warn message for the console.
 * Matches the format the user expects: "Call X taking longer than expected
 * — currently 75s into attempt 2 of 3, last error: 503 from Google."
 */
export function formatSlowWarn({ callKind, subjectName, view, pageNumber, elapsedMs, attemptN, maxAttempts, lastErrorReason }) {
  const subject = subjectName ? ` ${subjectName}` : "";
  const detail = view != null ? ` view ${view}` : pageNumber != null ? ` page ${pageNumber}` : "";
  const ofMax = maxAttempts != null ? ` of ${maxAttempts}` : "";
  const lastErr = lastErrorReason ? `, last error: ${lastErrorReason}` : "";
  return (
    `  ⚠ ${callKind}${subject}${detail} taking longer than expected — ` +
    `currently ${Math.round(elapsedMs / 1000)}s into attempt ${attemptN}${ofMax}${lastErr}.`
  );
}

/**
 * Build the soft-warn event payload for status.json emission.
 */
export function buildSlowCallEvent({ callKind, subjectName, view, pageNumber, elapsedMs, attemptN, lastError }) {
  return {
    kind: "slow_call",
    call_kind: callKind,
    subject_name: subjectName ?? null,
    view: view ?? null,
    page_number: pageNumber ?? null,
    elapsed_ms: elapsedMs,
    attempt_count: attemptN,
    last_error: lastError ?? null,
  };
}

/**
 * Build the retry event payload for status.json emission.
 */
export function buildRetryEvent({ callKind, subjectName, view, pageNumber, attemptN, waitMs, errorKind }) {
  return {
    kind: "retry",
    call_kind: callKind,
    subject_name: subjectName ?? null,
    view: view ?? null,
    page_number: pageNumber ?? null,
    attempt_n: attemptN,
    wait_ms: waitMs,
    error_kind: errorKind,
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Run a paid API call with retry + wall-time governance. Shared between
 * src/gemini.js and src/anthropic.js — each module passes its own
 * classifyError function (the SDKs throw different error shapes).
 *
 * Item 1b refactor (2026-06-01): the wall ceiling now actually INTERRUPTS
 * in-flight calls via Promise.race against a per-attempt setTimeout, and
 * the soft-warn fires via a parallel setTimeout that runs whether fn()
 * resolves, rejects, or hangs. The original Item 1 implementation only
 * checked at retry boundaries — a long-running successful call could
 * exceed the ceiling without firing either.
 *
 * @param {() => Promise<T>} fn The thunk to call (one attempt).
 * @param {object} [callContext]
 * @param {string} [callContext.callKind] "sheet_mint" | "page_render" | "story_gen"
 * @param {string} [callContext.subjectName]
 * @param {number} [callContext.view] 1-based sheet view index
 * @param {number} [callContext.pageNumber] scene page number
 * @param {(event) => void} [callContext.onSlowCall] status emitter for
 *   slow_call + retry events
 * @param {number} [callContext.wallCeilingMs] override for tests; defaults
 *   to WALL_CEILING_MS
 * @param {number} [callContext.slowWarnMs] override for tests; defaults
 *   to SLOW_WARN_MS
 * @param {(err) => { reason: string, backoffs: number[] } | null} [classifyError]
 *   module-specific retry classifier; defaults to "never retry"
 */
export async function callWithRetry(fn, callContext = {}, classifyError = () => null) {
  const callKind = callContext.callKind ?? "unknown";
  const subjectName = callContext.subjectName ?? null;
  const view = callContext.view ?? null;
  const pageNumber = callContext.pageNumber ?? null;
  const onSlowCall = typeof callContext.onSlowCall === "function" ? callContext.onSlowCall : null;
  const wallCeilingMs = typeof callContext.wallCeilingMs === "number" ? callContext.wallCeilingMs : WALL_CEILING_MS;
  const slowWarnMs = typeof callContext.slowWarnMs === "number" ? callContext.slowWarnMs : SLOW_WARN_MS;

  const t0 = Date.now();
  const elapsedMs = () => Date.now() - t0;

  let attemptCount = 0;
  let lastError = null;
  let lastClassifiedReason = null;
  const retryHistory = [];

  const lastErrorPayload = () => lastError
    ? { message: String(lastError.message ?? lastError).slice(0, 300), status: lastError?.status ?? null, kind: lastClassifiedReason }
    : null;

  const buildCeilingError = () => new WallCeilingError({
    callKind, subjectName, view, pageNumber,
    elapsedMs: elapsedMs(),
    attemptCount: Math.max(attemptCount, 1),
    retryHistory: [...retryHistory],
    lastError: lastErrorPayload(),
  });

  // Parallel slow-warn timer: fires ONCE across the whole call (across all
  // retries + backoff sleeps), regardless of whether fn() resolves, rejects,
  // or hangs. Cleared in finally. Guarded so it can't outlive the call.
  let slowWarnFired = false;
  let slowWarnTimerId = null;
  if (slowWarnMs < wallCeilingMs) {
    slowWarnTimerId = setTimeout(() => {
      if (slowWarnFired) return;
      slowWarnFired = true;
      const reason = lastClassifiedReason ?? (lastError?.message ?? null);
      console.warn(formatSlowWarn({
        callKind, subjectName, view, pageNumber,
        elapsedMs: elapsedMs(),
        attemptN: Math.max(attemptCount, 1),
        maxAttempts: null,
        lastErrorReason: reason,
      }));
      if (onSlowCall) {
        try {
          onSlowCall(buildSlowCallEvent({
            callKind, subjectName, view, pageNumber,
            elapsedMs: elapsedMs(),
            attemptN: Math.max(attemptCount, 1),
            lastError: lastErrorPayload(),
          }));
        } catch { /* never break the call path */ }
      }
    }, slowWarnMs);
  }

  try {
    while (true) {
      // Pre-check: handles the case where prior backoff sleeps already pushed
      // us past the ceiling without a race firing.
      if (elapsedMs() >= wallCeilingMs) throw buildCeilingError();
      attemptCount += 1;

      const remainingMs = wallCeilingMs - elapsedMs();
      let ceilingTimerId;
      try {
        const result = await Promise.race([
          fn(),
          new Promise((_, reject) => {
            ceilingTimerId = setTimeout(() => {
              reject(buildCeilingError());
            }, remainingMs);
          }),
        ]);
        clearTimeout(ceilingTimerId);
        return result;
      } catch (err) {
        clearTimeout(ceilingTimerId);

        // WallCeilingError from the race or the pre-check: bubble up unchanged.
        // The underlying fn() may still be in flight, but we no longer await it.
        if (err instanceof WallCeilingError) throw err;

        lastError = err;
        const classified = classifyError(err);
        lastClassifiedReason = classified?.reason ?? null;

        // attemptCount=1 after first attempt, etc. backoffs.length=2 means we
        // can do 2 retries (3 total attempts). attemptCount > backoffs.length
        // means retries exhausted.
        if (!classified || attemptCount > classified.backoffs.length) {
          // Item 5 D3: attach retry_history to the bubbled-up error so a
          // forensic reader downstream (status.json finalize, page-pipeline
          // structured-error preservation) can see the full retry chain
          // even though we're not throwing a WallCeilingError here.
          if (classified && retryHistory.length > 0) {
            try { err.retry_history = [...retryHistory]; } catch { /* frozen err is rare; ignore */ }
          }
          throw err;
        }

        const backoffMs = classified.backoffs[attemptCount - 1];

        // If backoff would push past the ceiling, throw now rather than sleep
        // uselessly. (The pre-check at top of loop would catch it next iter,
        // but we'd burn the backoff sleep first — not catastrophic, just wasteful.)
        if (elapsedMs() + backoffMs >= wallCeilingMs) throw buildCeilingError();

        retryHistory.push({
          attempt_n: attemptCount,
          error_kind: classified.reason,
          wait_ms_before_next: backoffMs,
        });
        if (onSlowCall) {
          try {
            onSlowCall(buildRetryEvent({
              callKind, subjectName, view, pageNumber,
              attemptN: attemptCount,
              waitMs: backoffMs,
              errorKind: classified.reason,
            }));
          } catch { /* never break */ }
        }
        console.log(
          `  ⚠ ${classified.reason} — retrying in ${backoffMs / 1000}s ` +
          `(retry ${attemptCount}/${classified.backoffs.length}).`,
        );
        await sleep(backoffMs);
      }
    }
  } finally {
    if (slowWarnTimerId) clearTimeout(slowWarnTimerId);
  }
}
