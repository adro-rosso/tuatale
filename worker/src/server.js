// worker/src/server.js — the Fly.io worker's HTTP server + Inngest endpoint.
//
// Serves the `run-pipeline-job` Inngest function that, until B.5, lived as a
// stub on Vercel. Same app id ("tuatale") + same signing key as the website's
// Inngest client, so re-registering is purely an endpoint-URL change (B.5.6) —
// the website keeps sending events; this worker now executes them.
//
// The function chains three phases (mirroring the Track A stub's contract):
//   1. markRunning            (durable step — cached across retries)
//   2. runPipeline            (the heavy work: Sonnet + Gemini + Puppeteer)
//   3. markAwaitingReview     (durable step)
// onFailure (after retries exhaust) → markFailed.
//
// app is exported for tests (supertest drives it without binding a port); the
// server only calls app.listen when this file is the process entry point.

import { pathToFileURL } from "node:url";
import express from "express";
import { Inngest } from "inngest";
import { serve } from "inngest/express";
import * as Sentry from "@sentry/node";
import { runPipeline } from "./run-pipeline.js";
import { markRunning, markAwaitingReview, markFailed } from "./db.js";

// ---- Sentry (optional; single project shared with the website, distinguished
//      by SENTRY_RELEASE) ------------------------------------------------------
const sentryEnabled = Boolean(process.env.SENTRY_DSN);
if (sentryEnabled) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV || "production",
    release: process.env.SENTRY_RELEASE, // set by the Docker build arg
    tracesSampleRate: 0, // no tracing for v1
  });
}

// ---- Inngest client + function --------------------------------------------
// SAME app id as website/lib/inngest/client.ts. INNGEST_EVENT_KEY +
// INNGEST_SIGNING_KEY are read from the environment automatically.
export const inngest = new Inngest({ id: "tuatale" });

/**
 * onFailure — fires once Inngest exhausts retries. The original event is nested
 * at event.data.event (this handler receives the inngest/function.failed event).
 */
async function runPipelineJobOnFailure({ event, error, runId }) {
  const originalData = event?.data?.event?.data;
  const jobId = originalData?.jobId;
  if (!jobId) {
    console.error("[runPipelineJob.onFailure] no jobId in original event", {
      runId,
      eventName: event?.data?.event?.name,
    });
    return;
  }
  try {
    await markFailed(jobId, {
      errorMessage: error?.message ?? "Unknown pipeline failure",
      errorDetails: {
        name: error?.name,
        message: error?.message,
        stack: error?.stack,
        inngestRunId: runId,
      },
    });
  } catch (markErr) {
    // markFailed itself can throw (e.g. illegal transition). Log + swallow —
    // Inngest keeps the onFailure result visible for manual admin recovery.
    console.error("[runPipelineJob.onFailure] markFailed threw", { jobId, runId, markErr });
  }
}

// inngest v4: createFunction is (config, handler). Triggers + concurrency +
// onFailure all live in the config object; `runId` comes from the handler
// context (NOT step.runId). Raw event-name strings avoid importing the
// website's typed event defs.
export const runPipelineJob = inngest.createFunction(
  {
    id: "run-pipeline-job",
    name: "Run Pipeline Job",
    retries: 2,
    concurrency: { limit: 1 },
    triggers: [
      { event: "pipeline/job.requested" },
      { event: "pipeline/job.retried" },
    ],
    onFailure: runPipelineJobOnFailure,
  },
  async ({ event, step, runId }) => {
    const { jobId, orderId } = event.data;

    // Phase 1 — mark running (durable + cached across retries).
    await step.run("mark-running", async () =>
      markRunning(jobId, { inngestEventId: event.id, inngestRunId: runId }),
    );

    // Phase 2 — the heavy pipeline run (Sonnet + Gemini + Puppeteer; ~25-35 min).
    // Deliberately NOT wrapped in step.run for v1: we first observe whether a
    // full book completes inside Inngest's default step window on the persistent
    // worker (the B.2 known-unknown). Tradeoff: a transient failure in Phase 3
    // re-runs the whole render. If the ceiling bites OR the re-render waste
    // matters, the planned evolution is to wrap this in step.run (its small
    // {pdfUrl, metadata} return caches cleanly) and/or split per-page.
    const result = await runPipeline({ orderId, jobId });

    // Phase 3 — mark awaiting review (durable step).
    await step.run("mark-awaiting-review", async () =>
      markAwaitingReview(jobId, {
        pdfUrl: result.pdfUrl,
        generationMetadata: result.metadata,
      }),
    );

    return { jobId, orderId, status: "awaiting_review", pdfUrl: result.pdfUrl };
  },
);

// ---- Express app ----------------------------------------------------------
export const app = express();

app.get("/", (req, res) => {
  res.status(200).send("Tuatale worker is running.");
});

app.get("/health", (req, res) => {
  res.status(200).json({ ok: true, version: process.env.SENTRY_RELEASE ?? null });
});

// Inngest's express adapter reads the PARSED request body (req.body), so a JSON
// body parser MUST run before the mount — without it, sync/invoke requests fail
// with "Missing body when syncing, possibly due to missing request body
// middleware". 10mb accommodates large Inngest event/replay payloads (the
// default 100kb is too small for some replay scenarios).
app.use(express.json({ limit: "10mb" }));

// Inngest endpoint — GET (introspection/sync), POST (invocation), PUT (register).
app.use(
  "/api/inngest",
  serve({ client: inngest, functions: [runPipelineJob] }),
);

// Sentry error handler must come after routes.
if (sentryEnabled) {
  Sentry.setupExpressErrorHandler(app);
}

// ---- Listen (only when run as the process entry point) ---------------------
const isMain =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const PORT = process.env.PORT || 8080;
  app.listen(PORT, () => {
    console.log(`Tuatale worker listening on port ${PORT}`);
  });
}
