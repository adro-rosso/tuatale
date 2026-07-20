// Credit-monitor tests. The logic that matters here is the ALERT DECISION — a
// monitor that cries wolf gets filtered, and a filtered monitor is the same as none.
import { describe, it, expect, vi } from "vitest";
import { checkGeminiCredits, TRAFFIC_WINDOW_MS, REALERT_INTERVAL_MS } from "../src/credit-monitor.js";

const NOW = 1_800_000_000_000;
const healthyProbe = () => ({ healthy: true, reason: "ok", detail: null });
const depletedProbe = () => ({ healthy: false, reason: "credits_depleted", detail: "prepayment credits are depleted" });

function harness({ prior = null, probe = depletedProbe, recentSuccess = false } = {}) {
  const upserts = [];
  const alerts = [];
  const deps = {
    getOpsHealth: vi.fn(async () => prior),
    upsertOpsHealth: vi.fn(async (row) => { upserts.push(row); return row; }),
    hadRecentGeminiSuccess: vi.fn(async () => recentSuccess),
    probeGeminiHealth: vi.fn(async () => probe()),
    notifyRecovery: vi.fn(async (payload) => { alerts.push(payload); return { ok: true }; }),
    now: () => NOW,
  };
  return { deps, upserts, alerts };
}

describe("traffic-aware skip", () => {
  it("SKIPS the paid probe when a real render succeeded in the window", async () => {
    const { deps } = harness({ recentSuccess: true });
    const r = await checkGeminiCredits(deps);
    expect(r.skipped).toBe(true);
    expect(deps.probeGeminiHealth).not.toHaveBeenCalled(); // the whole point: $0 under traffic
    expect(deps.notifyRecovery).not.toHaveBeenCalled();
  });

  it("probes when there has been NO recent success (the idle blind spot)", async () => {
    const { deps } = harness({ recentSuccess: false, probe: healthyProbe });
    const r = await checkGeminiCredits(deps);
    expect(r.skipped).toBe(false);
    expect(deps.probeGeminiHealth).toHaveBeenCalledOnce();
  });

  // Once known-depleted we must keep probing to notice recovery. Stale "recent
  // success" from before the outage would otherwise suppress the recovery check.
  it("does NOT skip while already known-depleted, even with recent success", async () => {
    const { deps } = harness({ prior: { healthy: false, alert_state: "down", unhealthy_streak: 2, last_alert_at: new Date(NOW).toISOString() }, recentSuccess: true, probe: healthyProbe });
    const r = await checkGeminiCredits(deps);
    expect(r.skipped).toBe(false);
    expect(deps.probeGeminiHealth).toHaveBeenCalledOnce();
  });

  it("passes the correct traffic window to the query", async () => {
    const { deps } = harness({ recentSuccess: true });
    await checkGeminiCredits(deps);
    expect(deps.hadRecentGeminiSuccess).toHaveBeenCalledWith(new Date(NOW - TRAFFIC_WINDOW_MS).toISOString());
  });
});

describe("edge-triggered alerting", () => {
  it("healthy → depleted ALERTS once", async () => {
    const { deps, alerts } = harness({ prior: { healthy: true, last_alert_at: null } });
    const r = await checkGeminiCredits(deps);
    expect(r.transition).toBe("went_down");
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ source: "health", check: "gemini", terminal: false });
    expect(alerts[0].error.message).toMatch(/credits_depleted/);
  });

  it("still depleted WITHIN the re-alert window stays SILENT (no alert fatigue)", async () => {
    const prior = { healthy: false, alert_state: "down", unhealthy_streak: 2, last_alert_at: new Date(NOW - 60_000).toISOString() };
    const { deps, alerts } = harness({ prior });
    const r = await checkGeminiCredits(deps);
    expect(r.transition).toBeNull();
    expect(alerts).toHaveLength(0);
  });

  it("still depleted AFTER the re-alert window re-alerts once", async () => {
    const prior = { healthy: false, alert_state: "down", unhealthy_streak: 2, last_alert_at: new Date(NOW - REALERT_INTERVAL_MS - 1000).toISOString() };
    const { deps, alerts } = harness({ prior });
    const r = await checkGeminiCredits(deps);
    expect(r.transition).toBe("still_down");
    expect(alerts).toHaveLength(1);
  });

  it("depleted → healthy sends a RECOVERY notice", async () => {
    const prior = { healthy: false, alert_state: "down", unhealthy_streak: 2, last_alert_at: new Date(NOW - 1000).toISOString() };
    const { deps, alerts } = harness({ prior, probe: healthyProbe });
    const r = await checkGeminiCredits(deps);
    expect(r.transition).toBe("recovered");
    expect(alerts[0].healthy).toBe(true);
    expect(alerts[0].error.message).toMatch(/responding again/i);
  });

  it("healthy → healthy is silent", async () => {
    const { deps, alerts } = harness({ prior: { healthy: true }, probe: healthyProbe });
    const r = await checkGeminiCredits(deps);
    expect(r.transition).toBeNull();
    expect(alerts).toHaveLength(0);
  });

  // No row yet = first ever run. Assume healthy so a genuine failure still alerts.
  it("first run with no prior row still alerts on a failure", async () => {
    const { deps, alerts } = harness({ prior: null });
    const r = await checkGeminiCredits(deps);
    expect(r.transition).toBe("went_down");
    expect(alerts).toHaveLength(1);
  });
});

