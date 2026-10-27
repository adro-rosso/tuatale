'use server';

/**
 * Resend the customer's "your book is ready" email for a SHIPPED job.
 *
 * Why it exists: Ship sends once and only records a failure (e.g. 2026-10-27, Resend refused
 * every send because tuatale.com was unverified). This lets the admin recover from the detail
 * page. It always signs a FRESH 7-day download link (the worker's link may be close to
 * expiry), stores it as the job's pdf_url so the admin preview keeps working, sends the same
 * template Ship uses, and records the outcome. Never throws for a send failure — the result
 * lands in notification_error and the detail page shows it.
 */
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import * as Sentry from '@sentry/nextjs';
import { claimNotificationSend, getJobById, updateJobNotificationStatus, updateJobPdfUrl } from '@/db/pipeline-jobs';
import { getOrderById } from '@/db/orders';
import { adminUsername } from '@/lib/admin-auth';
import { sendEmail } from '@/lib/email/send';
import { buildShipNotification } from '@/lib/email/templates/ship-notification';
import { signBookPdfUrl } from '@/lib/email/book-link';

export const RESEND_CLAIM_PREFIX = 'resend in progress since ';
const STALE_CLAIM_MS = 5 * 60 * 1000;

export async function resendShipEmailAction(jobId: string, _formData: FormData): Promise<never> {
  if (!adminUsername()) throw new Error('ADMIN_USERNAME not configured');
  const back = `/admin/orders/${jobId}`;

  const job = await getJobById(jobId);
  // One-time: only shipped jobs whose delivery email has NOT gone out.
  if (!job || job.status !== 'shipped' || job.notification_sent_at) {
    revalidatePath(back);
    redirect(back);
  }
  // Another press is mid-send (fresh claim) → do nothing. A claim older than 5 min is a
  // crashed send and may be retaken.
  const prev = job.notification_error;
  if (prev?.startsWith(RESEND_CLAIM_PREFIX)) {
    const since = Date.parse(prev.slice(RESEND_CLAIM_PREFIX.length));
    if (Number.isFinite(since) && Date.now() - since < STALE_CLAIM_MS) {
      revalidatePath(back);
      redirect(back);
    }
  }
  const won = await claimNotificationSend(jobId, prev, `${RESEND_CLAIM_PREFIX}${new Date().toISOString()}`);
  if (!won) {
    revalidatePath(back);
    redirect(back);
  }
  const order = await getOrderById(job.order_id);
  if (!order) {
    await updateJobNotificationStatus(jobId, { notificationSentAt: null, notificationMessageId: null, notificationError: 'order not found — resend skipped' });
    revalidatePath(back);
    redirect(back);
  }

  let pdfUrl: string;
  try {
    pdfUrl = await signBookPdfUrl(order.id);
    await updateJobPdfUrl(jobId, pdfUrl);
  } catch (err) {
    Sentry.captureException(err, { tags: { component: 'resend-email-action', failure: 'sign-link' }, extra: { jobId } });
    await updateJobNotificationStatus(jobId, {
      notificationSentAt: null,
      notificationMessageId: null,
      notificationError: `could not create a download link: ${err instanceof Error ? err.message : String(err)}`,
    });
    revalidatePath(back);
    redirect(back);
  }

  const result = await sendEmail(
    buildShipNotification({ customerEmail: order.customer_email, childName: order.child_name, orderId: order.id, pdfUrl }),
  );
  await updateJobNotificationStatus(jobId, result.success
    ? { notificationSentAt: new Date(), notificationMessageId: result.messageId, notificationError: null }
    : { notificationSentAt: null, notificationMessageId: null, notificationError: result.error });

  revalidatePath('/admin/orders', 'layout');
  revalidatePath(back);
  redirect(back);
}
