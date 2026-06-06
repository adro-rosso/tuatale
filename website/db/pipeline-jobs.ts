/**
 * pipeline_jobs query helpers.
 *
 * Per-transition functions (markRunning, markAwaitingReview, etc.) are
 * the public API. Each one:
 *   1. Loads the current row (404 -> DatabaseError)
 *   2. Validates the transition is legal (illegal -> InvalidStatusTransitionError)
 *   3. Updates the row with the target status + every timestamp /
 *      output field that belongs to that specific transition
 *   4. Returns the updated row
 *
 * This shape beats a single 12-optional-field updateJobStatus: callers
 * can't accidentally transition to 'shipped' without setting shipped_at,
 * or stash a pdf_url alongside a failed transition. The transition
 * matrix becomes "which function are you allowed to call from here".
 *
 * Status lifecycle:
 *   pending          -> running | cancelled
 *   running          -> awaiting_review | failed | cancelled
 *   awaiting_review  -> shipped | cancelled | running (regenerate)
 *   failed           -> running (manual retry) | cancelled
 *   shipped          -> terminal
 *   cancelled        -> terminal
 *
 * All helpers use the service-role client. Never imported from a
 * client component.
 */
import { createServerClient, type TuataleSupabaseClient } from '@/lib/supabase';
import type { Json, Tables, TablesInsert, TablesUpdate } from '@/types/database';
import { DatabaseError, InvalidStatusTransitionError } from './errors';

type PipelineJobRow = Tables<'pipeline_jobs'>;
type PipelineJobInsert = TablesInsert<'pipeline_jobs'>;
type PipelineJobUpdate = TablesUpdate<'pipeline_jobs'>;

/**
 * Status values for pipeline_jobs.status. Mirrors the DB CHECK
 * constraint in supabase/migrations/20260606120000_create_pipeline_jobs.sql;
 * keep the two in sync when adding a state.
 */
export const PIPELINE_JOB_STATUSES = [
  'pending',
  'running',
  'awaiting_review',
  'shipped',
  'failed',
  'cancelled',
] as const;

export type PipelineJobStatus = (typeof PIPELINE_JOB_STATUSES)[number];

/**
 * Transition matrix. Each key is a from-state; the array is the legal
 * to-states. Terminal states (shipped, cancelled) have empty arrays.
 *
 * `awaiting_review -> running` is included for future regenerate
 * workflows. `failed -> running` is included for manual retry.
 */
const VALID_TRANSITIONS: Readonly<Record<PipelineJobStatus, ReadonlyArray<PipelineJobStatus>>> = {
  pending: ['running', 'cancelled'],
  running: ['awaiting_review', 'failed', 'cancelled'],
  awaiting_review: ['shipped', 'cancelled', 'running'],
  shipped: [],
  failed: ['running', 'cancelled'],
  cancelled: [],
};

export function isValidStatusTransition(from: PipelineJobStatus, to: PipelineJobStatus): boolean {
  return VALID_TRANSITIONS[from].includes(to);
}

function assertKnownStatus(value: string, operation: string): PipelineJobStatus {
  if ((PIPELINE_JOB_STATUSES as readonly string[]).includes(value)) {
    return value as PipelineJobStatus;
  }
  throw new DatabaseError(operation, {
    message: `Unknown pipeline_jobs status: "${value}" — DB CHECK should have rejected this`,
  });
}

async function loadOrThrow(
  id: string,
  operation: string,
  client: TuataleSupabaseClient,
): Promise<PipelineJobRow> {
  const { data, error } = await client.from('pipeline_jobs').select('*').eq('id', id).maybeSingle();
  if (error) throw new DatabaseError(operation, error);
  if (!data) {
    throw new DatabaseError(operation, { message: `Job ${id} not found` });
  }
  return data;
}

