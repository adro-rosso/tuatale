// worker/tests/db.test.js — integration against the tuatale-TEST project.
// Requires worker/.env.local pointing at tuatale-test (service role).

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import crypto from "node:crypto";
import {
  getOrderById,
  getJobById,
  markRunning,
  markAwaitingReview,
  markFailed,
} from "../src/db.js";
import { insertTestOrder, insertTestJob, deleteOrderCascade } from "./helpers.js";

let order;
let job;

beforeEach(async () => {
  order = await insertTestOrder();
  job = await insertTestJob(order.id);
});

afterEach(async () => {
  await deleteOrderCascade(order?.id);
});

describe("getOrderById", () => {
  it("returns the order when it exists", async () => {
    const fetched = await getOrderById(order.id);
    expect(fetched.id).toBe(order.id);
    expect(fetched.child_name).toBe("Elena");
  });

  it("throws when the order does not exist", async () => {
    await expect(getOrderById(crypto.randomUUID())).rejects.toThrow(/getOrderById/);
  });
});

describe("getJobById", () => {
  it("round-trips a job row", async () => {
    const fetched = await getJobById(job.id);
    expect(fetched.id).toBe(job.id);
    expect(fetched.order_id).toBe(order.id);
    expect(fetched.status).toBe("pending");
  });
});

describe("markRunning", () => {
  it("sets running + started_at + inngest refs, clears regenerate-edge fields", async () => {
    const updated = await markRunning(job.id, {
      inngestEventId: "evt_test_123",
      inngestRunId: "run_test_456",
    });
    expect(updated.status).toBe("running");
    expect(updated.started_at).toBeTruthy();
    expect(updated.inngest_event_id).toBe("evt_test_123");
    expect(updated.inngest_run_id).toBe("run_test_456");
    expect(updated.completed_at).toBeNull();
    expect(updated.pdf_url).toBeNull();
    expect(updated.generation_metadata).toBeNull();
  });
});

describe("markAwaitingReview", () => {
  it("sets awaiting_review + pdf_url + generation_metadata + completed_at", async () => {
    await markRunning(job.id, {});
    const updated = await markAwaitingReview(job.id, {
      pdfUrl: "https://example.test/orders/x/book.pdf?token=abc",
      generationMetadata: { pages: { success: 12, failed: 0 }, total_gemini_calls: 15 },
    });
    expect(updated.status).toBe("awaiting_review");
    expect(updated.pdf_url).toContain("book.pdf");
    expect(updated.generation_metadata).toMatchObject({ total_gemini_calls: 15 });
    expect(updated.completed_at).toBeTruthy();
  });
});

describe("markFailed", () => {
  it("sets failed + failed_at + completed_at + error fields", async () => {
    await markRunning(job.id, {});
    const updated = await markFailed(job.id, {
      errorMessage: "boom",
      errorDetails: { kind: "test_error", stack: "..." },
    });
    expect(updated.status).toBe("failed");
    expect(updated.failed_at).toBeTruthy();
    expect(updated.completed_at).toBeTruthy();
    expect(updated.error_message).toBe("boom");
    expect(updated.error_details).toMatchObject({ kind: "test_error" });
  });
});
