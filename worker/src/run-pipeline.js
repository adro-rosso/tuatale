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
import { downloadPhoto } from "./preview.js";
import { uploadBookPdf as realUploadBookPdf } from "./storage.js";
import { getOrderById as realGetOrderById } from "./db.js";
import { IncompletePipelineError } from "./incomplete-pipeline-error.js";
import {
  restoreCheckpoint as realRestoreCheckpoint,
  pushCheckpoint as realPushCheckpoint,
  clearCheckpoint as realClearCheckpoint,
} from "./checkpoint.js";
import { dominantCause } from "./resume-policy.js";

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
export function assertBookComplete({ bookPdfBytes, counts, subjectSheetStatus, subjectList, failureCause = null }) {
  // R3b: bake the underlying cause (RESOURCE_EXHAUSTED / wall_ceiling, from
  // result.perPageResults) into the message so the resume classifier can route
  // credit→park vs latency→resume (onFailure only sees the serialized message).
  const causeSuffix = failureCause ? `; cause: ${failureCause}` : "";

  // Floor: no bytes at all (the sheets-only / protagonist-throw path returns null).
  if (!bookPdfBytes || bookPdfBytes.length === 0) {
    throw new IncompletePipelineError({
      failedPages: counts?.failed ?? null,
      missingSheets: [],
      reason: `no PDF bytes produced${causeSuffix}`,
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
    throw new IncompletePipelineError({ failedPages, missingSheets, reason: parts.join("; ") + causeSuffix });
  }
}

/**
 * Build the `meta` object generateBook expects. generateBook reads
 * meta.inputs.child.{gender,appearance} and meta.inputs.secondaries[]; the rest
 * is carried for provenance. Mirrors what the CLI shim builds from story.json +
 * argv.
 */
/**
 * R3a + photo-anchor (2026-07-17). On RESUME, `meta` is restored from the checkpoint,
 * so its inputs carry the photo paths from the PREVIOUS attempt's scratch dir — which
 * that attempt's cleanup deleted. downloadSubjectPhotos has just re-downloaded this
 * run's photos into THIS scratch dir and rewritten `input`, so re-point the restored
 * meta at those fresh objects. book-pipeline reads meta (not input), so without this
 * it dereferences files this run never wrote.
 *
 * Before the fail-loud guard this was invisible: the mint warned "photo unreadable"
 * and shipped a likeness-free book. Now it would throw — this keeps it correct instead.
 * Surgical on purpose: only inputs.child/secondaries are re-pointed, so anything else
 * the checkpointed meta accumulated (e.g. bookGeneration) survives. Mutates in place.
 */
export function syncPhotoPathsIntoMeta(input, meta) {
  if (!meta?.inputs) return meta;
  meta.inputs.child = input.child;
  meta.inputs.secondaries = input.secondaries;
  return meta;
}

export function buildMetaObject(input, story, usage) {
  return {
    inputs: {
      child: input.child,
      secondaries: input.secondaries,
      theme: input.theme,
      ageRange: input.ageRange,
      reading_level: input.reading_level,
    },
    story: { title: story?.title ?? null },
    generatedAt: new Date().toISOString(),
    usage,
  };
}

/**
 * Photo-anchor plumbing (probe, 2026-07-07). For each subject (primary + each
 * secondary) whose adapter set a Storage `photoPath`, download the bytes from the
 * previews bucket into <scratch>/photos/<key>.png and rewrite photoPath to that
 * local file — so book-pipeline's per-subject photo anchor reads a real file.
 *
 * FAIL LOUD (2026-07-17): a failed download used to degrade silently to composed
 * appearance — which ships a personalised book with a STRANGER'S face and no
 * failure signal. A subject specified WITH a photo must render with that photo or
 * the job must fail; the resume/retry controller classifies a transient blip as
 * resumable. Partial multi-photo loss still degrades (the remaining photos anchor).
 */
async function downloadSubjectPhotos(input, scratchDir, deps = {}) {
  const dl = deps.downloadPhoto ?? downloadPhoto;
  const photoDir = path.join(scratchDir, "photos");
  const one = async (subject, key) => {
    // Multi-photo anchor (pet-hero): download every photo_paths entry → local files
    // and rewrite the array to local paths (book-pipeline reads child.photo_paths).
    if (Array.isArray(subject?.photo_paths) && subject.photo_paths.length) {
      const requested = subject.photo_paths.filter(Boolean).length;
      const locals = [];
      for (let j = 0; j < subject.photo_paths.length; j++) {
        const sp = subject.photo_paths[j];
        if (!sp) continue;
        try {
          const buf = await dl(sp);
          await fsp.mkdir(photoDir, { recursive: true });
          const local = path.join(photoDir, `${key}-${j + 1}.png`);
          await fsp.writeFile(local, buf);
          locals.push(local);
          console.log(`  📷 photo-anchor: ${subject.name} ← ${sp} → ${path.basename(local)} (${buf.length} bytes)`);
        } catch (e) {
          console.warn(`  ⚠ photo download failed for ${subject.name} (${sp}); skipping this ref: ${e.message}`);
        }
      }
      // Partial loss is survivable (the remaining photos still anchor view-0); losing
      // ALL of them is not — that would silently mint a generic likeness.
      if (!locals.length) {
        throw new Error(
          `all ${requested} photo download(s) failed for ${subject.name} — refusing to render a likeness-free book`,
        );
      }
      subject.photo_paths = locals;
      return;
    }
    // Single legacy photoPath (child-photo probe / human secondaries).
    const storagePath = subject?.photoPath;
    if (!storagePath) return;
    try {
      const buf = await dl(storagePath);
      await fsp.mkdir(photoDir, { recursive: true });
      const local = path.join(photoDir, `${key}.png`);
      await fsp.writeFile(local, buf);
      subject.photoPath = local;
      console.log(`  📷 photo-anchor: ${subject.name} ← ${storagePath} → ${path.basename(local)} (${buf.length} bytes)`);
    } catch (e) {
      throw new Error(
        `photo download failed for ${subject.name} (${storagePath}): ${e.message} — refusing to render a likeness-free book`,
      );
    }
  };
  await one(input.child, "child");
  const secs = Array.isArray(input.secondaries) ? input.secondaries : [];
  for (let i = 0; i < secs.length; i++) await one(secs[i], secs[i].id || `companion-${i + 1}`);
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
    restoreCheckpoint = realRestoreCheckpoint,
    pushCheckpoint = realPushCheckpoint,
    clearCheckpoint = realClearCheckpoint,
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

  // Photo-anchor plumbing (probe, 2026-07-07): the adapter set `photoPath` to a
  // Supabase Storage path for any subject with an uploaded photo, but book-pipeline
  // reads a LOCAL file (fs.readFileSync). Download each into the scratch dir and
  // rewrite photoPath to the local path so view-0 mints photo-anchored.
  await downloadSubjectPhotos(input, scratchDir);

  // R3a: if a prior attempt of this job left a checkpoint, restore story + meta +
  // completed sheets into the fresh scratch dir and SKIP generateStory — so
  // generateBook's fingerprint reuse mints only the MISSING sheets. (Restoring the
  // story is essential: a re-gen'd story would change the sheet fingerprints and
  // force a full re-mint.)
  const restored = await restoreCheckpoint({ jobId, scratchDir });

  // story/meta held in outer scope so the catch can checkpoint them on failure.
  let story = restored?.story ?? null;
  let meta = restored?.meta ?? null;
  let usage = restored?.meta?.usage ?? null;
  let spendThisRun = 0; // R3b: this attempt's Gemini cost, accumulated into the checkpoint
  try {
    // 4. Story (Sonnet) — skipped on resume (reuse the checkpointed story).
    if (!restored) {
      const gen = await generateStory(input);
      story = gen.story;
      usage = gen.usage;
      meta = buildMetaObject(input, gen.story, gen.usage);
    } else {
      // Re-point the restored meta at THIS run's freshly downloaded photos; the
      // checkpointed paths belong to the previous (deleted) scratch dir.
      syncPhotoPathsIntoMeta(input, meta);
    }

    // KEEP_SCRATCH (local dev): persist story.json + meta.json to the scratch dir
    // so the review-station cockpit can load a worker-generated book (it requires
    // story.json). Prod never sets KEEP_SCRATCH. (2026-07-08)
    if (process.env.KEEP_SCRATCH === "1") {
      await fsp.writeFile(path.join(scratchDir, "story.json"), JSON.stringify(story, null, 2)).catch(() => {});
      await fsp.writeFile(path.join(scratchDir, "meta.json"), JSON.stringify(meta, null, 2)).catch(() => {});
    }

    // 5. Book (sheets + per-page render + merge). resolveImageOverride is null in
    //    production; restored sheets are skipped by generateBook's fingerprint reuse.
    const result = await generateBook({
      story,
      meta,
      childName: input.child.name,
      childAge: input.child.age,
      outputDir: scratchDir,
      dedicationMessage: input.dedicationMessage ?? null,
      resolveImageOverride,
    });
    spendThisRun = result.totalCost ?? 0;

    // 6. R1 completeness gate — INSIDE the try (R3a) so a degraded book throws
    //    while scratch still holds the completed sheets for checkpointing. R3b:
    //    bake the dominant failure cause in so onFailure routes credit vs latency.
    assertBookComplete({
      bookPdfBytes: result.bookPdfBytes,
      counts: result.counts,
      subjectSheetStatus: result.subjectSheetStatus,
      subjectList: result.subjectList,
      failureCause: dominantCause(result.perPageResults),
    });

    // 7. Complete → upload + drop the checkpoint (work is done).
    const { pdfUrl, storagePath } = await uploadBookPdf({ orderId, pdfBytes: result.bookPdfBytes });
    await clearCheckpoint({ jobId }).catch((e) => console.warn(`clearCheckpoint failed (${jobId}): ${e.message}`));

    return { pdfUrl, metadata: { ...result.summary, tokens: usage, storagePath } };
  } catch (err) {
    // R3a: persist story + meta + completed sheets BEFORE scratch is deleted, so
    // the next attempt resumes instead of re-minting. Best-effort — a checkpoint
    // failure must not mask the real error. (R3b decides resumable vs terminal;
    // R3a just preserves the work.)
    if (story && meta) {
      try {
        await pushCheckpoint({ jobId, scratchDir, story, meta, spendDelta: spendThisRun });
      } catch (ckptErr) {
        console.warn(`pushCheckpoint failed (${jobId}): ${ckptErr.message}`);
      }
    }
    throw err;
  } finally {
    // Always clean the scratch dir (bytes are safe in Storage if checkpointed).
    // KEEP_SCRATCH=1 (LOCAL DEV ONLY): persist the scratch dir so the review-station
    // cockpit can load the per-page book dir for a worker-generated book. Prod never
    // sets it → cleanup still runs. (2026-07-07)
    if (process.env.KEEP_SCRATCH === "1") {
      console.log(`  KEEP_SCRATCH: leaving scratch dir for review → ${scratchDir}`);
    } else {
      try {
        await fsp.rm(scratchDir, { recursive: true, force: true });
      } catch (cleanupError) {
        console.warn(`Scratch dir cleanup failed (${scratchDir}): ${cleanupError.message}`);
      }
    }
  }
}
