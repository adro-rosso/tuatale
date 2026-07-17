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
import { runPipeline, syncPhotoPathsIntoMeta } from "../src/run-pipeline.js";
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

// R3a: these tests exercise R1/assembly, not checkpointing — no-op the checkpoint
// collaborators so they don't touch Storage. (Checkpoint behaviour is covered in
// checkpoint.test.js + the restore test below.)
const noCheckpoint = {
  restoreCheckpoint: async () => null,
  pushCheckpoint: async () => {},
  clearCheckpoint: async () => {},
};

describe("runPipeline — happy path", () => {
  it("returns a fetchable pdfUrl + metadata, and cleans the scratch dir", async () => {
    const scratchDir = path.join(os.tmpdir(), `tuatale-test-${crypto.randomUUID()}`);
    const pdf = await makeTinyPdf("assembled book");
    let generateBookArgs = null;

    const result = await runPipeline(
      { orderId: order.id, jobId: "job-happy" },
      {
        scratchDir,
        ...noCheckpoint,
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
          ...noCheckpoint,
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
        { ...noCheckpoint, generateStory: stubGenerateStory(), generateBook: async () => ({}) },
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
          ...noCheckpoint,
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

describe("runPipeline — R3a resume", () => {
  it("restores a checkpoint → SKIPS generateStory + reuses the restored story", async () => {
    const scratchDir = path.join(os.tmpdir(), `tuatale-test-${crypto.randomUUID()}`);
    const pdf = await makeTinyPdf("resumed book");
    let storyGenCalled = false;
    let generateBookStory = null;
    let clearCalled = false;
    const restoredStory = { title: "Restored Story", character: "a boy in a red rocket tee" };

    const result = await runPipeline(
      { orderId: order.id, jobId: "job-resume" },
      {
        scratchDir,
        // A prior attempt's checkpoint exists.
        restoreCheckpoint: async () => ({ story: restoredStory, meta: { usage: { input_tokens: 1, output_tokens: 2 } }, sheetFiles: ["sheet-01.png"] }),
        pushCheckpoint: async () => {},
        clearCheckpoint: async () => { clearCalled = true; },
        // Must NOT be called on resume — using a fresh story would change sheet fingerprints.
        generateStory: async () => { storyGenCalled = true; return { story: { title: "FRESH-SHOULD-NOT-BE-USED" }, usage: {} }; },
        generateBook: async (args) => {
          generateBookStory = args.story;
          return {
            bookPdfBytes: pdf,
            summary: { pages: { success: 12, failed: 0 } },
            counts: { success: 12, success_after_retry: 0, escalated: 0, failed: 0 },
            subjectList: [{ id: "protagonist", name: "Elena", viewCount: 3 }],
            subjectSheetStatus: { protagonist: { sheetFiles: ["sheet-01.png", "sheet-02.png", "sheet-03.png"], skipped: false } },
          };
        },
        uploadBookPdf: async () => ({ pdfUrl: "https://x/resumed.pdf", storagePath: "p" }),
      },
    );

    expect(storyGenCalled).toBe(false);                 // generateStory SKIPPED on resume
    expect(generateBookStory).toEqual(restoredStory);   // reused the restored story → fingerprints match → sheet reuse
    expect(clearCalled).toBe(true);                     // checkpoint cleared on success
    expect(result.pdfUrl).toBe("https://x/resumed.pdf");
  });

  // The resume-path photo bug (2026-07-17): the checkpointed meta carries photo paths
  // into the PREVIOUS attempt's (deleted) scratch dir. book-pipeline reads META, so a
  // resumed job dereferenced files this run never wrote and — before the fail-loud
  // guard — silently shipped a likeness-free book. Pet books are photo-driven, so this
  // was a live "resumed job ships a generic dog" hazard.
  it("resume: re-points the restored meta's photo paths at THIS run (no stale scratch path)", async () => {
    const scratchDir = path.join(os.tmpdir(), `tuatale-test-${crypto.randomUUID()}`);
    const pdf = await makeTinyPdf("resumed book");
    let generateBookMeta = null;
    // A checkpoint whose meta points into a previous, now-deleted scratch dir.
    const staleMeta = {
      inputs: {
        child: { name: "STALE", photoPath: "/tmp/tuatale-job-OLD/photos/child.png" },
        secondaries: [{ id: "companion-1", name: "STALE", photoPath: "/tmp/tuatale-job-OLD/photos/companion-1.png" }],
      },
      usage: { input_tokens: 1, output_tokens: 2 },
      bookGeneration: { keep: "me" }, // accumulated meta must survive the re-point
    };

    await runPipeline(
      { orderId: order.id, jobId: "job-resume-photo" },
      {
        scratchDir,
        restoreCheckpoint: async () => ({ story: { title: "Restored" }, meta: staleMeta, sheetFiles: [] }),
        pushCheckpoint: async () => {},
        clearCheckpoint: async () => {},
        generateStory: async () => { throw new Error("generateStory must not run on resume"); },
        generateBook: async (args) => {
          generateBookMeta = args.meta;
          return {
            bookPdfBytes: pdf,
            summary: { pages: { success: 12, failed: 0 } },
            counts: { success: 12, success_after_retry: 0, escalated: 0, failed: 0 },
            subjectList: [{ id: "protagonist", name: "Elena", viewCount: 3 }],
            subjectSheetStatus: { protagonist: { sheetFiles: ["sheet-01.png", "sheet-02.png", "sheet-03.png"], skipped: false } },
          };
        },
        uploadBookPdf: async () => ({ pdfUrl: "https://x/resumed.pdf", storagePath: "p" }),
      },
    );

    // meta.inputs now references THIS run's adapted input — not the stale checkpoint.
    expect(generateBookMeta.inputs.child.name).toBe("Elena");
    expect(JSON.stringify(generateBookMeta.inputs)).not.toContain("tuatale-job-OLD");
    expect(JSON.stringify(generateBookMeta.inputs)).not.toContain("STALE");
    // Surgical: unrelated checkpointed meta survives (not a blind rebuild).
    expect(generateBookMeta.bookGeneration).toEqual({ keep: "me" });
  });
});

describe("syncPhotoPathsIntoMeta — R3a resume photo re-point (pure)", () => {
  it("re-points inputs.child + inputs.secondaries at the fresh input, preserving the rest", () => {
    const input = {
      child: { name: "Biscuit", photo_paths: ["/tmp/job-NEW/photos/child-1.png"] },
      secondaries: [{ id: "companion-1", name: "Sam", photoPath: "/tmp/job-NEW/photos/companion-1.png" }],
    };
    const meta = {
      inputs: {
        child: { name: "Biscuit", photo_paths: ["/tmp/job-OLD/photos/child-1.png"] },
        secondaries: [{ id: "companion-1", name: "Sam", photoPath: "/tmp/job-OLD/photos/companion-1.png" }],
        theme: "a sunny day",
      },
      bookGeneration: { keep: "me" },
    };

    syncPhotoPathsIntoMeta(input, meta);

    expect(meta.inputs.child.photo_paths).toEqual(["/tmp/job-NEW/photos/child-1.png"]);
    expect(meta.inputs.secondaries[0].photoPath).toBe("/tmp/job-NEW/photos/companion-1.png");
    expect(meta.inputs.theme).toBe("a sunny day");     // untouched
    expect(meta.bookGeneration).toEqual({ keep: "me" }); // untouched
  });

  it("no-ops safely when meta is null / has no inputs", () => {
    expect(syncPhotoPathsIntoMeta({ child: {} }, null)).toBe(null);
    const m = {};
    expect(syncPhotoPathsIntoMeta({ child: {} }, m)).toBe(m);
  });
});

describe("runPipeline — photo fail-loud (never ship a likeness-free book)", () => {
  it("throws when a photo-anchored subject's photo cannot be downloaded", async () => {
    const scratchDir = path.join(os.tmpdir(), `tuatale-test-${crypto.randomUUID()}`);
    // An order whose pet photo points at an object that does not exist in the bucket.
    const badOrder = await insertTestOrder({
      book_type: "pet",
      animal_kind: "labradoodle",
      child_gender: null,
      photo_urls: { pet: ["uploads/definitely-not-a-real-object-xyz.png"] },
    });
    try {
      await expect(
        runPipeline(
          { orderId: badOrder.id, jobId: "job-badphoto" },
          {
            scratchDir,
            ...noCheckpoint,
            generateStory: async () => ({ story: { title: "x", scenes: new Array(12).fill({}) }, usage: {} }),
            generateBook: async () => { throw new Error("generateBook must NOT run — we must fail before spending"); },
            uploadBookPdf: async () => ({ pdfUrl: "x", storagePath: "p" }),
          },
        ),
      ).rejects.toThrow(/refusing to render a likeness-free book/i);
    } finally {
      await deleteOrderCascade(badOrder.id);
    }
  });
});
