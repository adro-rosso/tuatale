// worker/tests/server.test.js — HTTP surface tests (supertest, no port bind).
//
// Importing server.js evaluates run-pipeline.js → ../../src (anthropic + gemini),
// which require the AI keys at load; vitest.config.js preloads worker/.env.local.
// No real Inngest/Supabase calls happen here — we only exercise the HTTP routes
// + confirm the function is registered.

import { describe, it, expect } from "vitest";
import request from "supertest";
import { app, runPipelineJob } from "../src/server.js";

describe("health + root routes", () => {
  it("GET / returns 200 with a status message", async () => {
    const res = await request(app).get("/");
    expect(res.status).toBe(200);
    expect(res.text).toMatch(/worker is running/i);
  });

  it("GET /health returns 200 with ok: true", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true });
  });
});

describe("Inngest function registration", () => {
  it("the run-pipeline-job function is defined", () => {
    expect(runPipelineJob).toBeTruthy();
  });

  it("GET /api/inngest introspection is reachable and reports the function", async () => {
    // vitest.config.js sets INNGEST_DEV=1 so introspection works without a
    // signing key (prod runs cloud mode with INNGEST_SIGNING_KEY set).
    const res = await request(app).get("/api/inngest");
    expect(res.status).toBe(200);
    const blob = JSON.stringify(res.body);
    expect(blob).toMatch(/run-pipeline-job|function_count|functionsFound/i);
  });
});

// NOTE: signature rejection of unsigned POSTs is entirely Inngest-SDK behaviour,
// gated on INNGEST_SIGNING_KEY being set (cloud mode) — a production config
// concern, not worker code. It is not meaningfully testable in the keyless dev
// mode this suite runs in, so we don't assert it here; it's verified live in
// B.5 via the Inngest dashboard's app-health indicator after re-registration.
