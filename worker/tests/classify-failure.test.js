// worker/tests/classify-failure.test.js — unit tests for the Section-B page-render
// failure taxonomy (Item D2 fatal-stop, 2026-06-10). Pure function, no API/$0.
// classifyFailure lives in ../../src/book-pipeline.js; importing it evaluates
// gemini.js, which needs GEMINI_API_KEY — the worker vitest config loads it.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { classifyFailure } from "../../src/book-pipeline.js";

// Real captured billing-429 body (D-H escalations.log): the Gemini ApiError.message
// IS this JSON string, which becomes result.error.
const BILLING_429 =
  '{"error":{"code":429,"message":"Your prepayment credits are depleted. Please go to AI Studio ...","status":"RESOURCE_EXHAUSTED"}}';

describe("classifyFailure — deterministic layout failures (unchanged)", () => {
  it("region-too-small → B", () => {
    expect(classifyFailure({ error: "detected region too small for any text" })).toBe("B");
  });
  it("no-font-fits → C", () => {
    expect(classifyFailure({ error: "no readable font size fits the region" })).toBe("C");
  });
  it("unknown render error → A", () => {
    expect(classifyFailure({ error: "puppeteer crashed unexpectedly" })).toBe("A");
  });
  it("empty/missing result → A", () => {
    expect(classifyFailure({})).toBe("A");
    expect(classifyFailure({ error: "" })).toBe("A");
  });
});

describe("classifyFailure — fatal-stop (D2 on, the default)", () => {
  beforeEach(() => { delete process.env.D2_FATAL_STOP; }); // unset = on
  afterEach(() => { delete process.env.D2_FATAL_STOP; });

  it("billing/quota 429 (RESOURCE_EXHAUSTED in error string) → F", () => {
    expect(classifyFailure({ error: BILLING_429, structuredError: null })).toBe("F");
  });
  it("wall-ceiling (structuredError.kind) → F", () => {
    expect(
      classifyFailure({
        error: "page_render call page 9 exceeded 300s wall ceiling (300s, 1 attempt)",
        structuredError: { kind: "wall_ceiling_exceeded", call_kind: "page_render" },
      }),
    ).toBe("F");
  });
  it("429 surfaced via structuredError.status → F", () => {
    expect(classifyFailure({ error: "rate limited", structuredError: { status: 429 } })).toBe("F");
  });
  it("429 nested in a wall-ceiling last_error → F", () => {
    expect(
      classifyFailure({ error: "x", structuredError: { kind: "wall_ceiling_exceeded", last_error: { status: 429 } } }),
    ).toBe("F");
  });
  it("region/font still win over F (layout checked first)", () => {
    expect(classifyFailure({ error: "detected region too small", structuredError: { status: 429 } })).toBe("B");
  });
  it("genuine transient (no fatal signal) stays A", () => {
    expect(classifyFailure({ error: "503 Service Unavailable", structuredError: null })).toBe("A");
  });
});

describe("classifyFailure — D2_FATAL_STOP=off reproduces pre-fix behaviour", () => {
  beforeEach(() => { process.env.D2_FATAL_STOP = "off"; });
  afterEach(() => { delete process.env.D2_FATAL_STOP; });

  it("billing 429 → A (no fatal-stop)", () => {
    expect(classifyFailure({ error: BILLING_429, structuredError: null })).toBe("A");
  });
  it("wall-ceiling → A (no fatal-stop)", () => {
    expect(classifyFailure({ error: "x", structuredError: { kind: "wall_ceiling_exceeded" } })).toBe("A");
  });
  it("region/font unaffected by the gate", () => {
    expect(classifyFailure({ error: "no readable font size fits" })).toBe("C");
  });
});
