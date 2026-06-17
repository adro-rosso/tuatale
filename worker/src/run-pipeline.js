// worker/src/run-pipeline.js — the assembled pipeline run.
//
// runPipeline({ orderId, jobId }) → { pdfUrl, metadata }
//
// This is the unit the B.5 Inngest handler invokes inside its "run-pipeline"
// step. It is PURE EXECUTION: fetch order → adapt → generate story → generate
// book → upload PDF → return a signed URL + metadata. It deliberately does NOT
// touch pipeline_jobs state (markRunning/markAwaitingReview/markFailed) — those
// transitions are the handler's job, wrapped in their own durable Inngest steps
// (see docs/architecture/track-b-runtime.md §2). Keeping them out of here makes
// runPipeline independently testable and idempotent-friendly.
//
// Errors throw; the handler's retry/onFailure machinery owns recovery.
//
// NOTE: importing this module evaluates ../../src/anthropic.js and
// ../../src/book-pipeline.js (→ gemini.js), which throw at load if
// ANTHROPIC_API_KEY / GEMINI_API_KEY are unset. The Fly server (B.5) has them
// from secrets; tests load them via vitest.config.js → worker/.env.local.

import os from "node:os";
import path from "node:path";
import { promises as fsp } from "node:fs";
import { generateStory as realGenerateStory } from "../../src/anthropic.js";
import { generateBook as realGenerateBook } from "../../src/book-pipeline.js";
import { adaptOrderToPipelineInput } from "./adapter.js";
import { uploadBookPdf as realUploadBookPdf } from "./storage.js";
import { getOrderById as realGetOrderById } from "./db.js";
import { IncompletePipelineError } from "./incomplete-pipeline-error.js";

/**
 * R1 completeness gate. STRICT: a book is shippable only if it has PDF bytes,
 * zero failed pages, and every required subject (protagonist + each ref-anchored
 * secondary, i.e. everything in subjectList) has its FULL sheet set and is not
 * skipped. Throws a typed IncompletePipelineError otherwise — which propagates
 * to the handler's onFailure → markFailed (job → failed, NOT awaiting_review),
 * so a degraded/empty book never reaches admin review or a customer.
 *
 * Replaces the old existence-only `if (!bookPdfBytes) throw`. Exported for direct
 * unit testing. Inputs come straight off the generateBook return.
 *
 * @param {{ bookPdfBytes: Buffer|null, counts: {failed:number}|undefined,
 *   subjectSheetStatus: Record<string,{sheetFiles:string[],skipped:boolean}>|undefined,
 *   subjectList: Array<{id:string,name:string,viewCount:number}>|undefined }} result
 */
export function assertBookComplete({ bookPdfBytes, counts, subjectSheetStatus, subjectList }) {
  // Floor: no bytes at all (the sheets-only / protagonist-throw path returns null).
  if (!bookPdfBytes || bookPdfBytes.length === 0) {
    throw new IncompletePipelineError({
      failedPages: counts?.failed ?? null,
      missingSheets: [],
      reason: "no PDF bytes produced",
    });
  }

  // Every required subject must have its full sheet set and not be skipped.
  const missingSheets = [];
  for (const s of subjectList ?? []) {
    const status = subjectSheetStatus?.[s.id];
    const actual = status?.sheetFiles?.length ?? 0;
    const skipped = status?.skipped === true;
    if (skipped || actual < s.viewCount) {
      missingSheets.push({ subjectId: s.id, name: s.name, expected: s.viewCount, actual, skipped });
    }
  }

  const failedPages = counts?.failed ?? 0;
  if (failedPages > 0 || missingSheets.length > 0) {
    const parts = [];
    if (failedPages > 0) parts.push(`${failedPages} page(s) failed to render`);
    if (missingSheets.length > 0) {
      parts.push(`${missingSheets.length} subject(s) missing required sheets (${missingSheets.map((m) => m.name).join(", ")})`);
    }
    throw new IncompletePipelineError({ failedPages, missingSheets, reason: parts.join("; ") });
  }
}

