// worker/tests/run-pipeline.test.js — assembly integration test.
//
// Exercises the REAL assembly wiring (fetch order → adapt → story → book →
// upload → return) + REAL Supabase Storage, with the two paid AI calls
// (generateStory, generateBook) injected as stubs via the deps seam. The REAL
// generateBook is already proven byte-identical in B.3's verify harness, so this
// suite focuses on the glue: input adaptation, scratch lifecycle, upload, and
// error propagation. No Gemini/Sonnet calls → $0.

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { runPipeline } from "../src/run-pipeline.js";
import { IncompletePipelineError } from "../src/incomplete-pipeline-error.js";
import { BUCKET, bookPdfPath } from "../src/storage.js";
import {
  insertTestOrder,
  deleteOrderCascade,
  ensureBucket,
  makeTinyPdf,
  deleteStorageObject,
} from "./helpers.js";

let order;

beforeAll(async () => {
  await ensureBucket(BUCKET);
});

beforeEach(async () => {
  order = await insertTestOrder();
});

afterEach(async () => {
  await deleteStorageObject(BUCKET, bookPdfPath(order?.id));
  await deleteOrderCascade(order?.id);
});

// A generateStory stub returning a minimal story + usage.
function stubGenerateStory() {
  return async (input) => {
    // Sanity: the adapter fed us a coherent input.
    expect(input.child.name).toBe("Elena");
    return {
      story: { title: "Elena's Story", scenes: new Array(12).fill({}) },
      usage: { input_tokens: 1234, output_tokens: 5678 },
    };
  };
}

describe("runPipeline — happy path", () => {
  it("returns a fetchable pdfUrl + metadata, and cleans the scratch dir", async () => {
    const scratchDir = path.join(os.tmpdir(), `tuatale-test-${crypto.randomUUID()}`);
    const pdf = await makeTinyPdf("assembled book");
    let generateBookArgs = null;

    const result = await runPipeline(
      { orderId: order.id, jobId: "job-happy" },
      {
        scratchDir,
        generateStory: stubGenerateStory(),
        generateBook: async (args) => {
          generateBookArgs = args;
          return {
            bookPdfBytes: pdf,
            summary: { pages: { success: 12, failed: 0 }, total_gemini_calls: 15, escalation_entries: 0 },
            // R1 completeness-gate inputs (a complete book passes the gate).
            counts: { success: 12, success_after_retry: 0, escalated: 0, failed: 0 },
            subjectList: [{ id: "protagonist", name: "Elena", viewCount: 3 }],
            subjectSheetStatus: {
              protagonist: { sheetFiles: ["sheet-01.png", "sheet-02.png", "sheet-03.png"], skipped: false },
            },
          };
        },
      },
    );

    // generateBook received the adapted child + scratch outputDir.
    expect(generateBookArgs.childName).toBe("Elena");
    expect(generateBookArgs.childAge).toBe(5);
    expect(generateBookArgs.outputDir).toBe(scratchDir);

    // Return shape.
    expect(result.pdfUrl).toMatch(/^https?:\/\//);
    expect(result.metadata).toMatchObject({
      pages: { success: 12, failed: 0 },
      total_gemini_calls: 15,
      tokens: { input_tokens: 1234, output_tokens: 5678 },
      storagePath: bookPdfPath(order.id),
    });

    // pdfUrl is real + fetchable.
    const res = await fetch(result.pdfUrl);
    expect(res.status).toBe(200);
    const body = Buffer.from(await res.arrayBuffer());
    expect(body.length).toBe(pdf.length);

    // Scratch dir cleaned up after success.
    expect(fs.existsSync(scratchDir)).toBe(false);
  });
});

describe("runPipeline — failure handling", () => {
  it("propagates a generateBook error AND still cleans the scratch dir", async () => {
    const scratchDir = path.join(os.tmpdir(), `tuatale-test-${crypto.randomUUID()}`);

    await expect(
      runPipeline(
        { orderId: order.id, jobId: "job-fail" },
        {
          scratchDir,
          generateStory: stubGenerateStory(),
          generateBook: async () => {
            throw new Error("render exploded");
          },
        },
      ),
    ).rejects.toThrow(/render exploded/);

    // finally-block cleanup ran despite the throw.
    expect(fs.existsSync(scratchDir)).toBe(false);
  });

  it("throws when the order does not exist", async () => {
    await expect(
      runPipeline(
        { orderId: crypto.randomUUID(), jobId: "job-missing" },
        { generateStory: stubGenerateStory(), generateBook: async () => ({}) },
      ),
    ).rejects.toThrow();
  });

  // R1: a degraded book (PDF bytes present but a page failed) must be REJECTED by
  // the completeness gate — typed error, scratch cleaned, and NO upload (the throw
  // happens before uploadBookPdf, so the degraded PDF never reaches Storage/review).
  it("rejects a degraded book (counts.failed>0) with IncompletePipelineError, before upload", async () => {
    const scratchDir = path.join(os.tmpdir(), `tuatale-test-${crypto.randomUUID()}`);
    const pdf = await makeTinyPdf("degraded book");
    let uploadCalled = false;

    await expect(
      runPipeline(
        { orderId: order.id, jobId: "job-degraded" },
        {
          scratchDir,
          generateStory: stubGenerateStory(),
          uploadBookPdf: async () => {
            uploadCalled = true;
            return { pdfUrl: "https://x/should-not-happen", storagePath: "x" };
          },
          generateBook: async () => ({
            bookPdfBytes: pdf, // truthy bytes — old existence check would have passed this
            summary: { pages: { success: 11, failed: 1 } },
            counts: { success: 11, success_after_retry: 0, escalated: 0, failed: 1 },
            subjectList: [{ id: "protagonist", name: "Elena", viewCount: 3 }],
            subjectSheetStatus: {
              protagonist: { sheetFiles: ["sheet-01.png", "sheet-02.png", "sheet-03.png"], skipped: false },
            },
          }),
        },
      ),
    ).rejects.toThrow(IncompletePipelineError);

    expect(uploadCalled).toBe(false); // gate fired before upload
    expect(fs.existsSync(scratchDir)).toBe(false); // scratch still cleaned
  });
});
