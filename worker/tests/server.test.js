// worker/tests/server.test.js — Connect-worker surface tests.
//
// Importing server.js builds the Inngest client + function and defines the
// health-server factory, but does NOT open a WebSocket (connect() runs only in
// start(), gated to the process entry point), so these tests do no network I/O.

import { describe, it, expect } from "vitest";
import request from "supertest";
import { ConnectionState } from "inngest/connect";
import { runPipelineJob, createHealthServer } from "../src/server.js";

describe("Inngest function registration", () => {
  it("run-pipeline-job is defined", () => {
    expect(runPipelineJob).toBeTruthy();
  });
});

describe("health server", () => {
  it("200 + ok:true when the connection is ACTIVE", async () => {
    const res = await request(createHealthServer(() => ConnectionState.ACTIVE)).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, state: ConnectionState.ACTIVE });
  });

  it("tolerates transient RECONNECTING with 200 (no Fly flap on auto-reconnect)", async () => {
    const res = await request(createHealthServer(() => ConnectionState.RECONNECTING)).get("/health");
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it("503 + ok:false when the connection is CLOSED", async () => {
    const res = await request(createHealthServer(() => ConnectionState.CLOSED)).get("/health");
    expect(res.status).toBe(503);
    expect(res.body.ok).toBe(false);
  });

  it("also serves / and /ready", async () => {
    const active = () => ConnectionState.ACTIVE;
    expect((await request(createHealthServer(active)).get("/")).status).toBe(200);
    expect((await request(createHealthServer(active)).get("/ready")).status).toBe(200);
  });

  it("404s unknown paths", async () => {
    const res = await request(createHealthServer(() => ConnectionState.ACTIVE)).get("/nope");
    expect(res.status).toBe(404);
  });
});