async function applyTransition(
  id: string,
  targetStatus: PipelineJobStatus,
  patch: PipelineJobUpdate,
  operation: string,
  client: TuataleSupabaseClient,
): Promise<PipelineJobRow> {
  const current = await loadOrThrow(id, operation, client);
  const fromStatus = assertKnownStatus(current.status, operation);
  if (!isValidStatusTransition(fromStatus, targetStatus)) {
    throw new InvalidStatusTransitionError(fromStatus, targetStatus);
  }
  const { data, error } = await client
    .from('pipeline_jobs')
    .update({ ...patch, status: targetStatus })
    .eq('id', id)
    .select()
    .single();
  if (error) throw new DatabaseError(operation, error);
  return data;
}

// ---- Reads -----------------------------------------------------------------

/**
 * Create a fresh job for an order. Starts at status='pending' with
 * attempt_count=0 (both DB defaults). Throws DatabaseError if the
 * order doesn't exist or a job already exists for it (unique index
 * on order_id).
 */
export async function createJob(
  { orderId }: { orderId: string },
  client: TuataleSupabaseClient = createServerClient(),
): Promise<PipelineJobRow> {
  const payload: PipelineJobInsert = { order_id: orderId };
  const { data, error } = await client.from('pipeline_jobs').insert(payload).select().single();
  if (error) throw new DatabaseError('pipelineJobs.create', error);
  return data;
}

export async function getJobById(
  id: string,
  client: TuataleSupabaseClient = createServerClient(),
): Promise<PipelineJobRow | null> {
  const { data, error } = await client.from('pipeline_jobs').select('*').eq('id', id).maybeSingle();
  if (error) throw new DatabaseError('pipelineJobs.getById', error);
  return data;
}

export async function getJobByOrderId(
  orderId: string,
  client: TuataleSupabaseClient = createServerClient(),
): Promise<PipelineJobRow | null> {
  const { data, error } = await client
    .from('pipeline_jobs')
    .select('*')
    .eq('order_id', orderId)
    .maybeSingle();
  if (error) throw new DatabaseError('pipelineJobs.getByOrderId', error);
  return data;
}

interface GetJobsByStatusOptions {
  limit?: number;
}

/**
 * Queue / admin-dashboard query. Returns jobs matching `status`
 * sorted by created_at ascending (oldest first — both the
 * Inngest pickup loop and the admin "awaiting review" list want
 * oldest-first ordering, FIFO-style).
 */
export async function getJobsByStatus(
  status: PipelineJobStatus,
  { limit }: GetJobsByStatusOptions = {},
  client: TuataleSupabaseClient = createServerClient(),
): Promise<PipelineJobRow[]> {
  let query = client
    .from('pipeline_jobs')
    .select('*')
    .eq('status', status)
    .order('created_at', { ascending: true });
  if (limit !== undefined) {
    query = query.limit(limit);
  }
  const { data, error } = await query;
  if (error) throw new DatabaseError('pipelineJobs.getByStatus', error);
  return data ?? [];
}

/**
 * Aggregate counts per status. Used by the admin dashboard's summary
 * tiles. Returns 0 for any status with no matching rows so the
 * shape is stable across calls.
 */
export async function countJobsByStatus(
  client: TuataleSupabaseClient = createServerClient(),
): Promise<Record<PipelineJobStatus, number>> {
  const result = Object.fromEntries(PIPELINE_JOB_STATUSES.map((s) => [s, 0])) as Record<
    PipelineJobStatus,
    number
  >;
  // Supabase JS client doesn't expose GROUP BY directly. One count
  // per status — six round-trips, but a single PostgREST request each
  // and the table is small. If this ever becomes hot, switch to a
  // single RPC.
  await Promise.all(
    PIPELINE_JOB_STATUSES.map(async (status) => {
      const { count, error } = await client
        .from('pipeline_jobs')
        .select('id', { count: 'exact', head: true })
        .eq('status', status);
      if (error) throw new DatabaseError('pipelineJobs.countByStatus', error);
      result[status] = count ?? 0;
    }),
  );
  return result;
}

// ---- Transitions -----------------------------------------------------------

/**
 * Pending -> running OR awaiting_review -> running (regenerate path).
 *
 * Sets started_at and the inngest_* cross-references for debugging
 * correlation. Does NOT touch attempt_count — first picks aren't
 * retries.
 *
 * Clears completed_at + pdf_url + generation_metadata so a regenerate
 * doesn't leave the prior run's terminal metadata stuck on the row
 * (which would also violate the completed_at >= started_at CHECK
 * once started_at is re-stamped to NOW).
 */
