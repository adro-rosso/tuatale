'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { retry } from '@/db/pipeline-jobs';
import { adminUsername } from '@/lib/admin-auth';
import { inngest } from '@/lib/inngest/client';

/**
 * Transition a failed job back to 'running' and dispatch a fresh
 * Inngest event so the function picks it up. retry() clears prior
 * failure metadata + bumps attempt_count atomically.
 *
 * Persists current notes content too (admins typically jot down the
 * retry reason). The notes text becomes the retryReason on the
 * Inngest event so it shows up in the run log.
 *
 * Redirects to the same detail page so the admin can watch the
 * retry execute.
 */
export async function retryJobAction(jobId: string, formData: FormData): Promise<never> {
  const reviewedBy = adminUsername();
  if (!reviewedBy) {
    throw new Error('ADMIN_USERNAME not configured — cannot record retry context');
  }
  const reviewNotes = String(formData.get('review_notes') ?? '').trim();

  const job = await retry(jobId);
  // attempt_count just got bumped, so previousAttemptCount is
  // current - 1.
  const previousAttemptCount = Math.max(0, job.attempt_count - 1);

  await inngest.send({
    name: 'pipeline/job.retried',
    data: {
      jobId: job.id,
      orderId: job.order_id,
      retryReason: reviewNotes || `Manual retry by ${reviewedBy}`,
      previousAttemptCount,
    },
  });

  revalidatePath('/admin/orders', 'layout');
  revalidatePath(`/admin/orders/${jobId}`);
  redirect(`/admin/orders/${jobId}`);
}
