'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { markShipped } from '@/db/pipeline-jobs';
import { adminUsername } from '@/lib/admin-auth';

/**
 * Transition an awaiting_review job to 'shipped'. Records the
 * configured admin as reviewedBy + persists any current notes from
 * the textarea before flipping status.
 *
 * Redirects back to /admin/orders (the queue) so the admin can pick
 * the next job. The detail page's revalidation isn't strictly
 * needed when we redirect away, but we revalidate the layout so the
 * queue tile counts update.
 */
export async function shipJobAction(jobId: string, formData: FormData): Promise<never> {
  const reviewedBy = adminUsername();
  if (!reviewedBy) {
    // The proxy already gates /admin/* so this shouldn't be
    // reachable, but defence-in-depth.
    throw new Error('ADMIN_USERNAME not configured — cannot record reviewedBy');
  }
  const reviewNotes = String(formData.get('review_notes') ?? '').trim();
  await markShipped(jobId, {
    reviewedBy,
    reviewNotes: reviewNotes || undefined,
  });
  revalidatePath('/admin/orders', 'layout');
  redirect('/admin/orders');
}
