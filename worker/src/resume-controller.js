// worker/src/resume-controller.js — R3b: the onFailure decision/transition + the
// cron sweep. Pure-ish orchestration over injectable collaborators (db, notify,
// inngest sender, health-probe) so it unit-tests with no I/O.
import {
  getJobById as realGetJobById,
  markFailed as realMarkFailed,
  markResumable as realMarkResumable,
  markBlockedOnCredits as realMarkBlockedOnCredits,
  listDueResumable as realListDueResumable,
  listBlockedOnCredits as realListBlockedOnCredits,
  requeueResumable as realRequeueResumable,
} from "./db.js";
import { notifyRecovery as realNotifyRecovery } from "./notify-recovery.js";
import { classifyJobFailure, decideTransition, MAX_ATTEMPTS } from "./resume-policy.js";

const CREDIT_ERR_RE = /RESOURCE_EXHAUSTED|exceeded your current quota|credits are depleted|\bquota\b/i;
// gemini.js throws this when the call succeeds but carries no image part.
const EMPTY_RESPONSE_RE = /No image returned from Gemini|Response parts received/i;
/** A real page render is ~300KB+; anything this small is not a usable image. */
const MIN_IMAGE_BYTES = 1024;

/**
 * Run one cheap Gemini image call and classify the result.
 *
 * MUST be an IMAGE generation. Verified 2026-07-20 during a real depletion: the 429
 * ("your prepayment credits are depleted") arrived on the image path. Free calls
 * (models.list, countTokens) and text generation were NOT confirmed to surface it —
 * the depletion was resolved before that experiment could run with a valid negative
 * control, so we assume conservatively that only a billed image call is diagnostic.
 * See scripts/_probe-credit-signal.mjs to settle it during the next depletion; if a
 * free call turns out to reveal credit state, this probe drops to $0/run.
 *
 * "Healthy" REQUIRES IMAGE BYTES BACK — not merely the absence of a credit error.
 * Observed 2026-07-20 during the adult art probe: Gemini returned HTTP 200 with no
 * image part, repeatedly. That state is "up, billable, and useless" — a monitor that
 * reports healthy through it is worse than no monitor, because it actively asserts
 * the thing is fine while every customer render fails.
 *
 * @returns {Promise<{healthy: boolean, reason: 'ok'|'credits_depleted'|'timeout'|'empty_response'|'other', detail: string|null}>}
 */
