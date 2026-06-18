// worker/src/resume-policy.js — R3b pure resume-decision logic (no I/O, unit-tested).
//
// Classifies a terminal-after-retries failure into resumable / blocked_on_credits /
// terminal, computes the capped-exponential backoff, and decides the transition
// given the job's attempt count, age (5-day window), and cumulative spend.
//
// Policy (Adro): a generation DELAY is not a failure-to-deliver (days-to-weeks
// print window) → resume transient incidents; refund only when TERMINAL.

const MIN = 60 * 1000;
// Backoff by attempt_count (0-based): 1st retry waits 5m, then 15m, 45m, 2h, 4h…
export const BACKOFF_MS = [5 * MIN, 15 * MIN, 45 * MIN, 120 * MIN, 240 * MIN];
export const REPEAT_MS = 6 * 60 * MIN; // …then every 6h
export const TERMINAL_WINDOW_DAYS = 5; // give-up window — Adro's working value, adjustable
export const TERMINAL_WINDOW_MS = TERMINAL_WINDOW_DAYS * 24 * 60 * MIN;
export const SPEND_CAP_USD = 2; // per-job cumulative Gemini cap until page-resume (R3d)
export const MAX_ATTEMPTS = 60; // backstop; the window/spend caps are the real terminals

/** Capped exponential backoff: BACKOFF_MS by attempt, then a flat 6h. */
export function nextRetryDelayMs(attemptCount) {
  return attemptCount < BACKOFF_MS.length ? BACKOFF_MS[attemptCount] : REPEAT_MS;
}

const CREDIT_RE = /RESOURCE_EXHAUSTED|exceeded your current quota|insufficient[_ ]?quota|\bquota\b|billing/i;
const TRANSIENT_RE = /wall.?ceiling|wall_ceiling_exceeded|\b50[0234]\b|fetch failed|ETIMEDOUT|ECONNRESET|ENOTFOUND|socket hang up|network|timed?[_ ]?out|incomplete[_ ]?(book|pipeline)/i;
const DETERMINISTIC_RE = /ShapeValidation|MaxTokens|\binvalid\b|\brequired\b|not found|malformed|unsupported|protagonist_sheets_insufficient/i;

/**
 * Classify the thrown failure from its (serialization-safe) message/name/kind.
 * For a credit-caused incomplete book, run-pipeline bakes the underlying cause
 * into the IncompletePipelineError reason so this sees RESOURCE_EXHAUSTED.
 * Order: credit → deterministic → transient → default resumable (delay≠failure;
 * the window/spend caps are the backstop for an ambiguous-but-really-broken job).
 */
export function classifyJobFailure(error) {
  const text = `${error?.name ?? ""} ${error?.message ?? ""} ${error?.kind ?? ""}`;
  if (CREDIT_RE.test(text)) return "blocked_on_credits";
  if (DETERMINISTIC_RE.test(text)) return "terminal";
  if (TRANSIENT_RE.test(text)) return "resumable";
  return "resumable";
}

/**
 * Dominant underlying cause across a degraded book's per-page results — baked into
 * the IncompletePipelineError reason so classifyJobFailure can route credit vs
 * latency. Returns "RESOURCE_EXHAUSTED" | "wall_ceiling" | null.
 */
export function dominantCause(perPageResults) {
  const blob = JSON.stringify(perPageResults ?? []);
  if (CREDIT_RE.test(blob)) return "RESOURCE_EXHAUSTED";
  if (/wall.?ceiling|wall_ceiling_exceeded/i.test(blob)) return "wall_ceiling";
  return null;
}

/**
 * Decide the post-failure transition. Terminal conditions (deterministic class,
 * 5-day window exceeded, spend cap exceeded, attempt backstop) win over park/resume
 * — so even a credit-park that drags past 5 days becomes terminal → refund.
 *
 * @returns {{ kind:'resume'|'park'|'terminal', nextRetryAtMs?:number, reason:string }}
 */
export function decideTransition({ failureClass, job, now = Date.now() }) {
  const createdAt = job?.created_at ? new Date(job.created_at).getTime() : now;
  const attempt = job?.attempt_count ?? 0;
  const spend = job?.checkpoint?.spend ?? 0;

  const windowExceeded = now - createdAt > TERMINAL_WINDOW_MS;
  const spendExceeded = spend >= SPEND_CAP_USD;
  const attemptsExceeded = attempt >= MAX_ATTEMPTS;

  if (failureClass === "terminal" || windowExceeded || spendExceeded || attemptsExceeded) {
    const reason =
      failureClass === "terminal" ? "deterministic failure"
      : windowExceeded ? `resume window (${TERMINAL_WINDOW_DAYS}d) exceeded`
      : spendExceeded ? `spend cap ($${SPEND_CAP_USD}) exceeded`
      : `max attempts (${MAX_ATTEMPTS}) exceeded`;
    return { kind: "terminal", reason };
  }
  if (failureClass === "blocked_on_credits") {
    return { kind: "park", reason: "RESOURCE_EXHAUSTED — parked, awaiting credit recovery" };
  }
  return {
    kind: "resume",
    nextRetryAtMs: now + nextRetryDelayMs(attempt),
    reason: `resumable — retry ${attempt + 1} in ${Math.round(nextRetryDelayMs(attempt) / MIN)}m`,
  };
}