describe("state persistence", () => {
  it("records the verdict every non-skipped tick", async () => {
    const { deps, upserts } = harness({ prior: { healthy: true } });
    await checkGeminiCredits(deps);
    expect(upserts[0]).toMatchObject({ kind: "gemini", healthy: false, reason: "credits_depleted" });
    expect(upserts[0].checked_at ?? upserts[0].checkedAt).toBeTruthy();
  });

  // A failed send must not start the 24h silence on an alert nobody received.
  it("does NOT advance last_alert_at when the alert failed to send", async () => {
    const { deps, upserts } = harness({ prior: { healthy: true, last_alert_at: null } });
    deps.notifyRecovery = vi.fn(async () => ({ ok: false, reason: "unconfigured" }));
    const r = await checkGeminiCredits(deps);
    expect(r.alerted).toBe(false);
    expect(upserts[0].lastAlertAt).toBeNull();
  });

  it("advances last_alert_at when the alert DID send", async () => {
    const { deps, upserts } = harness({ prior: { healthy: true, last_alert_at: null } });
    await checkGeminiCredits(deps);
    expect(upserts[0].lastAlertAt).toBe(new Date(NOW).toISOString());
  });
});

describe("probe reason classification", () => {
  it("a timeout is unhealthy but is NOT reported as credit depletion", async () => {
    const probe = () => ({ healthy: false, reason: "timeout", detail: "no response in 30000ms" });
    // Timeout is transient, so it needs the second consecutive probe to be believed.
    const { deps, alerts } = harness({ prior: { healthy: false, alert_state: "up", unhealthy_streak: 1 }, probe });
    const r = await checkGeminiCredits(deps);
    expect(r.reason).toBe("timeout");
    expect(alerts[0].error.kind).toBe("timeout");
    expect(alerts[0].error.message).not.toMatch(/RESOURCE_EXHAUSTED/);
  });
});

// "Up, billable, and useless" — observed 2026-07-20: Gemini returned HTTP 200 with no
// image part, repeatedly. A monitor that reports healthy through this is worse than no
// monitor, because it actively asserts the pipeline is fine while every render fails.
describe("empty-response detection", () => {
  const emptyProbe = () => ({ healthy: false, reason: "empty_response", detail: "image was 0 bytes (min 1024)" });

  // Transient reasons must REPEAT before they are believed — a single sample of a
  // noisy provider is not evidence of an outage.
  it("a FIRST empty response is silent (unconfirmed)", async () => {
    const { deps, alerts } = harness({ prior: { healthy: true, alert_state: "up", unhealthy_streak: 0 }, probe: emptyProbe });
    const r = await checkGeminiCredits(deps);
    expect(r.healthy).toBe(false);
    expect(r.confirmed).toBe(false);
    expect(r.streak).toBe(1);
    expect(alerts).toHaveLength(0);
  });

  it("a SECOND consecutive empty response alerts", async () => {
    const { deps, alerts } = harness({ prior: { healthy: false, alert_state: "up", unhealthy_streak: 1 }, probe: emptyProbe });
    const r = await checkGeminiCredits(deps);
    expect(r.streak).toBe(2);
    expect(r.transition).toBe("went_down");
    expect(alerts[0].error.kind).toBe("empty_response");
    expect(alerts[0].error.message).not.toMatch(/RESOURCE_EXHAUSTED|depleted/i);
  });
});

// The measured failure this fix exists for: the naive version alerted on EVERY edge —
// 6 alerts in 6 probes — because the 24h window only gated "still down".
describe("flap suppression", () => {
  const SIX_H = 6 * 3600_000;

  async function runSequence(healthySeq, reason = "empty_response") {
    let row = { healthy: true, alert_state: "up", unhealthy_streak: 0, last_alert_at: null };
    const alerts = [];
    let t = NOW;
    for (const healthy of healthySeq) {
      await checkGeminiCredits({
        getOpsHealth: async () => row,
        upsertOpsHealth: async (x) => {
          row = { healthy: x.healthy, alert_state: x.alertState, unhealthy_streak: x.unhealthyStreak, last_alert_at: x.lastAlertAt };
        },
        hadRecentGeminiSuccess: async () => false,
        probeGeminiHealth: async () => ({ healthy, reason: healthy ? "ok" : reason, detail: null }),
        notifyRecovery: async (p) => { alerts.push(p.transition); return { ok: true }; },
        now: () => t,
      });
      t += SIX_H;
    }
    return alerts;
  }

  it("down/up/down/up/down/up produces NO alerts (all unconfirmed blips)", async () => {
    expect(await runSequence([false, true, false, true, false, true])).toEqual([]);
  });

  it("a SUSTAINED outage still alerts, then recovers — exactly twice", async () => {
    expect(await runSequence([false, false, false, true])).toEqual(["went_down", "recovered"]);
  });

  it("credit depletion is believed on FIRST sight (never self-heals)", async () => {
    expect(await runSequence([false, true], "credits_depleted")).toEqual(["went_down", "recovered"]);
  });

  it("a blip never fires a recovery notice for an outage ops was never told about", async () => {
    expect(await runSequence([false, true])).toEqual([]);
  });
});
