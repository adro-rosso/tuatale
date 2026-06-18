// worker/tests/resume-policy.test.js — R3b pure decision logic.
import { describe, it, expect } from "vitest";
import {
  classifyJobFailure, dominantCause, nextRetryDelayMs, decideTransition,
  BACKOFF_MS, REPEAT_MS, SPEND_CAP_USD, MAX_ATTEMPTS, TERMINAL_WINDOW_MS,
} from "../src/resume-policy.js";

const MIN = 60 * 1000;

describe("classifyJobFailure", () => {
  it("RESOURCE_EXHAUSTED / quota → blocked_on_credits", () => {
    expect(classifyJobFailure({ message: "Gemini RESOURCE_EXHAUSTED: quota" })).toBe("blocked_on_credits");
    expect(classifyJobFailure({ message: "You exceeded your current quota" })).toBe("blocked_on_credits");
    // credit beats the incomplete-book transient signal (the baked-in cause wins)
    expect(classifyJobFailure({ message: "Incomplete book: 12 page(s) failed; cause: RESOURCE_EXHAUSTED" })).toBe("blocked_on_credits");
  });
  it("wall-ceiling / 5xx / incomplete → resumable", () => {
    expect(classifyJobFailure({ name: "WallCeilingError", message: "call exceeded 300s wall ceiling" })).toBe("resumable");
    expect(classifyJobFailure({ message: "503 from Google" })).toBe("resumable");
    expect(classifyJobFailure({ message: "Incomplete book: 1 page(s) failed to render" })).toBe("resumable");
    expect(classifyJobFailure({ message: "fetch failed" })).toBe("resumable");
  });
  it("deterministic → terminal", () => {
    expect(classifyJobFailure({ name: "ShapeValidationError", message: "x" })).toBe("terminal");
    expect(classifyJobFailure({ message: "child_gender is required" })).toBe("terminal");
    expect(classifyJobFailure({ kind: "protagonist_sheets_insufficient", message: "only 1 of 3" })).toBe("terminal");
  });
  it("ambiguous → resumable (delay≠failure; caps backstop)", () => {
    expect(classifyJobFailure({ message: "something odd happened" })).toBe("resumable");
  });
});

describe("dominantCause", () => {
  it("detects credit then wall-ceiling then null", () => {
    expect(dominantCause([{ structuredError: { message: "RESOURCE_EXHAUSTED" } }])).toBe("RESOURCE_EXHAUSTED");
    expect(dominantCause([{ structuredError: { kind: "wall_ceiling_exceeded" } }])).toBe("wall_ceiling");
    expect(dominantCause([{ outcome: "success" }])).toBeNull();
    expect(dominantCause(undefined)).toBeNull();
  });
});

describe("nextRetryDelayMs", () => {
  it("follows 5m,15m,45m,2h,4h then flat 6h", () => {
    expect([0, 1, 2, 3, 4].map(nextRetryDelayMs)).toEqual(BACKOFF_MS);
    expect(nextRetryDelayMs(5)).toBe(REPEAT_MS);
    expect(nextRetryDelayMs(20)).toBe(REPEAT_MS);
  });
});

describe("decideTransition", () => {
  const now = 1_000_000_000_000;
  const fresh = { created_at: new Date(now - 60 * MIN).toISOString(), attempt_count: 0, checkpoint: { spend: 0 } };

  it("resumable + fresh → resume with backoff[attempt]", () => {
    expect(decideTransition({ failureClass: "resumable", job: fresh, now }))
      .toEqual({ kind: "resume", nextRetryAtMs: now + BACKOFF_MS[0], reason: expect.stringMatching(/retry 1/) });
    const a2 = { ...fresh, attempt_count: 2 };
    expect(decideTransition({ failureClass: "resumable", job: a2, now }).nextRetryAtMs).toBe(now + BACKOFF_MS[2]);
  });
  it("blocked_on_credits + fresh → park", () => {
    expect(decideTransition({ failureClass: "blocked_on_credits", job: fresh, now }).kind).toBe("park");
  });
  it("deterministic class → terminal", () => {
    expect(decideTransition({ failureClass: "terminal", job: fresh, now }).kind).toBe("terminal");
  });
  it("window exceeded → terminal even if resumable", () => {
    const old = { ...fresh, created_at: new Date(now - TERMINAL_WINDOW_MS - MIN).toISOString() };
    expect(decideTransition({ failureClass: "resumable", job: old, now }).kind).toBe("terminal");
  });
  it("credit park past the window → terminal (caps win over park)", () => {
    const old = { ...fresh, created_at: new Date(now - TERMINAL_WINDOW_MS - MIN).toISOString() };
    expect(decideTransition({ failureClass: "blocked_on_credits", job: old, now }).kind).toBe("terminal");
  });
  it("spend cap exceeded → terminal", () => {
    const spent = { ...fresh, checkpoint: { spend: SPEND_CAP_USD } };
    expect(decideTransition({ failureClass: "resumable", job: spent, now }).kind).toBe("terminal");
  });
  it("attempt backstop exceeded → terminal", () => {
    const maxed = { ...fresh, attempt_count: MAX_ATTEMPTS };
    expect(decideTransition({ failureClass: "resumable", job: maxed, now }).kind).toBe("terminal");
  });
});
