// worker/src/server.js — long-running worker using Inngest CONNECT (WebSocket).
//
// B.6 fix: the original HTTP `serve()` model executes each step as a separate
// HTTP request bounded by Inngest's per-step request timeout (~10s free / 60s
// paid). Our runPipeline runs ~6.5 min as a single step, which blows that
// ceiling — Inngest gave up and fired onFailure→markFailed even though the
// worker finished + uploaded the PDF (the production false-failure on order
// 28d052b6). Inngest Connect opens an outbound WebSocket so step execution is
// NOT bound by HTTP timeouts — purpose-built for long-running containerized
// workers like this one. The function + handler are unchanged from the HTTP
// version (the execute-pipeline step.run is kept for result caching).
//
// No inbound /api/inngest endpoint anymore. We run a tiny node:http server only
// for Fly's /health liveness check (reports the Connect connection state).
//
// Registration: Connect AUTO-SYNCS — when this worker connects, its functions
// register with the `tuatale` app. The website keeps SENDING events
// (INNGEST_EVENT_KEY); Inngest routes them to the connected worker.

import { createServer } from "node:http";
import { pathToFileURL } from "node:url";
import * as Sentry from "@sentry/node";
import { Inngest } from "inngest";
import { connect, ConnectionState } from "inngest/connect";
import { runPipeline } from "./run-pipeline.js";
import { markRunning, markAwaitingReview, getJobById as realGetJobById } from "./db.js";
import { regenerateSignedUrl as realRegenerateSignedUrl, bookPdfPath as realBookPdfPath } from "./storage.js";
import { runPreview, markPreviewFailed } from "./preview.js";
import { notifyRecovery } from "./notify-recovery.js";
import { handlePipelineFailure, resumeSweep } from "./resume-controller.js";

// ---- Sentry (optional; shared project, release-tagged) --------------------
const sentryEnabled = Boolean(process.env.SENTRY_DSN);
if (sentryEnabled) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV || "production",
    release: process.env.SENTRY_RELEASE,
    tracesSampleRate: 0,
  });
}

// ---- Inngest client + function --------------------------------------------
// SAME app id as the website's client. INNGEST_SIGNING_KEY + INNGEST_EVENT_KEY
// are read from the environment (Connect authenticates the WS with the signing
// key). INNGEST_DEV=1 routes to a local dev server.
export const inngest = new Inngest({ id: "tuatale" });

/**
 * onFailure — after the (now 1) retry exhausts. R3b: hand to the resume controller,
 * which classifies the failure and either parks it for resume (transient → resumable
 * + next_retry_at; RESOURCE_EXHAUSTED → blocked_on_credits) with an ops-alert only,
 * or — when terminal (deterministic / 5-day window / spend cap) — markFailed + the
 * full customer recovery (terminal:true). Original event nested at event.data.event.
 */
async function runPipelineJobOnFailure({ event, error, runId }) {
  const jobId = event?.data?.event?.data?.jobId;
  const orderId = event?.data?.event?.data?.orderId;
  if (!jobId) {
    console.error("[runPipelineJob.onFailure] no jobId in original event", { runId, eventName: event?.data?.event?.name });
    return;
  }
  try {
    const { failureClass, decision } = await handlePipelineFailure({ jobId, orderId, error });
    console.log(`[runPipelineJob.onFailure] ${jobId}: ${failureClass} → ${decision.kind} (${decision.reason})`);
  } catch (e) {
    console.error("[runPipelineJob.onFailure] handlePipelineFailure threw", { jobId, runId, error: e?.message });
  }
}

/**
 * Stage 1a-i: detect a KNOWN-GOOD already-generated book so a re-fire / manual
 * retry can short-circuit BEFORE mark-running clears the job's pdf_url + metadata.
 * Returns { pdfUrl, metadata } with a FRESH signed URL (the stored one may be
 * expired), or null when there's nothing safe to re-use. Known-good = the job has a
 * pdf_url AND its recorded generation had zero failed pages (a degraded PDF is NOT
 * re-served). Deps injectable for unit tests. Never re-charges the customer — the
 * pipeline makes no Stripe call; this only avoids re-spending Sonnet+Gemini COGS.
 */
export async function findReusableBook(jobId, orderId, deps = {}) {
  const {
    getJobById = realGetJobById,
    regenerateSignedUrl = realRegenerateSignedUrl,
    bookPdfPath = realBookPdfPath,
  } = deps;
  let job;
  try {
    job = await getJobById(jobId);
  } catch {
    return null; // no row (getJobById uses .single()) / transient error → regenerate normally
  }
  if (!job?.pdf_url || job?.generation_metadata?.pages?.failed !== 0) return null;
  const storagePath = bookPdfPath(orderId);
  const pdfUrl = await regenerateSignedUrl(storagePath);
  return { pdfUrl, metadata: { ...(job.generation_metadata ?? {}), storagePath, reused: true } };
}