export async function markRunning(
  id: string,
  args: { inngestEventId?: string; inngestRunId?: string; startedAt?: Date } = {},
  client: TuataleSupabaseClient = createServerClient(),
): Promise<PipelineJobRow> {
  const startedAt = (args.startedAt ?? new Date()).toISOString();
  return applyTransition(
    id,
    'running',
    {
      started_at: startedAt,
      inngest_event_id: args.inngestEventId ?? null,
      inngest_run_id: args.inngestRunId ?? null,
      completed_at: null,
      pdf_url: null,
      generation_metadata: null,
    },
    'pipelineJobs.markRunning',
    client,
  );
}

/**
 * Running -> awaiting_review. Pipeline finished a PDF; admin to
 * approve. completed_at + pdf_url are mandatory at this edge.
 */
export async function markAwaitingReview(
  id: string,
  args: { pdfUrl: string; generationMetadata?: Json; completedAt?: Date },
  client: TuataleSupabaseClient = createServerClient(),
): Promise<PipelineJobRow> {
  const completedAt = (args.completedAt ?? new Date()).toISOString();
  return applyTransition(
    id,
    'awaiting_review',
    {
      completed_at: completedAt,
      pdf_url: args.pdfUrl,
      generation_metadata: args.generationMetadata ?? null,
    },
    'pipelineJobs.markAwaitingReview',
    client,
  );
}

/**
 * Awaiting_review -> shipped. Admin clicked Ship. reviewedBy is the
 * admin identifier; review_notes optional.
 */
export async function markShipped(
  id: string,
  args: { reviewedBy: string; reviewNotes?: string; shippedAt?: Date },
  client: TuataleSupabaseClient = createServerClient(),
): Promise<PipelineJobRow> {
  const shippedAt = (args.shippedAt ?? new Date()).toISOString();
  return applyTransition(
    id,
    'shipped',
    {
      shipped_at: shippedAt,
      reviewed_by: args.reviewedBy,
      review_notes: args.reviewNotes ?? null,
    },
    'pipelineJobs.markShipped',
    client,
  );
}

/**
 * Running -> failed. Pipeline crashed and retries (if any) are
 * exhausted. completed_at + failed_at are both set so admin
 * dashboards using either timestamp see consistent data.
 */
export async function markFailed(
  id: string,
  args: { errorMessage: string; errorDetails?: Json; failedAt?: Date },
  client: TuataleSupabaseClient = createServerClient(),
): Promise<PipelineJobRow> {
  const failedAt = (args.failedAt ?? new Date()).toISOString();
  return applyTransition(
    id,
    'failed',
    {
      failed_at: failedAt,
      completed_at: failedAt,
      error_message: args.errorMessage,
      error_details: args.errorDetails ?? null,
    },
    'pipelineJobs.markFailed',
    client,
  );
}

/**
 * Any non-terminal status -> cancelled. Admin or system cancelled
 * before completion. reviewedBy + review_notes optional — caller may
 * not know the admin (e.g. system-initiated cancel on order refund).
 */
export async function markCancelled(
  id: string,
  args: { reviewedBy?: string; reviewNotes?: string } = {},
  client: TuataleSupabaseClient = createServerClient(),
): Promise<PipelineJobRow> {
  return applyTransition(
    id,
    'cancelled',
    {
      reviewed_by: args.reviewedBy ?? null,
      review_notes: args.reviewNotes ?? null,
    },
    'pipelineJobs.markCancelled',
    client,
  );
}

/**
 * Failed -> running (manual or scheduled retry). Increments
 * attempt_count atomically with the transition + sets new
 * inngest_* references for the fresh run. Use this instead of
 * markRunning when the prior attempt failed.
 */
