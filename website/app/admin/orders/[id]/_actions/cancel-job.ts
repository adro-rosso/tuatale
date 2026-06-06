'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { markCancelled } from '@/db/pipeline-jobs';
import { adminUsername } from '@/lib/admin-auth';

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
  await markCancelled(jobId, {
    reviewedBy,
    reviewNotes: reviewNotes || undefined,
  });
  revalidatePath('/admin/orders', 'layout');
  redirect('/admin/orders');
}
