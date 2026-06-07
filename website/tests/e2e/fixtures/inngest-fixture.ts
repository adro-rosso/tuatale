/**
 * Simulates the Track B pipeline worker's effect on a pipeline_jobs row,
 * WITHOUT running the real pipeline.
 *
 * Before Track B (Cycle A.2–A.6) the pipeline was a stub Inngest function that
 * lived in the website and the e2e invoked its handler directly. Track B moved
 * the real pipeline onto the Fly.io worker, which runs for ~25-35 min and costs
 * real money — far too slow/expensive for an e2e. The real pipeline is covered
 * by the worker's own test suite (worker/tests/*). What the full-funnel e2e
 * still needs to verify is the WEBSITE chain around it: webhook → order + job →
 * (job reaches awaiting_review with a real PDF) → admin review → ship → email.
 *
 * So this fixture reproduces exactly the DB transitions the worker performs
 * (markRunning → markAwaitingReview), landing the job at awaiting_review with a
 * real-shaped pdf_url. It writes through @/db/pipeline-jobs to whatever DB the
 * test process env points at (tuatale-test) — same path the old handler used.
 */
import { randomUUID } from 'node:crypto';
import { markRunning, markAwaitingReview } from '@/db/pipeline-jobs';

export interface InvokeRunPipelineJobInput {
  jobId: string;
  orderId: string;
  /** Overrides the simulated PDF URL; defaults to a real-shaped test URL. */
  pdfUrl?: string;
}

export interface InvokeRunPipelineJobResult {
  jobId: string;
  orderId: string;
  status: string;
}

export async function invokeRunPipelineJob(
  input: InvokeRunPipelineJobInput,
): Promise<InvokeRunPipelineJobResult> {
  const suffix = randomUUID().replace(/-/g, '').slice(0, 12);
  const pdfUrl =
    input.pdfUrl ?? `https://r2.tuatale.test/orders/${input.orderId}/book.pdf`;

  // 1. pending → running (the worker's "mark-running" step).
  await markRunning(input.jobId, {
    inngestEventId: `evt_e2e_${suffix}`,
    inngestRunId: `run_e2e_${suffix}`,
  });

  // 2. running → awaiting_review with a real-shaped PDF URL + metadata
  //    (the worker's "mark-awaiting-review" step).
  const job = await markAwaitingReview(input.jobId, {
    pdfUrl,
    generationMetadata: { e2e: true, simulated: true },
  });

  return { jobId: input.jobId, orderId: input.orderId, status: job.status };
}
