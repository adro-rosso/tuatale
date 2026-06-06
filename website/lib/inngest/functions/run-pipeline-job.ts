/**
 * runPipelineJob — Inngest function that drives a pipeline_jobs row
 * through its lifecycle.
 *
 * Triggered by `pipeline/job.requested` (fresh job) or
 * `pipeline/job.retried` (admin re-trigger). Same handler for both
 * because the actual pipeline execution is the same; the only
 * difference is diagnostic context the retry event carries.
 *
 * Cycle A.2 STUB: this function sleeps for 20 seconds and then marks
 * the job as awaiting_review with a placeholder PDF URL. Track B +
 * integration will replace the sleep with the real DaBookTing
 * pipeline call.
 *
 * Three things to understand about the orchestration:
 *
 *   1. `step.run("name", fn)` results are CACHED by Inngest. If the
 *      function retries after `markRunning` succeeded but before
 *      `markAwaitingReview` finished, Inngest will skip re-running
 *      `markRunning` on the second attempt — we get idempotency for
 *      free without writing any reconciliation code.
 *
 *   2. `step.sleep` is durable: the function is paused server-side
 *      and resumes after the interval. If Inngest crashes during the
 *      sleep, it resumes when it comes back up.
 *
 *   3. `onFailure` runs AFTER retries are exhausted. We use it to
 *      mark the job 'failed' so the admin dashboard sees the dead
 *      job and can manually retry. Without onFailure, a permanent
 *      failure would leave the job stuck at 'running' forever.
 *
 * `retries: 2` means 1 initial attempt + 2 retries = 3 total. Cycle
 * A.6 may tune this once we have real pipeline failure data.
 *
 * `runPipelineJobHandler` and `runPipelineJobOnFailure` are exported
 * separately so unit tests can drive them with fake step/event/runId
 * mocks. The InngestFunction class doesn't expose its inner handler
 * publicly; pulling the logic out is the v4-idiomatic way to keep it
 * testable.
 */
import { inngest } from '@/lib/inngest/client';
import { pipelineJobRequested, pipelineJobRetried } from '@/lib/inngest/events';
import * as pipelineJobs from '@/db/pipeline-jobs';
import { STUB_PDF_URL, STUB_SLEEP_MS } from '@/lib/pipeline-constants';

// Re-export so existing call sites that imported these from this
// module keep working. New code should import from
// @/lib/pipeline-constants directly to avoid pulling the Inngest
// client transitively.
export { STUB_PDF_URL, STUB_SLEEP_MS };

interface PipelineEventData {
  jobId: string;
  orderId: string;
  // retried-only:
  previousAttemptCount?: number;
  retryReason?: string;
}

interface StepTools {
  run: <T>(id: string, fn: () => Promise<T>) => Promise<T>;
  sleep: (id: string, ms: number) => Promise<void>;
}

interface PipelineHandlerArgs {
  event: {
    id?: string;
    name: string;
    data: PipelineEventData;
  };
  step: StepTools;
  runId: string;
}

export async function runPipelineJobHandler({ event, step, runId }: PipelineHandlerArgs): Promise<{
  jobId: string;
  orderId: string;
  status: string;
  stubbed: true;
}> {
  const { jobId, orderId } = event.data;

  await step.run('mark-running', async () => {
    return pipelineJobs.markRunning(jobId, {
      inngestEventId: event.id,
      inngestRunId: runId,
    });
  });

  // STUB: real pipeline integration lives here (Track B + later cycle).
  // step.sleep is durable, so a server restart during the sleep
  // resumes correctly when Inngest reschedules.
  await step.sleep('stub-pipeline-work', STUB_SLEEP_MS);

  const completed = await step.run('mark-awaiting-review', async () => {
    return pipelineJobs.markAwaitingReview(jobId, {
      pdfUrl: STUB_PDF_URL,
      generationMetadata: {
        stub: true,
        stubSleepMs: STUB_SLEEP_MS,
        eventName: event.name,
        // The retried event carries the prior attempt count for
        // diagnostic context — pluck it for the metadata blob.
        previousAttemptCount:
          event.name === 'pipeline/job.retried' ? (event.data.previousAttemptCount ?? 0) : 0,
      },
    });
  });

  return {
    jobId,
    orderId,
    status: completed.status,
    stubbed: true,
  };
}

interface OnFailureArgs {
  event: {
    data: {
      event: {
        name: string;
        data: { jobId?: string };
      };
    };
  };
  error: {
    name?: string;
    message?: string;
    stack?: string;
  };
  runId: string;
}

export async function runPipelineJobOnFailure({
  event,
  error,
  runId,
}: OnFailureArgs): Promise<void> {
  const originalData = event.data.event.data;
  const jobId = originalData?.jobId;
  if (!jobId) {
    console.error('[runPipelineJob.onFailure] no jobId in original event', {
      runId,
      eventName: event.data.event.name,
    });
    return;
  }
  try {
    await pipelineJobs.markFailed(jobId, {
      errorMessage: error.message ?? 'Unknown failure',
      errorDetails: {
        name: error.name,
        message: error.message,
        stack: error.stack,
        inngestRunId: runId,
      },
    });
  } catch (markErr) {
    // markFailed itself can throw (e.g. invalid status transition if
    // the job somehow advanced past 'running' between retries). Log
    // and swallow — Inngest will keep this onFailure result visible
    // in its UI, which is enough for admin recovery.
    console.error('[runPipelineJob.onFailure] markFailed threw', {
      jobId,
      runId,
      markErr,
    });
  }
}

export const runPipelineJob = inngest.createFunction(
  {
    id: 'run-pipeline-job',
    name: 'Run Pipeline Job',
    retries: 2,
    triggers: [{ event: pipelineJobRequested }, { event: pipelineJobRetried }],
    onFailure: runPipelineJobOnFailure,
  },
  runPipelineJobHandler,
);
