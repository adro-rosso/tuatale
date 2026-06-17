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

/**
 * Default credit-recovery probe: one cheap Gemini call. "Healthy" = the API
 * responded WITHOUT a credit/quota error (even an empty response counts — credits
 * are the gate, not image quality). RESOURCE_EXHAUSTED / timeout → still depleted.
 * Lazy-imports gemini.js so this module loads without GEMINI_API_KEY.
 */
async function defaultHealthProbe() {
  const CAP_MS = 30000;
  let timer;
  try {
    const { generateImage } = await import("../../src/gemini.js");
    const timeout = new Promise((_, rej) => { timer = setTimeout(() => rej(new Error("PROBE_TIMEOUT")), CAP_MS); });
    await Promise.race([
      generateImage("a small red dot on a plain white background", [], {}, { callKind: "credit_probe" }),
      timeout,
    ]);
    return true; // responded → credits present
  } catch (e) {
    return !/RESOURCE_EXHAUSTED|exceeded your current quota|\bquota\b|PROBE_TIMEOUT/i.test(e?.message ?? "");
  } finally {
    clearTimeout(timer);
  }
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
