// worker/src/notify-recovery.js — R2: fan a terminal failure to the website's
// recovery endpoint (/api/internal/recover), which runs the refund + customer
// email + status sync (paid orders) and the ops-alert (all failures).
//
// The worker can't import the website's Stripe/Resend/orders code, so it POSTs.
// NEVER throws: markFailed already recorded the failure durably before this runs,
// so a lost recovery call degrades to "today" (admin sees the failed job) rather
// than crashing onFailure. Idempotent on the website side, so a retry is safe.

const DEFAULT_ATTEMPTS = 3;

/**
 * @param {{source:'order'|'preview', orderId?:string, previewId?:string, jobId?:string, error:{message?:string, kind?:string}}} payload
 * @param {{ fetchImpl?:Function, baseUrl?:string, secret?:string, attempts?:number }} [deps]
 * @returns {Promise<{ok:boolean, reason?:string}>}
 */
export async function notifyRecovery(payload, deps = {}) {
  const {
    fetchImpl = fetch,
    baseUrl = process.env.WEBSITE_BASE_URL,
    secret = process.env.INTERNAL_RECOVERY_SECRET,
    attempts = DEFAULT_ATTEMPTS,
  } = deps;

  if (!baseUrl || !secret) {
    console.error("[notifyRecovery] WEBSITE_BASE_URL / INTERNAL_RECOVERY_SECRET unset — cannot fan out recovery", { source: payload?.source });
    return { ok: false, reason: "unconfigured" };
  }

  const url = `${baseUrl.replace(/\/+$/, "")}/api/internal/recover`;
  let lastErr = null;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetchImpl(url, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${secret}` },
        body: JSON.stringify(payload),
      });
      if (res.ok) return { ok: true };
      lastErr = `HTTP ${res.status}`;
    } catch (e) {
      lastErr = e?.message ?? String(e);
    }
  }
  console.error("[notifyRecovery] failed after retries", { source: payload?.source, reference: payload?.orderId ?? payload?.previewId, lastErr });
  return { ok: false, reason: lastErr };
}