/**
 * Build the `meta` object generateBook expects. generateBook reads
 * meta.inputs.child.{gender,appearance} and meta.inputs.secondaries[]; the rest
 * is carried for provenance. Mirrors what the CLI shim builds from story.json +
 * argv.
 */
export function buildMetaObject(input, story, usage) {
  return {
    inputs: {
      child: input.child,
      secondaries: input.secondaries,
      theme: input.theme,
      ageRange: input.ageRange,
    },
    story: { title: story?.title ?? null },
    generatedAt: new Date().toISOString(),
    usage,
  };
}

/**
 * @param {{ orderId: string, jobId: string }} args
 * @param {object} [deps]  test seam — override any of the collaborators:
 *   { generateStory, generateBook, uploadBookPdf, getOrderById,
 *     resolveImageOverride, scratchDir }. Production passes none.
 * @returns {Promise<{ pdfUrl: string, metadata: object }>}
 */
export async function runPipeline({ orderId, jobId }, deps = {}) {
  const {
    generateStory = realGenerateStory,
    generateBook = realGenerateBook,
    uploadBookPdf = realUploadBookPdf,
    getOrderById = realGetOrderById,
    resolveImageOverride = null,
    scratchDir: scratchDirOverride = null,
  } = deps;

  // 1. Fetch the order (the permanent draft snapshot).
  const order = await getOrderById(orderId);
  if (!order) throw new Error(`Order ${orderId} not found`);

  // 2. Adapt to pipeline input.
  const input = adaptOrderToPipelineInput(order);

  // 3. Per-job scratch dir (ephemeral; OS temp on Fly + locally).
  const scratchDir =
    scratchDirOverride || path.join(os.tmpdir(), `tuatale-job-${jobId}`);
  await fsp.mkdir(scratchDir, { recursive: true });

  let bookPdfBytes;
  let summary;
  let counts;              // R1 gate input (was discarded)
  let subjectSheetStatus;  // R1 gate input (was discarded)
  let subjectList;         // R1 gate input (was discarded)
  try {
    // 4. Story (Sonnet).
    const { story, usage } = await generateStory(input);

    // 5. Meta object generateBook consumes.
    const meta = buildMetaObject(input, story, usage);

    // 6. Book (sheets + per-page render + merge). No emitStatus — the worker
    //    uses pipeline_jobs as canonical state. resolveImageOverride is null in
    //    production (real Gemini); tests may replay fixture images.
    const result = await generateBook({
      story,
      meta,
      childName: input.child.name,
      childAge: input.child.age,
      outputDir: scratchDir,
      resolveImageOverride,
    });

    bookPdfBytes = result.bookPdfBytes;
    summary = { ...result.summary, tokens: usage };
    counts = result.counts;
    subjectSheetStatus = result.subjectSheetStatus;
    subjectList = result.subjectList;
  } finally {
    // Always clean the scratch dir; never let a cleanup failure mask the real
    // outcome (the PDF bytes are already in memory by this point).
    try {
      await fsp.rm(scratchDir, { recursive: true, force: true });
    } catch (cleanupError) {
      console.warn(`Scratch dir cleanup failed (${scratchDir}): ${cleanupError.message}`);
    }
  }

  // R1 completeness gate (replaces the bare `!bookPdfBytes` existence check).
  // Throws IncompletePipelineError on a degraded/empty book → handler onFailure
  // → markFailed. A book only proceeds to upload + awaiting_review if complete.
  assertBookComplete({ bookPdfBytes, counts, subjectSheetStatus, subjectList });

  // 7. Upload to Storage → 7-day signed URL.
  const { pdfUrl, storagePath } = await uploadBookPdf({ orderId, pdfBytes: bookPdfBytes });

  return {
    pdfUrl,
    metadata: { ...summary, storagePath },
  };
}
