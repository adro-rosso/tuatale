'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import * as Sentry from '@sentry/nextjs';
import { markCancelled } from '@/db/pipeline-jobs';
import { adminUsername } from '@/lib/admin-auth';
import { clearReviewArtifacts } from '@/lib/retention/review-artifacts';

/**
 * Transition a non-terminal job to 'cancelled'. The client wrapper
 * (CancelButton) gates this behind window.confirm so a misclick
 * doesn't kill a job. Persists current notes content as the cancel
 * reason.
 *
 * Redirects back to /admin/orders.
 */
export async function cancelJobAction(jobId: string, formData: FormData): Promise<never> {
  const reviewedBy = adminUsername();
  if (!reviewedBy) {
    throw new Error('ADMIN_USERNAME not configured — cannot record cancel context');
  }
  const reviewNotes = String(formData.get('review_notes') ?? '').trim();
  const cancelledJob = await markCancelled(jobId, {
    reviewedBy,
    reviewNotes: reviewNotes || undefined,
  });

  // Any transition OUT of awaiting_review ends the review lifecycle — cancel too, not just
  // ship. Idempotent + order-scoped, so it is a safe no-op when the job was cancelled
  // before it ever produced artifacts (from pending/running). Best-effort vs the cancel
  // itself; a failure is an ops alert (same Sentry path as ship), and the 30-day reaper is
  // the durable backstop.
  try {
    await clearReviewArtifacts(cancelledJob.order_id);
  } catch (err) {
    Sentry.captureException(err, {
      level: 'error',
      tags: { component: 'cancel-job-action', failure: 'review-cleanup' },
      extra: { jobId, orderId: cancelledJob.order_id },
    });
  }

  revalidatePath('/admin/orders', 'layout');
  redirect('/admin/orders');
}
