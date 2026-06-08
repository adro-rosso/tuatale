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
import { markRunning, markAwaitingReview, markFailed } from "./db.js";

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

/** onFailure — after retries exhaust. Original event is nested at event.data.event. */
async function runPipelineJobOnFailure({ event, error, runId }) {
  const jobId = event?.data?.event?.data?.jobId;
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
      errorDetails: { name: error?.name, message: error?.message, stack: error?.stack, inngestRunId: runId },
    });
  } catch (markErr) {
    console.error("[runPipelineJob.onFailure] markFailed threw", { jobId, runId, markErr });
  }
}

export const runPipelineJob = inngest.createFunction(
  {
    id: "run-pipeline-job",
    name: "Run Pipeline Job",
    retries: 2,
    concurrency: { limit: 1 },
    triggers: [{ event: "pipeline/job.requested" }, { event: "pipeline/job.retried" }],
    onFailure: runPipelineJobOnFailure,
  },
  async ({ event, step, runId }) => {
    const { jobId, orderId } = event.data;

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
      res.end(JSON.stringify({ ok: !dead, state, version: process.env.SENTRY_RELEASE ?? null }));
    } else {
      res.writeHead(404);
      res.end();
    }
  });
}

// ---- Entry point ----------------------------------------------------------
export async function start() {
  const connection = await connect({
    apps: [{ client: inngest, functions: [runPipelineJob] }],
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