export const runPipelineJob = inngest.createFunction(
  {
    id: "run-pipeline-job",
    name: "Run Pipeline Job",
    retries: 1, // R3b: the resume cron owns the minutes-to-days cadence; 1 fast retry catches a blip
    concurrency: { limit: 1 },
    triggers: [{ event: "pipeline/job.requested" }, { event: "pipeline/job.retried" }],
    onFailure: runPipelineJobOnFailure,
  },
  async ({ event, step, runId }) => {
    const { jobId, orderId } = event.data;

    // Stage 1a-i: short-circuit a KNOWN-GOOD completed job BEFORE mark-running
    // clears its pdf_url + generation_metadata. Recovers a stuck-but-good job
    // (e.g. the B.6 false-failure on 28d052b6) straight to awaiting_review with a
    // fresh signed URL — no mark-running, no re-mint, no Gemini/Sonnet spend.
    const reuse = await step.run("idempotency-check", async () =>
      findReusableBook(jobId, orderId),
    );
    if (reuse) {
      await step.run("mark-awaiting-review-reused", async () =>
        markAwaitingReview(jobId, { pdfUrl: reuse.pdfUrl, generationMetadata: reuse.metadata }),
      );
      return { jobId, orderId, status: "awaiting_review", pdfUrl: reuse.pdfUrl, reused: true };
    }

    await step.run("mark-running", async () =>
      markRunning(jobId, { inngestEventId: event.id, inngestRunId: runId }),
    );

    // The heavy ~6.5-min pipeline run. Wrapped in step.run so its small
    // {pdfUrl, metadata} result is cached — a transient failure in
    // mark-awaiting-review won't re-run the render. Under Connect this step is
    // NOT bound by an HTTP request timeout (the whole point of B.6).
    const result = await step.run("execute-pipeline", async () =>
      runPipeline({ orderId, jobId }),
    );

    await step.run("mark-awaiting-review", async () =>
      markAwaitingReview(jobId, { pdfUrl: result.pdfUrl, generationMetadata: result.metadata }),
    );

    return { jobId, orderId, status: "awaiting_review", pdfUrl: result.pdfUrl };
  },
);

// ---- Preview function (S-C: whole-character preview generation) ------------
// Lightweight sibling of runPipelineJob: ONE mint (~10-15s), not the ~6.5-min
// book. Higher concurrency (previews are cheap + interactive); 1 retry. runPreview
// marks the preview_jobs row done/failed itself; onFailure is the terminal backstop.
async function runPreviewJobOnFailure({ event, error, runId }) {
  const previewId = event?.data?.event?.data?.previewId;
  if (!previewId) {
    console.error("[runPreviewJob.onFailure] no previewId", { runId });
    return;
  }
  try {
    await markPreviewFailed(previewId, { errorMessage: error?.message ?? "preview failed" });
  } catch (markErr) {
    console.error("[runPreviewJob.onFailure] markPreviewFailed threw", { previewId, runId, markErr });
  }
  // R2: preview = pre-purchase, no charge → OPS-ALERT ONLY (no refund/customer
  // email). The credit-depletion flag here is what catches a RESOURCE_EXHAUSTED
  // incident surfacing through previews.
  await notifyRecovery({
    source: "preview",
    previewId,
    error: { message: error?.message, kind: error?.kind ?? error?.name },
  });
}

export const runPreviewJob = inngest.createFunction(
  {
    id: "run-preview-job",
    name: "Run Character Preview",
    retries: 1,
    concurrency: { limit: 3 },
    triggers: [{ event: "preview/requested" }],
    onFailure: runPreviewJobOnFailure,
  },
  async ({ event }) =>
    // Single step: the mint + upload + row-update. runPreview is self-contained and
    // marks the row, so we don't split it (no expensive intermediate to cache).
    runPreview(event.data),
);

// ---- Resume cron (R3b) — verified to fire under Connect --------------------
// Every 15 min: re-enqueue due resumable jobs (pipeline/job.retried) + probe-flip
// credit-parked jobs back to resumable when the API recovers. resumeSweep holds the
// logic; we inject the inngest sender so it stays I/O-free + unit-tested.
export const resumeCron = inngest.createFunction(
  { id: "resume-cron", name: "Resume Controller (R3b)", triggers: [{ cron: "*/15 * * * *" }] },
  async () =>
    resumeSweep({
      sendRetried: ({ jobId, orderId }) =>
        inngest.send({ name: "pipeline/job.retried", data: { jobId, orderId } }),
    }),
);

// ---- Health server (liveness for Fly) -------------------------------------
// Returns 200 unless the connection is terminally CLOSED/CLOSING, so transient
// RECONNECTING/CONNECTING states (the SDK auto-reconnects) don't cause Fly to
// flap the machine. `getState` is injected for testability.
export function createHealthServer(getState) {
  return createServer((req, res) => {
    const url = (req.url || "").split("?")[0];
    if (url === "/health" || url === "/ready" || url === "/") {
      const state = getState();
      const dead = state === ConnectionState.CLOSED || state === ConnectionState.CLOSING;
      res.writeHead(dead ? 503 : 200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        ok: !dead,
        state,
        version: process.env.SENTRY_RELEASE ?? null,
        // B.1: surface the front-matter flag so its live state is verifiable in prod.
        frontMatter: process.env.FEATURES_FRONTMATTER === "on",
      }));
    } else {
      res.writeHead(404);
      res.end();
    }
  });
}

// ---- Entry point ----------------------------------------------------------
export async function start() {
  const connection = await connect({
    apps: [{ client: inngest, functions: [runPipelineJob, runPreviewJob, resumeCron] }],
    instanceId: process.env.FLY_MACHINE_ID || process.env.HOSTNAME || "tuatale-worker",
    handleShutdownSignals: ["SIGTERM", "SIGINT"],
  });

  const server = createHealthServer(() => connection.state);
  const port = process.env.PORT || 8080;
  server.listen(port, () => {
    console.log(`Tuatale worker: health server on :${port}; Inngest Connect state=${connection.state}`);
  });

  // Resolves when the connection is gracefully closed (SIGTERM/SIGINT).
  await connection.closed;
  server.close();
  console.log("Tuatale worker: connection closed, shutting down.");
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  start().catch((err) => {
    console.error("Tuatale worker failed to start:", err);
    process.exit(1);
  });
}
