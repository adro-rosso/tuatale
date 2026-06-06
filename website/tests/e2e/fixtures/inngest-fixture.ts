/**
 * Invokes the runPipelineJobHandler directly with a fake step API,
 * bypassing real Inngest cloud dispatch. The handler runs in the
 * test process and writes to whatever DB the test process's env
 * points at (tuatale-test, via playwright config + the test runner
 * env).
 *
 * The Cycle A.2 unit tests already exercise the orchestration logic
 * with mocked pipelineJobs helpers; this fixture is the e2e
 * equivalent that lets the handler write through to a real DB so
 * the full-funnel test can assert on the resulting rows.
 *
 * skipSleep defaults to true so the e2e doesn't wait 20 seconds for
 * the Cycle A.2 stub sleep. The DB transitions still happen in real
 * time.
 */
import { randomUUID } from 'node:crypto';
import { runPipelineJobHandler } from '@/lib/inngest/functions/run-pipeline-job';

export interface InvokeRunPipelineJobInput {
  jobId: string;
  orderId: string;
  /** Default true — the e2e doesn't want to wait 20s for the stub sleep. */
  skipSleep?: boolean;
  /** Default 'pipeline/job.requested'. Use 'pipeline/job.retried' for retry-path tests. */
  eventName?: 'pipeline/job.requested' | 'pipeline/job.retried';
}

export interface InvokeRunPipelineJobResult {
  jobId: string;
  orderId: string;
  status: string;
  stubbed: true;
}

interface FakeStepCall {
  type: 'run' | 'sleep';
  id: string;
  ms?: number;
}

export async function invokeRunPipelineJob(
  input: InvokeRunPipelineJobInput,
): Promise<InvokeRunPipelineJobResult> {
  const skipSleep = input.skipSleep ?? true;
  const eventName = input.eventName ?? 'pipeline/job.requested';
  const calls: FakeStepCall[] = [];

  const step = {
    async run<T>(id: string, fn: () => Promise<T>): Promise<T> {
      calls.push({ type: 'run', id });
      return fn();
    },
    async sleep(id: string, ms: number): Promise<void> {
      calls.push({ type: 'sleep', id, ms });
      if (!skipSleep) {
        await new Promise((resolve) => setTimeout(resolve, ms));
      }
    },
  };

  const eventData =
    eventName === 'pipeline/job.retried'
      ? {
          jobId: input.jobId,
          orderId: input.orderId,
          previousAttemptCount: 0,
          retryReason: 'e2e fixture invocation',
        }
      : { jobId: input.jobId, orderId: input.orderId };

  return runPipelineJobHandler({
    event: {
      id: `evt_e2e_${randomUUID().replace(/-/g, '').slice(0, 12)}`,
      name: eventName,
      data: eventData,
    },
    step,
    runId: `run_e2e_${randomUUID().replace(/-/g, '').slice(0, 12)}`,
  });
}
