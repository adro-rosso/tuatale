/**
 * Reaper for orphaned per-page review artifacts — the sweep that makes "exposure ends at
 * ship" TRUE rather than aspirational.
 *
 * Ship (and cancel) clear an order's orders/<id>/review/ tree, but ship is only reached on
 * the happy path. A book that enters awaiting_review and is never shipped — abandoned, or
 * cancelled with a failed cleanup — would keep its child illustrations + character
 * portraits indefinitely. This sweeps them after a TTL.
 *
 * TTL = 30 DAYS from `completed_at` (Adro's call). A never-shipped book past 30 days loses
 * only the cheap per-page fix (full regeneration instead), which is acceptable since the
 * artifacts regenerate anyway.
 *
 * WHY completed_at, not created_at / paid_at: `completed_at` is set at the awaiting_review
 * edge (db/pipeline-jobs markAwaitingReview, "mandatory at this edge") and RESET to null on
 * a regenerate (awaiting_review -> running clears it), so it marks exactly when the CURRENT
 * artifacts entered the review window. created_at (draft creation) and paid_at (payment)
 * both predate generation — often by days — so a TTL off them would reap artifacts that had
 * barely been reviewed, or keep them too long.
 *
 * STATUS SCOPE: awaiting_review (never shipped) + cancelled (cancel-path cleanup may have
 * failed). Shipped jobs are excluded — their cleanup ran at ship and any failure already
 * raised a Sentry ops alert. clearReviewArtifacts is idempotent, so a book already cleaned
 * is a safe no-op if it is swept anyway.
 *
 * RACE-FREE (confirmed, not assumed): 0 pg_cron jobs on prod (the drafts pg_cron was
 * replaced by the reap route this runs inside); it runs sequentially after the draft reap
 * in the same request; it deletes tuatale-books/orders/<id>/review/ while the draft reap
 * deletes tuatale-previews — different buckets, different rows; and clearReviewArtifacts is
 * idempotent + order-scoped, so even a concurrent ship-path clear on the same order
 * converges (remove of already-gone objects is a no-op, the list()-verify passes empty).
 *
 * DRY-RUN BY DEFAULT, mirroring reapExpiredDrafts: the caller passes { dryRun: false } to
 * delete. A dry run reports what WOULD be swept and touches nothing.
 */
import { createServerClient } from '@/lib/supabase';
import { clearReviewArtifacts, listReviewArtifacts } from '@/lib/retention/review-artifacts';

const TTL_DAYS = 30;
const REAPABLE_STATUSES = ['awaiting_review', 'cancelled'] as const;

export type ReviewReapReport = {
  dryRun: boolean;
  ttlDays: number;
  /** Jobs past TTL in a reapable status (the candidates). */
  scanned: number;
  /** Orders whose review/ prefix was cleared (apply) or would be (dry-run). */
  ordersCleared: number;
  /** Total review objects removed (apply) or found (dry-run). */
  objectsDeleted: number;
  errors: string[];
};

/**
 * @param now  injectable clock so a test can place a fixture on either side of the TTL
 *             without waiting 30 days (production passes none → real now).
 */
export async function reapReviewArtifacts(
  { dryRun = true, now = new Date() }: { dryRun?: boolean; now?: Date } = {},
  deps: { client?: ReturnType<typeof createServerClient> } = {},
): Promise<ReviewReapReport> {
  const client = deps.client ?? createServerClient();
  const report: ReviewReapReport = {
    dryRun,
    ttlDays: TTL_DAYS,
    scanned: 0,
    ordersCleared: 0,
    objectsDeleted: 0,
    errors: [],
  };

  const cutoff = new Date(now.getTime() - TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();

  // Candidates: reapable status, completed_at set and older than the cutoff. A null
  // completed_at (cancelled before the pipeline ever completed) never had artifacts.
  const { data: jobs, error } = await client
    .from('pipeline_jobs')
    .select('id, order_id, status, completed_at')
    .in('status', REAPABLE_STATUSES)
    .not('completed_at', 'is', null)
    .lt('completed_at', cutoff);

  if (error) {
    report.errors.push(`query failed: ${error.message}`);
    return report;
  }

  report.scanned = jobs?.length ?? 0;

  for (const job of jobs ?? []) {
    try {
      if (dryRun) {
        // Count precisely via the SAME recursive walk apply uses — never delete.
        const paths = await listReviewArtifacts(job.order_id, { client });
        if (paths.length > 0) {
          report.ordersCleared += 1;
          report.objectsDeleted += paths.length;
        }
        continue;
      }
      const { deleted } = await clearReviewArtifacts(job.order_id, { client });
      if (deleted > 0) {
        report.ordersCleared += 1;
        report.objectsDeleted += deleted;
      }
    } catch (e) {
      // One bad order must not stop the sweep; the next run retries it (idempotent).
      report.errors.push(`order ${job.order_id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return report;
}