export async function retry(
  id: string,
  args: { inngestEventId?: string; inngestRunId?: string; startedAt?: Date } = {},
  client: TuataleSupabaseClient = createServerClient(),
): Promise<PipelineJobRow> {
  const current = await loadOrThrow(id, 'pipelineJobs.retry', client);
  const fromStatus = assertKnownStatus(current.status, 'pipelineJobs.retry');
  if (!isValidStatusTransition(fromStatus, 'running') || fromStatus !== 'failed') {
    // retry is specifically the failed -> running edge. markRunning
    // covers pending -> running and awaiting_review -> running.
    throw new InvalidStatusTransitionError(fromStatus, 'running');
  }
  const startedAt = (args.startedAt ?? new Date()).toISOString();
  const { data, error } = await client
    .from('pipeline_jobs')
    .update({
      status: 'running',
      started_at: startedAt,
      attempt_count: current.attempt_count + 1,
      inngest_event_id: args.inngestEventId ?? null,
      inngest_run_id: args.inngestRunId ?? null,
      // Clear failure metadata so the new attempt isn't tagged with
      // the old failure's payload if it succeeds.
      error_message: null,
      error_details: null,
      failed_at: null,
      completed_at: null,
    })
    .eq('id', id)
    .select()
    .single();
  if (error) throw new DatabaseError('pipelineJobs.retry', error);
  return data;
}

/**
 * Bump attempt_count without changing status. Used by the Inngest
 * function when an internal retry happens within a single 'running'
 * span (e.g. an LLM call's own retry budget) — distinct from
 * `retry()`, which models a fresh attempt after a failed terminal.
 */
export async function incrementAttemptCount(
  id: string,
  client: TuataleSupabaseClient = createServerClient(),
): Promise<PipelineJobRow> {
  const current = await loadOrThrow(id, 'pipelineJobs.incrementAttemptCount', client);
  const { data, error } = await client
    .from('pipeline_jobs')
    .update({ attempt_count: current.attempt_count + 1 })
    .eq('id', id)
    .select()
    .single();
  if (error) throw new DatabaseError('pipelineJobs.incrementAttemptCount', error);
  return data;
}

/**
 * Patch review_notes without touching status or any other field.
 * Used by the admin "Save notes" action so the admin can capture
 * work-in-progress thoughts without committing to a Ship / Cancel /
 * Retry.
 *
 * Empty string is allowed (clears the notes). Pass `null` to unset
 * explicitly.
 */
export async function updateReviewNotes(
  id: string,
  notes: string | null,
  client: TuataleSupabaseClient = createServerClient(),
): Promise<PipelineJobRow> {
  const { data, error } = await client
    .from('pipeline_jobs')
    .update({ review_notes: notes })
    .eq('id', id)
    .select()
    .single();
  if (error) throw new DatabaseError('pipelineJobs.updateReviewNotes', error);
  return data;
}

/**
 * Patch the ship-notification tracking columns added in the Cycle A.5
 * migration. Used by shipJobAction after Resend's `sendEmail` returns
 * — success records sent_at + message_id, failure records error.
 *
 * All three fields are independently nullable so the helper supports
 * three states without exotic CHECK constraints:
 *   - success         { sentAt: now, messageId: 'msg_x', error: null }
 *   - failure         { sentAt: null, messageId: null, error: '...' }
 *   - skipped (stub)  { sentAt: null, messageId: null, error: 'stub PDF...' }
 *
 * Does NOT touch status — the email outcome is orthogonal to whether
 * the job is shipped.
 */
export async function updateJobNotificationStatus(
  id: string,
  args: {
    notificationSentAt: Date | null;
    notificationMessageId: string | null;
    notificationError: string | null;
  },
  client: TuataleSupabaseClient = createServerClient(),
): Promise<PipelineJobRow> {
  const { data, error } = await client
    .from('pipeline_jobs')
    .update({
      notification_sent_at: args.notificationSentAt ? args.notificationSentAt.toISOString() : null,
      notification_message_id: args.notificationMessageId,
      notification_error: args.notificationError,
    })
    .eq('id', id)
    .select()
    .single();
  if (error) throw new DatabaseError('pipelineJobs.updateJobNotificationStatus', error);
  return data;
}
