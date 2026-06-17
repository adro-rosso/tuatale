// worker/tests/resume-controller.test.js — R3b onFailure transitions + cron sweep.
// Fully deps-injected → no DB/network/$.
import { describe, it, expect, vi } from "vitest";
import { handlePipelineFailure, resumeSweep } from "../src/resume-controller.js";
import { TERMINAL_WINDOW_MS } from "../src/resume-policy.js";

const NOW = 1_000_000_000_000;
const freshJob = { id: "j1", order_id: "o1", created_at: new Date(NOW - 60_000).toISOString(), attempt_count: 0, checkpoint: { spend: 0 } };

function failDeps(job = freshJob) {
  return {
    getJobById: vi.fn().mockResolvedValue(job),
    markFailed: vi.fn().mockResolvedValue({}),
    markResumable: vi.fn().mockResolvedValue({}),
    markBlockedOnCredits: vi.fn().mockResolvedValue({}),
    notifyRecovery: vi.fn().mockResolvedValue({ ok: true }),
    now: () => NOW,
  };
}

describe("handlePipelineFailure", () => {
  it("transient (wall-ceiling) → resumable + next_retry_at, ops-alert only (terminal:false)", async () => {
    const d = failDeps();
    const r = await handlePipelineFailure({ jobId: "j1", orderId: "o1", error: { name: "WallCeilingError", message: "300s wall ceiling" } }, d);
    expect(r.decision.kind).toBe("resume");
    expect(d.markResumable).toHaveBeenCalledOnce();
    expect(d.markResumable.mock.calls[0][1].nextRetryAt).toBe(new Date(NOW + 5 * 60_000).toISOString());
    expect(d.markFailed).not.toHaveBeenCalled();
    expect(d.notifyRecovery.mock.calls[0][0]).toMatchObject({ source: "order", terminal: false });
  });

  it("credit (RESOURCE_EXHAUSTED) → blocked_on_credits, ops-alert only", async () => {
    const d = failDeps();
    const r = await handlePipelineFailure({ jobId: "j1", orderId: "o1", error: { message: "RESOURCE_EXHAUSTED quota" } }, d);
    expect(r.decision.kind).toBe("park");
    expect(d.markBlockedOnCredits).toHaveBeenCalledWith("j1");
    expect(d.markFailed).not.toHaveBeenCalled();
    expect(d.notifyRecovery.mock.calls[0][0].terminal).toBe(false);
  });

  it("deterministic → terminal: markFailed + notifyRecovery(terminal:true)", async () => {
    const d = failDeps();
    const r = await handlePipelineFailure({ jobId: "j1", orderId: "o1", error: { name: "ShapeValidationError", message: "bad" } }, d);
    expect(r.decision.kind).toBe("terminal");
    expect(d.markFailed).toHaveBeenCalledOnce();
    expect(d.markResumable).not.toHaveBeenCalled();
    expect(d.notifyRecovery.mock.calls[0][0].terminal).toBe(true);
  });

  it("resumable but past the 5-day window → terminal (refund)", async () => {
    const old = { ...freshJob, created_at: new Date(NOW - TERMINAL_WINDOW_MS - 60_000).toISOString() };
    const d = failDeps(old);
    const r = await handlePipelineFailure({ jobId: "j1", orderId: "o1", error: { message: "503 transient" } }, d);
    expect(r.decision.kind).toBe("terminal");
    expect(d.markFailed).toHaveBeenCalledOnce();
    expect(d.notifyRecovery.mock.calls[0][0].terminal).toBe(true);
  });
});

describe("resumeSweep", () => {
  it("re-enqueues due resumable jobs (bumps attempt_count) + sends retried", async () => {
    const due = [
      { id: "j1", order_id: "o1", attempt_count: 0 },
      { id: "j2", order_id: "o2", attempt_count: 3 },
    ];
    const requeueResumable = vi.fn().mockResolvedValue({});
    const sendRetried = vi.fn().mockResolvedValue({});
    const r = await resumeSweep({
      listDueResumable: vi.fn().mockResolvedValue(due),
      listBlockedOnCredits: vi.fn().mockResolvedValue([]),
      requeueResumable,
      markResumable: vi.fn(),
      sendRetried,
      healthProbe: vi.fn(),
      now: () => NOW,
    });
    expect(r.requeued).toBe(2);
    expect(requeueResumable).toHaveBeenCalledWith("j1", 1);
    expect(requeueResumable).toHaveBeenCalledWith("j2", 4);
    expect(sendRetried).toHaveBeenCalledWith({ jobId: "j1", orderId: "o1" });
    expect(sendRetried).toHaveBeenCalledWith({ jobId: "j2", orderId: "o2" });
  });

  it("credit-park: probe HEALTHY → flips all blocked jobs back to resumable", async () => {
    const blocked = [{ id: "b1" }, { id: "b2" }];
    const markResumable = vi.fn().mockResolvedValue({});
    const healthProbe = vi.fn().mockResolvedValue(true);
    const r = await resumeSweep({
      listDueResumable: vi.fn().mockResolvedValue([]),
      listBlockedOnCredits: vi.fn().mockResolvedValue(blocked),
      requeueResumable: vi.fn(),
      markResumable,
      sendRetried: vi.fn(),
      healthProbe,
      now: () => NOW,
    });
    expect(r.probedHealthy).toBe(true);
    expect(healthProbe).toHaveBeenCalledOnce();
    expect(markResumable).toHaveBeenCalledTimes(2);
    expect(markResumable.mock.calls[0][0]).toBe("b1");
  });

  it("credit-park: probe UNHEALTHY → no flip (stays parked)", async () => {
    const markResumable = vi.fn();
    const r = await resumeSweep({
      listDueResumable: vi.fn().mockResolvedValue([]),
      listBlockedOnCredits: vi.fn().mockResolvedValue([{ id: "b1" }]),
      requeueResumable: vi.fn(),
      markResumable,
      sendRetried: vi.fn(),
      healthProbe: vi.fn().mockResolvedValue(false),
      now: () => NOW,
    });
    expect(r.probedHealthy).toBe(false);
    expect(markResumable).not.toHaveBeenCalled();
  });

  it("no parked jobs → no probe call (cost-bounded)", async () => {
    const healthProbe = vi.fn();
    await resumeSweep({
      listDueResumable: vi.fn().mockResolvedValue([]),
      listBlockedOnCredits: vi.fn().mockResolvedValue([]),
      requeueResumable: vi.fn(),
      markResumable: vi.fn(),
      sendRetried: vi.fn(),
      healthProbe,
      now: () => NOW,
    });
    expect(healthProbe).not.toHaveBeenCalled();
  });
});
