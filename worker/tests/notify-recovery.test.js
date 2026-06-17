// worker/tests/notify-recovery.test.js — R2 fan-out POST helper.
import { describe, it, expect, vi } from "vitest";
import { notifyRecovery } from "../src/notify-recovery.js";

const CFG = { baseUrl: "https://tuatale.example", secret: "shh", attempts: 3 };

describe("notifyRecovery", () => {
  it("POSTs to /api/internal/recover with bearer auth + JSON payload", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true });
    const payload = { source: "order", orderId: "o1", jobId: "j1", error: { message: "boom" } };

    const r = await notifyRecovery(payload, { ...CFG, fetchImpl });

    expect(r).toEqual({ ok: true });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://tuatale.example/api/internal/recover");
    expect(opts.method).toBe("POST");
    expect(opts.headers.authorization).toBe("Bearer shh");
    expect(JSON.parse(opts.body)).toEqual(payload);
  });

  it("retries on a non-ok response, then succeeds", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 503 })
      .mockResolvedValueOnce({ ok: true });
    const r = await notifyRecovery({ source: "preview", previewId: "p1", error: {} }, { ...CFG, fetchImpl });
    expect(r.ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("returns {ok:false} after attempts exhausted — never throws", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("network down"));
    const r = await notifyRecovery({ source: "order", orderId: "o1", error: {} }, { ...CFG, fetchImpl, attempts: 2 });
    expect(r.ok).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("unconfigured (no baseUrl/secret) → {ok:false, unconfigured}, no fetch", async () => {
    const fetchImpl = vi.fn();
    const r = await notifyRecovery({ source: "order", orderId: "o1", error: {} }, { fetchImpl, baseUrl: "", secret: "" });
    expect(r).toEqual({ ok: false, reason: "unconfigured" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
