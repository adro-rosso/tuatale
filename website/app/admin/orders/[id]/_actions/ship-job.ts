'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import * as Sentry from '@sentry/nextjs';
import { markShipped, updateJobNotificationStatus } from '@/db/pipeline-jobs';
import { getOrderById } from '@/db/orders';
import { adminUsername } from '@/lib/admin-auth';
import { sendEmail } from '@/lib/email/send';
import { buildShipNotification } from '@/lib/email/templates/ship-notification';
import { STUB_PDF_URL } from '@/lib/pipeline-constants';

const STUB_SKIP_REASON = 'stub PDF — email skipped (pre-Track-B pipeline integration)';
const ORDER_MISSING_REASON = 'order not found at ship time — email skipped';

/**
 * Transition an awaiting_review job to 'shipped', then send the
 * customer-facing ship-notification email. Records the admin as
 * reviewedBy + persists any current notes.
 *
 * Three downstream paths after markShipped succeeds:
 *
 *   1. Order missing (shouldn't happen under ON DELETE RESTRICT but
 *      defence-in-depth): Sentry-capture, record notification_error,
 *      no email send.
 *
 *   2. PDF is the Cycle A.2 stub URL: skip the email so customers
 *      don't receive a link to a placeholder.tuatale.com domain we
 *      don't own. Record a clear `notification_error` so the admin
 *      detail view shows "skipped" rather than "sent". Sentry log
 *      so the team sees the audit trail.
 *
 *   3. Real PDF: build the template, call sendEmail, persist the
 *      outcome (sent_at + message_id on success, error on failure).
 *
 * Email send is best-effort: a failure does NOT roll back the ship
 * transition. The job is shipped from the pipeline's perspective;
 * the email is a separate concern admin can retry from the detail
 * page (Cycle A.6+ may add that button).
 *
 * Redirects back to /admin/orders regardless of email outcome so
 * the admin can pick the next job.
 */
export async function shipJobAction(jobId: string, formData: FormData): Promise<never> {
  const reviewedBy = adminUsername();
  if (!reviewedBy) {
    // Proxy gates /admin/* so this shouldn't be reachable.
    throw new Error('ADMIN_USERNAME not configured — cannot record reviewedBy');
  }
  const reviewNotes = String(formData.get('review_notes') ?? '').trim();

  // 1. Flip status. Throws InvalidStatusTransitionError if the job
  //    isn't actually in awaiting_review (e.g. admin double-clicked).
  const shippedJob = await markShipped(jobId, {
    reviewedBy,
    reviewNotes: reviewNotes || undefined,
  });

  // 2. Decide what to do about the customer email.
  try {
    await dispatchShipNotification(shippedJob.id, shippedJob.order_id, shippedJob.pdf_url);
  } catch (err) {
    // updateJobNotificationStatus itself failed. The ship already
    // succeeded — log + continue so we still redirect cleanly.
    Sentry.captureException(err, {
      tags: { component: 'ship-job-action', failure: 'notification-status-persist' },
      extra: { jobId },
    });
  }

  revalidatePath('/admin/orders', 'layout');
  revalidatePath(`/admin/orders/${jobId}`);
  redirect('/admin/orders');
}

async function dispatchShipNotification(
  jobId: string,
  orderId: string,
  pdfUrl: string | null,
): Promise<void> {
  const order = await getOrderById(orderId);
  if (!order) {
    Sentry.captureException(new Error('Order not found for shipped job'), {
      tags: { component: 'ship-job-action', failure: 'order-missing' },
      extra: { jobId, orderId },
    });
    await updateJobNotificationStatus(jobId, {
      notificationSentAt: null,
      notificationMessageId: null,
      notificationError: ORDER_MISSING_REASON,
    });
    return;
  }

  if (pdfUrl === STUB_PDF_URL || pdfUrl === null) {
    // Skip the send for stub jobs (and the defensive null case). The
    // admin detail page surfaces this so it's visible without
    // grepping logs.
    Sentry.captureMessage('Ship notification skipped for stub PDF', {
      level: 'info',
      tags: { component: 'ship-job-action', skip: 'stub-pdf' },
      extra: { jobId, orderId, pdfUrl },
    });
    await updateJobNotificationStatus(jobId, {
      notificationSentAt: null,
      notificationMessageId: null,
      notificationError: STUB_SKIP_REASON,
    });
    return;
  }

  const content = buildShipNotification({
    customerEmail: order.customer_email,
    childName: order.child_name,
    orderId: order.id,
    pdfUrl,
  });
  const result = await sendEmail(content);

  if (result.success) {
    await updateJobNotificationStatus(jobId, {
      notificationSentAt: new Date(),
      notificationMessageId: result.messageId,
      notificationError: null,
    });
  } else {
    // sendEmail already Sentry-captured. Record the failure in DB
    // so the admin detail view surfaces it.
    await updateJobNotificationStatus(jobId, {
      notificationSentAt: null,
      notificationMessageId: null,
      notificationError: result.error,
    });
  }
}
