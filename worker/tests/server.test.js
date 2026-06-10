// worker/tests/server.test.js — Connect-worker surface tests.
//
// Importing server.js builds the Inngest client + function and defines the
// health-server factory, but does NOT open a WebSocket (connect() runs only in
// start(), gated to the process entry point), so these tests do no network I/O.

import { describe, it, expect } from "vitest";
import request from "supertest";
import { ConnectionState } from "inngest/connect";
import { runPipelineJob, createHealthServer, findReusableBook } from "../src/server.js";

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

describe("findReusableBook — Stage 1a-i spend-idempotency", () => {
  // Runs in the handler's idempotency-check step, BEFORE mark-running clears the
  // job's pdf_url/metadata — so it sees the stuck-but-good fields. Pure unit, $0.
  const deps = (job) => ({
    getJobById: async () => { if (job instanceof Error) throw job; return job; },
    regenerateSignedUrl: async (p) => `https://fresh-signed/${p}`,
    bookPdfPath: (orderId) => `books/${orderId}.pdf`,
  });

  it("returns a FRESH signed URL + reused metadata for a known-good job", async () => {
    const job = { pdf_url: "https://stored/old-maybe-expired", generation_metadata: { pages: { success: 12, failed: 0 }, total_gemini_calls: 15 } };
    const r = await findReusableBook("job-1", "order-1", deps(job));
    expect(r).not.toBeNull();
    expect(r.pdfUrl).toBe("https://fresh-signed/books/order-1.pdf"); // regenerated, not the stored one
    expect(r.metadata.reused).toBe(true);
    expect(r.metadata.storagePath).toBe("books/order-1.pdf");
    expect(r.metadata.total_gemini_calls).toBe(15); // prior metadata carried through
  });

  it("returns null when the stored book had failed pages (degraded — do NOT re-serve)", async () => {
    const r = await findReusableBook("j", "o", deps({ pdf_url: "https://x", generation_metadata: { pages: { failed: 2 } } }));
    expect(r).toBeNull();
  });

  it("returns null when the job has no pdf_url yet (first run)", async () => {
    const r = await findReusableBook("j", "o", deps({ pdf_url: null, generation_metadata: null }));
    expect(r).toBeNull();
  });

  it("returns null (does not throw) when the job lookup fails", async () => {
    const r = await findReusableBook("j", "o", deps(new Error("no row")));
    expect(r).toBeNull();
  });
});
