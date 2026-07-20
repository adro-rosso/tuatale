// worker/src/credit-monitor.js — PROACTIVE Gemini credit monitoring.
//
// WHY THIS EXISTS (incident 2026-07-20): Gemini prepay credits ran to zero and we
// found out only because a developer happened to run a probe. Every existing signal
// is REACTIVE or traffic-gated:
//   - D2 fatal-stop → blocked_on_credits → R2 ops-alert needs a CUSTOMER JOB to fail
//     first, i.e. someone has already paid before we learn we cannot deliver.
//   - resumeSweep's probe only runs when there are parked jobs to sweep, so with no
//     traffic there is nothing to sweep and nothing to probe.
// With zero traffic — exactly the pre-launch state — depletion is invisible.
//
// This closes that: a scheduled synthetic probe independent of job traffic.
//
// TRAFFIC-AWARE BY DESIGN. A successful customer render already proves credits exist,
// so the synthetic (billed, ~$0.04) probe is SKIPPED when organic success is recent.
// Cost is ~$0 under traffic and only accrues while idle — which is precisely the
// blind spot. At the 6h cadence the worst case (permanently idle) is ~$4.87/month.
//
// EDGE-TRIGGERED ALERTS. Alert on the healthy→depleted transition, then at most once
// per 24h while still down, plus a recovery notice. A monitor that emails every 6h
// forever gets filtered, and a filtered alert is the same as no alert.
import {
  getOpsHealth as realGetOpsHealth,
  upsertOpsHealth as realUpsertOpsHealth,
  hadRecentGeminiSuccess as realHadRecentGeminiSuccess,
} from "./db.js";
import { probeGeminiHealth as realProbeGeminiHealth } from "./resume-controller.js";
import { notifyRecovery as realNotifyRecovery } from "./notify-recovery.js";

export const CHECK_KIND = "gemini";
/** Organic success inside this window ⇒ skip the paid probe. Matches the 6h cadence. */
export const TRAFFIC_WINDOW_MS = 6 * 60 * 60 * 1000;
/** While still depleted, re-alert at most this often. */
export const REALERT_INTERVAL_MS = 24 * 60 * 60 * 1000;

// ---- Flap suppression (2026-07-20) ----------------------------------------
// Measured on the naive version: a provider flapping down/up/down/up alerts on EVERY
// edge — 6 alerts in 6 probes. The 24h silence window did not absorb it, because it
// only ever gated the "still down" case and transitions were never rate-limited. This
// is not hypothetical; it is the exact shape of Gemini's behaviour on 2026-07-20
// (hangs, 200-with-no-image, and healthy responses within the same twenty minutes).
//
// The fix distinguishes the LAST OBSERVATION (`healthy`) from WHAT OPS WAS LAST TOLD
// (`alert_state`), and requires transient failures to repeat before they are believed.
//
// Reasons are NOT equal, so the threshold is not uniform:
//   credits_depleted → alert on the FIRST probe. A drained balance never self-heals,
//                      so waiting another 6h is pure detection latency for no benefit.
//   timeout / empty_response / other → require CONFIRM_THRESHOLD consecutive probes.
//                      These genuinely flap, and a single sample of a noisy process is
//                      not evidence of an outage.
export const CONFIRM_THRESHOLD = 2;
/** Failure reasons believed on first sight (deterministic, never transient). */
const IMMEDIATE_REASONS = new Set(["credits_depleted"]);

/**
 * One monitoring tick. Pure orchestration over injectable collaborators so it
 * unit-tests with no I/O, same shape as resumeSweep.
 *
 * @returns {Promise<{skipped:boolean, healthy:boolean|null, reason:string|null, alerted:boolean, transition:string|null}>}
 */
export async function checkGeminiCredits(deps = {}) {
  const {
    getOpsHealth = realGetOpsHealth,
    upsertOpsHealth = realUpsertOpsHealth,
    hadRecentGeminiSuccess = realHadRecentGeminiSuccess,
    probeGeminiHealth = realProbeGeminiHealth,
    notifyRecovery = realNotifyRecovery,
    now = Date.now,
    trafficWindowMs = TRAFFIC_WINDOW_MS,
    realertIntervalMs = REALERT_INTERVAL_MS,
    confirmThreshold = CONFIRM_THRESHOLD,
  } = deps;

  const nowMs = now();
  const prior = await getOpsHealth(CHECK_KIND);

  // Traffic-aware skip. Only valid while we believe we are HEALTHY: once depleted, we
  // must keep probing to detect recovery, and stale "recent success" from before the
  // outage would otherwise suppress that.
  const believedHealthy = (prior?.alert_state ?? "up") === "up";
  if (believedHealthy && (await hadRecentGeminiSuccess(new Date(nowMs - trafficWindowMs).toISOString()))) {
    return { skipped: true, healthy: true, reason: "organic_traffic", alerted: false, transition: null };
  }

  const { healthy, reason, detail } = await probeGeminiHealth();

  // Decide BEFORE persisting — the alert depends on what ops was last TOLD.
  const alertState = prior?.alert_state ?? "up";     // no row yet ⇒ ops believes "up"
  const streak = healthy ? 0 : (prior?.unhealthy_streak ?? 0) + 1;
  const lastAlertMs = prior?.last_alert_at ? Date.parse(prior.last_alert_at) : 0;

  // Is this failure believed yet? Deterministic reasons on sight; flappy ones need to
  // repeat. An unconfirmed failure updates the streak and stays SILENT.
  const confirmed = !healthy && (IMMEDIATE_REASONS.has(reason) || streak >= confirmThreshold);

  let transition = null;
  if (confirmed && alertState === "up") transition = "went_down";
  else if (healthy && alertState === "down") transition = "recovered";
  else if (confirmed && alertState === "down" && nowMs - lastAlertMs >= realertIntervalMs) transition = "still_down";
  // A blip (unhealthy, unconfirmed) while ops believes "up" → no alert, and crucially
  // no state change either, so the next healthy probe does NOT fire a recovery notice
  // for an outage that was never reported.

  let alerted = false;
  if (transition) {
    const res = await notifyRecovery({
      source: "health",
      check: CHECK_KIND,
      transition,
      healthy,
      error: {
        message:
          transition === "recovered"
            ? "Gemini image generation is responding again — credit alert cleared."
            : `Gemini image generation unavailable (${reason})${detail ? `: ${detail}` : ""}`,
        kind: reason,
      },
      // Never terminal: there is no order to refund. Ops-alert only.
      terminal: false,
    });
    alerted = Boolean(res?.ok);
  }

  // alert_state only moves when ops was actually TOLD. If the send failed, we still
  // believe ops is uninformed, so the next tick retries rather than going quiet.
  let nextAlertState = alertState;
  if (alerted && transition === "went_down") nextAlertState = "down";
  else if (alerted && transition === "recovered") nextAlertState = "up";

  await upsertOpsHealth({
    kind: CHECK_KIND,
    healthy,
    reason,
    detail: detail ?? null,
    checkedAt: new Date(nowMs).toISOString(),
    unhealthyStreak: streak,
    alertState: nextAlertState,
    // Only advance last_alert_at when an alert actually fired, so a failed send
    // doesn't silently start the 24h clock on an alert nobody received.
    lastAlertAt: alerted ? new Date(nowMs).toISOString() : (prior?.last_alert_at ?? null),
  });

  return { skipped: false, healthy, reason, alerted, transition, streak, confirmed, alertState: nextAlertState };
}
