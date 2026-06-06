/**
 * Tests for runPipelineJob's handler logic + onFailure handler.
 *
 * Inngest functions are testable as plain async functions once you
 * extract the handler out of the createFunction wrapper. We mock the
 * db helpers at the module boundary so we're testing the
 * orchestration (which step runs in which order, what arguments DB
 * helpers receive, how the retry event is handled) — DB behaviour
 * itself is covered by Cycle A.1's integration tests.
 *
 * The fake step's `run(id, fn)` invokes fn immediately and returns
 * its result — that mirrors Inngest's behaviour on a first attempt
 * (no cached result yet). For retry-cache behaviour we'd need a
 * different mock; not exercised here.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { markRunningSpy, markAwaitingReviewSpy, markFailedSpy } = vi.hoisted(() => ({
  markRunningSpy: vi.fn(),
  markAwaitingReviewSpy: vi.fn(),
  markFailedSpy: vi.fn(),
}));

vi.mock('@/db/pipeline-jobs', () => ({
  markRunning: markRunningSpy,
  markAwaitingReview: markAwaitingReviewSpy,
  markFailed: markFailedSpy,
}));

import {
  runPipelineJobHandler,
  runPipelineJobOnFailure,
  STUB_PDF_URL,
  STUB_SLEEP_MS,
} from '@/lib/inngest/functions/run-pipeline-job';

interface StepCalls {
  run: Array<[string, () => Promise<unknown>]>;
  sleep: Array<[string, number]>;
}

// vi.fn's Mock type erases the generic on step.run (T -> unknown),
// which doesn't satisfy the StepTools interface's generic
// signature. Build the fake without vi.fn and track calls manually
// — vitest's call-introspection helpers aren't needed since we
// expose `calls` directly.
function fakeStep() {
  const calls: StepCalls = { run: [], sleep: [] };
  const step = {
    async run<T>(id: string, fn: () => Promise<T>): Promise<T> {
      calls.run.push([id, fn as () => Promise<unknown>]);
      return fn();
    },
    async sleep(id: string, ms: number): Promise<void> {
      calls.sleep.push([id, ms]);
    },
  };
  return { step, calls };
}

describe('runPipelineJobHandler', () => {
  beforeEach(() => {
    markRunningSpy.mockReset();
    markAwaitingReviewSpy.mockReset();
    markFailedSpy.mockReset();
    markRunningSpy.mockResolvedValue({ id: 'job-1', status: 'running' });
    markAwaitingReviewSpy.mockResolvedValue({
      id: 'job-1',
      status: 'awaiting_review',
    });
  });

  it('walks the job through mark-running → sleep → mark-awaiting-review', async () => {
    const { step, calls } = fakeStep();
    const result = await runPipelineJobHandler({
      event: {
        id: 'evt_abc',
        name: 'pipeline/job.requested',
        data: { jobId: 'job-1', orderId: 'order-1' },
      },
      step,
      runId: 'run_xyz',
    });

    expect(calls.run.map(([id]) => id)).toEqual(['mark-running', 'mark-awaiting-review']);
    expect(calls.sleep).toEqual([['stub-pipeline-work', STUB_SLEEP_MS]]);
    expect(result).toEqual({
      jobId: 'job-1',
      orderId: 'order-1',
      status: 'awaiting_review',
      stubbed: true,
    });
  });

  it('passes event id + runId through to markRunning so dashboards can correlate', async () => {
    const { step } = fakeStep();
    await runPipelineJobHandler({
      event: {
        id: 'evt_abc',
        name: 'pipeline/job.requested',
        data: { jobId: 'job-1', orderId: 'order-1' },
      },
      step,
      runId: 'run_xyz',
    });
    expect(markRunningSpy).toHaveBeenCalledWith('job-1', {
      inngestEventId: 'evt_abc',
      inngestRunId: 'run_xyz',
    });
  });

  it('passes STUB_PDF_URL + stub metadata to markAwaitingReview', async () => {
    const { step } = fakeStep();
    await runPipelineJobHandler({
      event: {
        id: 'evt_abc',
        name: 'pipeline/job.requested',
        data: { jobId: 'job-1', orderId: 'order-1' },
      },
      step,
      runId: 'run_xyz',
    });
    expect(markAwaitingReviewSpy).toHaveBeenCalledWith('job-1', {
      pdfUrl: STUB_PDF_URL,
      generationMetadata: {
        stub: true,
        stubSleepMs: STUB_SLEEP_MS,
        eventName: 'pipeline/job.requested',
        previousAttemptCount: 0,
      },
    });
  });

  it('captures previousAttemptCount from pipeline/job.retried events', async () => {
    const { step } = fakeStep();
    await runPipelineJobHandler({
      event: {
        id: 'evt_retry',
        name: 'pipeline/job.retried',
        data: {
          jobId: 'job-1',
          orderId: 'order-1',
          retryReason: 'admin manual retry',
          previousAttemptCount: 2,
        },
      },
      step,
      runId: 'run_xyz',
    });
    expect(markAwaitingReviewSpy.mock.calls[0]![1]!.generationMetadata).toMatchObject({
      eventName: 'pipeline/job.retried',
      previousAttemptCount: 2,
    });
  });

  it('propagates DB errors from markRunning so Inngest can retry', async () => {
    markRunningSpy.mockRejectedValue(new Error('Invalid status transition'));
    const { step } = fakeStep();
    await expect(
      runPipelineJobHandler({
        event: {
          id: 'evt_abc',
          name: 'pipeline/job.requested',
          data: { jobId: 'job-1', orderId: 'order-1' },
        },
        step,
        runId: 'run_xyz',
      }),
    ).rejects.toThrow(/Invalid status transition/);
    // Sleep + awaiting-review never reached.
    expect(markAwaitingReviewSpy).not.toHaveBeenCalled();
  });

  it('propagates DB errors from markAwaitingReview so Inngest can retry', async () => {
    markAwaitingReviewSpy.mockRejectedValue(new Error('PDF write failed'));
    const { step } = fakeStep();
    await expect(
      runPipelineJobHandler({
        event: {
          id: 'evt_abc',
          name: 'pipeline/job.requested',
          data: { jobId: 'job-1', orderId: 'order-1' },
        },
        step,
        runId: 'run_xyz',
      }),
    ).rejects.toThrow(/PDF write failed/);
    // markRunning DID run before the failure.
    expect(markRunningSpy).toHaveBeenCalled();
  });
});

describe('runPipelineJobOnFailure', () => {
  beforeEach(() => {
    markFailedSpy.mockReset();
  });

  it('marks the job failed with the exhausted error', async () => {
    markFailedSpy.mockResolvedValue({ id: 'job-1', status: 'failed' });
    await runPipelineJobOnFailure({
      event: {
        data: {
          event: {
            name: 'pipeline/job.requested',
            data: { jobId: 'job-1' },
          },
        },
      },
      error: {
        name: 'WallCeilingError',
        message: 'Gemini wall limit hit at attempt 3',
        stack: 'Error\n  at ...',
      },
      runId: 'run_fail_xyz',
    });

    expect(markFailedSpy).toHaveBeenCalledWith('job-1', {
      errorMessage: 'Gemini wall limit hit at attempt 3',
      errorDetails: expect.objectContaining({
        name: 'WallCeilingError',
        message: 'Gemini wall limit hit at attempt 3',
        inngestRunId: 'run_fail_xyz',
      }),
    });
  });

  it('logs + returns without throwing when original event has no jobId', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      await runPipelineJobOnFailure({
        event: {
          data: {
            event: { name: 'pipeline/job.requested', data: {} },
          },
        },
        error: { message: 'whatever' },
        runId: 'run_x',
      });
      expect(markFailedSpy).not.toHaveBeenCalled();
      expect(spy).toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it("swallows markFailed's own throws (already-converted job, etc.) and logs", async () => {
    markFailedSpy.mockRejectedValue(new Error('Invalid status transition'));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      await expect(
        runPipelineJobOnFailure({
          event: {
            data: {
              event: {
                name: 'pipeline/job.requested',
                data: { jobId: 'job-1' },
              },
            },
          },
          error: { message: 'pipeline crashed' },
          runId: 'run_x',
        }),
      ).resolves.toBeUndefined();
      expect(spy).toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it('falls back to "Unknown failure" when the error has no message', async () => {
    markFailedSpy.mockResolvedValue({ id: 'job-1', status: 'failed' });
    await runPipelineJobOnFailure({
      event: {
        data: {
          event: { name: 'pipeline/job.requested', data: { jobId: 'job-1' } },
        },
      },
      error: {},
      runId: 'run_x',
    });
    expect(markFailedSpy.mock.calls[0]![1]!.errorMessage).toBe('Unknown failure');
  });
});