export async function probeGeminiHealth() {
  const CAP_MS = 30000;
  let timer;
  try {
    const { generateImage } = await import("../../src/gemini.js");
    const timeout = new Promise((_, rej) => { timer = setTimeout(() => rej(new Error("PROBE_TIMEOUT")), CAP_MS); });
    const buf = await Promise.race([
      generateImage("a small red dot on a plain white background", [], {}, { callKind: "credit_probe" }),
      timeout,
    ]);
    // Assert BYTES. gemini.js normally throws on an empty part list, but a truncated
    // or zero-length buffer would otherwise sail through as "healthy".
    const bytes = buf?.length ?? 0;
    if (bytes < MIN_IMAGE_BYTES) {
      return { healthy: false, reason: "empty_response", detail: `image was ${bytes} bytes (min ${MIN_IMAGE_BYTES})` };
    }
    return { healthy: true, reason: "ok", detail: null };
  } catch (e) {
    const msg = e?.message ?? "";
    if (CREDIT_ERR_RE.test(msg)) return { healthy: false, reason: "credits_depleted", detail: msg.slice(0, 300) };
    if (/PROBE_TIMEOUT/.test(msg)) return { healthy: false, reason: "timeout", detail: `no response in ${CAP_MS}ms` };
    // The 200-with-no-image case: gemini.js raises this rather than returning empty.
    if (EMPTY_RESPONSE_RE.test(msg)) return { healthy: false, reason: "empty_response", detail: msg.slice(0, 300) };
    // Anything else (5xx, network) stays non-fatal for the resume sweep's purposes —
    // see defaultHealthProbe below, which preserves the original semantics exactly.
    return { healthy: true, reason: "other", detail: msg.slice(0, 300) };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Default credit-recovery probe for resumeSweep. Boolean: may we un-park credit-
 * blocked jobs and send them back through the pipeline?
 *
 * Credit errors and timeouts both mean "no" (unchanged). `empty_response` is NEW and
 * also means "no": un-parking jobs into an API that returns 200-with-no-image just
 * burns their remaining attempts on renders that cannot succeed. Waiting costs a
 * parked job 15 minutes; un-parking wrongly can cost it the attempt budget that is
 * the difference between recovering and refunding.
 */
async function defaultHealthProbe() {
  const { reason } = await probeGeminiHealth();
  return reason === "ok" || reason === "other";
}

/**
 * Decide + transition a job that exhausted its (now 1) inngest retries. Resumable →
 * status=resumable + next_retry_at; credit → blocked_on_credits; terminal → markFailed.
 * notifyRecovery's `terminal` flag tells the website whether to run customer recovery
 * (refund/email — gated in R3c) or ops-alert only. Returns { failureClass, decision }.
 */
export async function handlePipelineFailure({ jobId, orderId, error }, deps = {}) {
  const {
    getJobById = realGetJobById,
    markFailed = realMarkFailed,
    markResumable = realMarkResumable,
    markBlockedOnCredits = realMarkBlockedOnCredits,
    notifyRecovery = realNotifyRecovery,
    now = Date.now,
  } = deps;

  const failureClass = classifyJobFailure(error);
  let job = null;
  try { job = await getJobById(jobId); } catch { /* no row → decideTransition treats as fresh */ }
  const decision = decideTransition({ failureClass, job, now: now() });
  const errPayload = { message: error?.message, kind: error?.kind ?? error?.name };

  if (decision.kind === "terminal") {
    await markFailed(jobId, {
      errorMessage: error?.message ?? "Unknown pipeline failure",
      errorDetails: { name: error?.name, message: error?.message, stack: error?.stack, failureClass, decision: decision.reason },
    });
    await notifyRecovery({ source: "order", orderId, jobId, error: errPayload, terminal: true });
  } else if (decision.kind === "park") {
    await markBlockedOnCredits(jobId);
    await notifyRecovery({ source: "order", orderId, jobId, error: errPayload, terminal: false });
  } else {
    await markResumable(jobId, { nextRetryAt: new Date(decision.nextRetryAtMs).toISOString() });
    await notifyRecovery({ source: "order", orderId, jobId, error: errPayload, terminal: false });
  }
  return { failureClass, decision };
}

/**
 * The cron sweep (Inngest scheduled fn body). Re-enqueues due resumable jobs
 * (bumping attempt_count) via the injected sendRetried; for parked credit jobs,
 * runs ONE health-probe and, if healthy, flips them back to resumable (due now).
 * Returns a summary for logging.
 */
export async function resumeSweep(deps = {}) {
  const {
    listDueResumable = realListDueResumable,
    listBlockedOnCredits = realListBlockedOnCredits,
    requeueResumable = realRequeueResumable,
    markResumable = realMarkResumable,
    sendRetried, // REQUIRED — server injects the inngest.send wrapper
    healthProbe = defaultHealthProbe,
    now = Date.now,
    maxAttempts = MAX_ATTEMPTS,
  } = deps;
  if (typeof sendRetried !== "function") throw new Error("resumeSweep: sendRetried dep is required");

  const nowMs = now();
  const due = await listDueResumable(new Date(nowMs).toISOString(), maxAttempts);
  for (const job of due) {
    await requeueResumable(job.id, (job.attempt_count ?? 0) + 1);
    await sendRetried({ jobId: job.id, orderId: job.order_id });
  }

  const blocked = await listBlockedOnCredits();
  let probedHealthy = null;
  if (blocked.length > 0) {
    probedHealthy = await healthProbe();
    if (probedHealthy) {
      for (const job of blocked) {
        await markResumable(job.id, { nextRetryAt: new Date(nowMs).toISOString() });
      }
    }
  }
  return { requeued: due.length, blocked: blocked.length, probedHealthy };
}
