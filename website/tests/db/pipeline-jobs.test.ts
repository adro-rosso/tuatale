/**
 * pipeline_jobs integration tests.
 *
 * Skips entirely when TEST_SUPABASE_URL is not set (CI default).
 *
 * Coverage:
 *   - createJob defaults + FK enforcement + unique-per-order
 *   - getJobById / getJobByOrderId roundtrip + null-for-missing
 *   - getJobsByStatus filter + sort + limit
 *   - countJobsByStatus aggregate shape
 *   - Per-transition helpers: markRunning, markAwaitingReview,
 *     markShipped, markFailed, markCancelled, retry
 *   - Status transition validation (legal + illegal edges)
 *   - retry clears prior failure metadata + bumps attempt_count
 *   - incrementAttemptCount primitive
 *   - terminal states reject any further transition
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import {
  createJob,
  getJobById,
  getJobByOrderId,
  getJobsByStatus,
  countJobsByStatus,
  markRunning,
  markAwaitingReview,
  markShipped,
  markFailed,
  markCancelled,
  retry,
  incrementAttemptCount,
  isValidStatusTransition,
  PIPELINE_JOB_STATUSES,
  type PipelineJobStatus,
} from '@/db/pipeline-jobs';
import { createOrder } from '@/db/orders';
import { DatabaseError, InvalidStatusTransitionError } from '@/db/errors';
import { createTestClient, freshUuid, shouldSkipIntegrationTests, truncateAll } from './helpers';
import type { TablesInsert } from '@/types/database';
import type { TuataleSupabaseClient } from '@/lib/supabase';

type OrderInsert = TablesInsert<'orders'>;

const skipSuite = shouldSkipIntegrationTests();
const describeIntegration = skipSuite ? describe.skip : describe;

function validOrderPayload(overrides: Partial<OrderInsert> = {}): OrderInsert {
  return {
    customer_email: 'test@example.com',
    child_name: 'Iris',
    child_age: 6,
    child_gender: 'girl',
    child_appearance: 'short brown hair, blue shirt',
    theme: 'a quiet afternoon at the park',
    age_range: '5-7',
    stripe_session_id: `cs_test_${freshUuid()}`,
    amount_paid_cents: 4500,
    paid_at: new Date().toISOString(),
    ...overrides,
  };
}

describeIntegration('pipeline_jobs integration', () => {
  let client: TuataleSupabaseClient;
  let orderId: string;

  beforeAll(() => {
    client = createTestClient();
  });

  beforeEach(async () => {
    await truncateAll(client);
    const order = await createOrder(validOrderPayload(), client);
    orderId = order.id;
  });

  // ---- creates / reads ----

  it('createJob inserts row with defaults populated', async () => {
    const job = await createJob({ orderId }, client);
    expect(job.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(job.order_id).toBe(orderId);
    expect(job.status).toBe('pending');
    expect(job.attempt_count).toBe(0);
    expect(job.started_at).toBeNull();
    expect(job.completed_at).toBeNull();
    expect(job.pdf_url).toBeNull();
  });

  it('createJob rejects unknown order_id (FK constraint)', async () => {
    await expect(createJob({ orderId: freshUuid() }, client)).rejects.toBeInstanceOf(DatabaseError);
  });

  it('createJob rejects second job for same order (unique index)', async () => {
    await createJob({ orderId }, client);
    await expect(createJob({ orderId }, client)).rejects.toBeInstanceOf(DatabaseError);
  });

  it('getJobById + getJobByOrderId roundtrip', async () => {
    const created = await createJob({ orderId }, client);
    expect((await getJobById(created.id, client))?.id).toBe(created.id);
    expect((await getJobByOrderId(orderId, client))?.id).toBe(created.id);
  });

  it('getJobById returns null for unknown id', async () => {
    expect(await getJobById(freshUuid(), client)).toBeNull();
  });

  it('getJobByOrderId returns null for an order with no job', async () => {
    expect(await getJobByOrderId(orderId, client)).toBeNull();
  });

  // ---- queue queries ----

  it('getJobsByStatus filters by status and sorts by created_at asc', async () => {
    const orders = await Promise.all([
      createOrder(validOrderPayload(), client),
      createOrder(validOrderPayload(), client),
      createOrder(validOrderPayload(), client),
    ]);
    // Create jobs spaced so created_at order is deterministic.
    const first = await createJob({ orderId: orders[0]!.id }, client);
    await new Promise((r) => setTimeout(r, 20));
    const second = await createJob({ orderId: orders[1]!.id }, client);
    await new Promise((r) => setTimeout(r, 20));
    const third = await createJob({ orderId: orders[2]!.id }, client);

    const pending = await getJobsByStatus('pending', {}, client);
    expect(pending.map((j) => j.id)).toEqual([first.id, second.id, third.id]);

    const limited = await getJobsByStatus('pending', { limit: 2 }, client);
    expect(limited).toHaveLength(2);
    expect(limited.map((j) => j.id)).toEqual([first.id, second.id]);

    // Status filter excludes non-matching rows.
    expect(await getJobsByStatus('shipped', {}, client)).toHaveLength(0);
  });

  it('countJobsByStatus returns a key for every status, even when zero', async () => {
    const counts = await countJobsByStatus(client);
    for (const status of PIPELINE_JOB_STATUSES) {
      expect(counts[status]).toBe(0);
    }
    await createJob({ orderId }, client);
    const after = await countJobsByStatus(client);
    expect(after.pending).toBe(1);
    expect(after.running).toBe(0);
    expect(after.shipped).toBe(0);
  });

  // ---- transition matrix ----

  it('isValidStatusTransition pins the legal edges', () => {
    const legal: Array<[PipelineJobStatus, PipelineJobStatus]> = [
      ['pending', 'running'],
      ['pending', 'cancelled'],
      ['running', 'awaiting_review'],
      ['running', 'failed'],
      ['running', 'cancelled'],
      ['awaiting_review', 'shipped'],
      ['awaiting_review', 'cancelled'],
      ['awaiting_review', 'running'],
      ['failed', 'running'],
      ['failed', 'cancelled'],
    ];
    for (const [from, to] of legal) {
      expect(isValidStatusTransition(from, to)).toBe(true);
    }
    const illegal: Array<[PipelineJobStatus, PipelineJobStatus]> = [
      ['pending', 'awaiting_review'],
      ['pending', 'shipped'],
      ['running', 'shipped'],
      ['shipped', 'running'],
      ['shipped', 'cancelled'],
      ['cancelled', 'pending'],
    ];
    for (const [from, to] of illegal) {
      expect(isValidStatusTransition(from, to)).toBe(false);
    }
  });

  // ---- markRunning ----

  it('markRunning: pending -> running sets started_at + inngest ids', async () => {
    const job = await createJob({ orderId }, client);
    const updated = await markRunning(
      job.id,
      { inngestEventId: 'evt_abc', inngestRunId: 'run_xyz' },
      client,
    );
    expect(updated.status).toBe('running');
    expect(updated.started_at).not.toBeNull();
    expect(updated.inngest_event_id).toBe('evt_abc');
    expect(updated.inngest_run_id).toBe('run_xyz');
    // attempt_count untouched — first picks aren't retries.
    expect(updated.attempt_count).toBe(0);
  });

  it('markRunning: awaiting_review -> running supports regenerate path + clears prior output', async () => {
    const job = await createJob({ orderId }, client);
    await markRunning(job.id, {}, client);
    await markAwaitingReview(
      job.id,
      { pdfUrl: 'https://example.com/a.pdf', generationMetadata: { round: 1 } },
      client,
    );
    const regenerated = await markRunning(job.id, { inngestEventId: 'evt_regen' }, client);
    expect(regenerated.status).toBe('running');
    expect(regenerated.inngest_event_id).toBe('evt_regen');
    // Prior run's terminal metadata cleared so the regenerated run
    // starts from a clean slate (and the CHECK constraint
    // completed_at >= started_at doesn't fire on the re-stamp).
    expect(regenerated.completed_at).toBeNull();
    expect(regenerated.pdf_url).toBeNull();
    expect(regenerated.generation_metadata).toBeNull();
  });

  it('markRunning rejects illegal transitions (e.g. shipped -> running)', async () => {
    const job = await createJob({ orderId }, client);
    await markRunning(job.id, {}, client);
    await markAwaitingReview(job.id, { pdfUrl: 'https://example.com/a.pdf' }, client);
    await markShipped(job.id, { reviewedBy: 'adro' }, client);
    await expect(markRunning(job.id, {}, client)).rejects.toBeInstanceOf(
      InvalidStatusTransitionError,
    );
  });

  // ---- markAwaitingReview ----

  it('markAwaitingReview: running -> awaiting_review sets completed_at + pdf_url', async () => {
    const job = await createJob({ orderId }, client);
    await markRunning(job.id, {}, client);
    const metadata = { model: 'gemini-3-pro-image-preview', costCents: 240 };
    const reviewing = await markAwaitingReview(
      job.id,
      { pdfUrl: 'https://example.com/book.pdf', generationMetadata: metadata },
      client,
    );
    expect(reviewing.status).toBe('awaiting_review');
    expect(reviewing.completed_at).not.toBeNull();
    expect(reviewing.pdf_url).toBe('https://example.com/book.pdf');
    expect(reviewing.generation_metadata).toEqual(metadata);
  });

  it('markAwaitingReview rejects pending -> awaiting_review (must go through running)', async () => {
    const job = await createJob({ orderId }, client);
    await expect(
      markAwaitingReview(job.id, { pdfUrl: 'https://example.com/a.pdf' }, client),
    ).rejects.toBeInstanceOf(InvalidStatusTransitionError);
  });

  // ---- markShipped ----

  it('markShipped: awaiting_review -> shipped sets shipped_at + reviewed_by', async () => {
    const job = await createJob({ orderId }, client);
    await markRunning(job.id, {}, client);
    await markAwaitingReview(job.id, { pdfUrl: 'https://example.com/a.pdf' }, client);
    const shipped = await markShipped(
      job.id,
      { reviewedBy: 'adro@tuatale.com', reviewNotes: 'Looks good.' },
      client,
    );
    expect(shipped.status).toBe('shipped');
    expect(shipped.shipped_at).not.toBeNull();
    expect(shipped.reviewed_by).toBe('adro@tuatale.com');
    expect(shipped.review_notes).toBe('Looks good.');
  });

  it('shipped is terminal: any further transition rejected', async () => {
    const job = await createJob({ orderId }, client);
    await markRunning(job.id, {}, client);
    await markAwaitingReview(job.id, { pdfUrl: 'https://example.com/a.pdf' }, client);
    await markShipped(job.id, { reviewedBy: 'adro' }, client);
    await expect(markCancelled(job.id, {}, client)).rejects.toBeInstanceOf(
      InvalidStatusTransitionError,
    );
    await expect(markRunning(job.id, {}, client)).rejects.toBeInstanceOf(
      InvalidStatusTransitionError,
    );
  });

  // ---- markFailed ----

  it('markFailed: running -> failed stamps both failed_at and completed_at', async () => {
    const job = await createJob({ orderId }, client);
    await markRunning(job.id, {}, client);
    const failed = await markFailed(
      job.id,
      {
        errorMessage: 'Gemini wall limit hit',
        errorDetails: { type: 'WallCeilingError', wall: 8 },
      },
      client,
    );
    expect(failed.status).toBe('failed');
    expect(failed.failed_at).not.toBeNull();
    expect(failed.completed_at).not.toBeNull();
    expect(failed.error_message).toMatch(/Gemini wall/);
    expect(failed.error_details).toEqual({ type: 'WallCeilingError', wall: 8 });
  });

  // ---- markCancelled ----

  it('markCancelled is allowed from any non-terminal status', async () => {
    // pending -> cancelled
    const a = await createJob({ orderId }, client);
    await expect(markCancelled(a.id, {}, client)).resolves.toMatchObject({
      status: 'cancelled',
    });

    // running -> cancelled
    const orderB = await createOrder(validOrderPayload(), client);
    const b = await createJob({ orderId: orderB.id }, client);
    await markRunning(b.id, {}, client);
    await expect(markCancelled(b.id, {}, client)).resolves.toMatchObject({
      status: 'cancelled',
    });

    // failed -> cancelled
    const orderC = await createOrder(validOrderPayload(), client);
    const c = await createJob({ orderId: orderC.id }, client);
    await markRunning(c.id, {}, client);
    await markFailed(c.id, { errorMessage: 'oops' }, client);
    await expect(markCancelled(c.id, {}, client)).resolves.toMatchObject({
      status: 'cancelled',
    });
  });

  // ---- retry ----

  it('retry: failed -> running bumps attempt_count + clears prior failure metadata', async () => {
    const job = await createJob({ orderId }, client);
    await markRunning(job.id, { inngestEventId: 'evt_v1' }, client);
    await markFailed(
      job.id,
      { errorMessage: 'first attempt failed', errorDetails: { foo: 'bar' } },
      client,
    );
    const retried = await retry(
      job.id,
      { inngestEventId: 'evt_v2', inngestRunId: 'run_v2' },
      client,
    );
    expect(retried.status).toBe('running');
    expect(retried.attempt_count).toBe(1);
    expect(retried.inngest_event_id).toBe('evt_v2');
    expect(retried.inngest_run_id).toBe('run_v2');
    // Prior failure metadata cleared so the next terminal isn't ambiguous.
    expect(retried.error_message).toBeNull();
    expect(retried.error_details).toBeNull();
    expect(retried.failed_at).toBeNull();
    expect(retried.completed_at).toBeNull();
  });

  it('retry rejects pending -> running (use markRunning) and shipped -> running', async () => {
    const job = await createJob({ orderId }, client);
    await expect(retry(job.id, {}, client)).rejects.toBeInstanceOf(InvalidStatusTransitionError);

    const orderB = await createOrder(validOrderPayload(), client);
    const b = await createJob({ orderId: orderB.id }, client);
    await markRunning(b.id, {}, client);
    await markAwaitingReview(b.id, { pdfUrl: 'https://example.com/b.pdf' }, client);
    await markShipped(b.id, { reviewedBy: 'adro' }, client);
    await expect(retry(b.id, {}, client)).rejects.toBeInstanceOf(InvalidStatusTransitionError);
  });

  // ---- incrementAttemptCount ----

  it('incrementAttemptCount bumps the counter without touching status', async () => {
    const job = await createJob({ orderId }, client);
    await markRunning(job.id, {}, client);
    const bumped = await incrementAttemptCount(job.id, client);
    expect(bumped.attempt_count).toBe(1);
    expect(bumped.status).toBe('running');
    const bumpedAgain = await incrementAttemptCount(job.id, client);
    expect(bumpedAgain.attempt_count).toBe(2);
  });

  it('all transition helpers throw DatabaseError when the job id is unknown', async () => {
    const unknownId = freshUuid();
    await expect(markRunning(unknownId, {}, client)).rejects.toBeInstanceOf(DatabaseError);
    await expect(markAwaitingReview(unknownId, { pdfUrl: 'x' }, client)).rejects.toBeInstanceOf(
      DatabaseError,
    );
    await expect(markShipped(unknownId, { reviewedBy: 'x' }, client)).rejects.toBeInstanceOf(
      DatabaseError,
    );
    await expect(markFailed(unknownId, { errorMessage: 'x' }, client)).rejects.toBeInstanceOf(
      DatabaseError,
    );
  });
});
