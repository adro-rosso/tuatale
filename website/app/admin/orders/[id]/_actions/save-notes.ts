'use server';

import { revalidatePath } from 'next/cache';
import { updateReviewNotes } from '@/db/pipeline-jobs';

/**
 * Persist the review_notes textarea content without changing the
 * job's status. Lets the admin capture in-progress thinking without
 * committing to Ship / Cancel / Retry.
 *
 * Bind the jobId at the call site (`.bind(null, jobId)`) so the
 * client can't tamper with which job gets updated.
 */
export async function saveNotesAction(jobId: string, formData: FormData): Promise<void> {
  const notes = String(formData.get('review_notes') ?? '');
  await updateReviewNotes(jobId, notes || null);
  revalidatePath('/admin/orders', 'layout');
  revalidatePath(`/admin/orders/${jobId}`);
}
