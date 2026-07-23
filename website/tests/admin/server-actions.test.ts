/**
 * Server Action tests for the admin detail page's four actions:
 * save-notes, ship-job, retry-job, cancel-job.
 *
 * Mocks pipelineJobs helpers, the Inngest client, revalidatePath,
 * redirect, and adminUsername at module boundaries so we can assert
 * exactly which helpers ran with which args.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  markShippedSpy,
  markCancelledSpy,
  retrySpy,
  updateReviewNotesSpy,
  updateJobNotificationStatusSpy,
  getOrderByIdSpy,
  sendEmailSpy,
  sentryCaptureExceptionSpy,
  sentryCaptureMessageSpy,
  adminUsernameSpy,
  inngestSendSpy,
  revalidatePathSpy,
  redirectSpy,
  clearReviewArtifactsSpy,
} = vi.hoisted(() => ({
  markShippedSpy: vi.fn(),
  markCancelledSpy: vi.fn(),
  retrySpy: vi.fn(),
  updateReviewNotesSpy: vi.fn(),
  updateJobNotificationStatusSpy: vi.fn(),
  getOrderByIdSpy: vi.fn(),
  sendEmailSpy: vi.fn(),
  sentryCaptureExceptionSpy: vi.fn(),
  sentryCaptureMessageSpy: vi.fn(),
  adminUsernameSpy: vi.fn(),
  inngestSendSpy: vi.fn(),
  revalidatePathSpy: vi.fn(),
  redirectSpy: vi.fn(),
  clearReviewArtifactsSpy: vi.fn(),
}));

class RedirectSentinel extends Error {
  constructor(public readonly url: string) {
    super(`REDIRECT:${url}`);
    this.name = 'RedirectSentinel';
  }
}

vi.mock('@/db/pipeline-jobs', () => ({
  markShipped: markShippedSpy,
  markCancelled: markCancelledSpy,
  retry: retrySpy,
  updateReviewNotes: updateReviewNotesSpy,
  updateJobNotificationStatus: updateJobNotificationStatusSpy,
}));

vi.mock('@/db/orders', () => ({
  getOrderById: getOrderByIdSpy,
}));

vi.mock('@/lib/email/send', () => ({
  sendEmail: sendEmailSpy,
}));

vi.mock('@/lib/retention/review-artifacts', () => ({
  clearReviewArtifacts: clearReviewArtifactsSpy,
}));

vi.mock('@sentry/nextjs', () => ({
  captureException: sentryCaptureExceptionSpy,
  captureMessage: sentryCaptureMessageSpy,
}));

vi.mock('@/lib/admin-auth', () => ({
  adminUsername: adminUsernameSpy,
}));

vi.mock('@/lib/inngest/client', () => ({
  inngest: { send: inngestSendSpy },
}));

vi.mock('next/cache', () => ({
  revalidatePath: revalidatePathSpy,
}));

vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    redirectSpy(url);
    throw new RedirectSentinel(url);
  },
}));

import { saveNotesAction } from '@/app/admin/orders/[id]/_actions/save-notes';
import { shipJobAction } from '@/app/admin/orders/[id]/_actions/ship-job';
import { retryJobAction } from '@/app/admin/orders/[id]/_actions/retry-job';
import { cancelJobAction } from '@/app/admin/orders/[id]/_actions/cancel-job';

function fd(fields: Record<string, string> = {}): FormData {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) {
    data.set(k, v);
  }
  return data;
}

describe('saveNotesAction', () => {
  beforeEach(() => {
    updateReviewNotesSpy.mockReset();
    revalidatePathSpy.mockReset();
    updateReviewNotesSpy.mockResolvedValue({ id: 'job-1', status: 'awaiting_review' });
  });

  it('persists the notes content + revalidates layout and detail paths', async () => {
    await saveNotesAction('job-1', fd({ review_notes: 'check the secondaries again' }));
    expect(updateReviewNotesSpy).toHaveBeenCalledWith('job-1', 'check the secondaries again');
    expect(revalidatePathSpy).toHaveBeenCalledWith('/admin/orders', 'layout');
    expect(revalidatePathSpy).toHaveBeenCalledWith('/admin/orders/job-1');
  });

  it('passes null when the textarea is empty (clears notes explicitly)', async () => {
    await saveNotesAction('job-1', fd({ review_notes: '' }));
    expect(updateReviewNotesSpy).toHaveBeenCalledWith('job-1', null);
  });
});

describe('shipJobAction', () => {
  const REAL_PDF = 'https://r2.tuatale.com/orders/abc/book.pdf';

  function shippedJob(over: Record<string, unknown> = {}) {
    return {
      id: 'job-1',
      order_id: 'order-1',
      status: 'shipped',
      pdf_url: REAL_PDF,
      ...over,
    };
  }

  function fakeOrder(over: Record<string, unknown> = {}) {
    return {
      id: 'order-1',
      customer_email: 'parent@example.com',
      child_name: 'Iris',
      ...over,
    };
  }

  beforeEach(() => {
    markShippedSpy.mockReset();
    updateJobNotificationStatusSpy.mockReset();
    getOrderByIdSpy.mockReset();
    sendEmailSpy.mockReset();
    sentryCaptureExceptionSpy.mockReset();
    sentryCaptureMessageSpy.mockReset();
    revalidatePathSpy.mockReset();
    redirectSpy.mockReset();
    adminUsernameSpy.mockReset();
    adminUsernameSpy.mockReturnValue('adro');
    clearReviewArtifactsSpy.mockReset();
    // Defaults: real PDF, order found, email sent successfully, cleanup succeeds.
    markShippedSpy.mockResolvedValue(shippedJob());
    getOrderByIdSpy.mockResolvedValue(fakeOrder());
    sendEmailSpy.mockResolvedValue({ success: true, messageId: 'msg_xyz' });
    updateJobNotificationStatusSpy.mockResolvedValue({});
    clearReviewArtifactsSpy.mockResolvedValue({ deleted: 12 });
  });

  it('happy path: markShipped + send email + records notification_sent + redirects', async () => {
    await expect(
      shipJobAction('job-1', fd({ review_notes: '  looks good  ' })),
    ).rejects.toBeInstanceOf(RedirectSentinel);
    expect(markShippedSpy).toHaveBeenCalledWith('job-1', {
      reviewedBy: 'adro',
      reviewNotes: 'looks good',
    });
    expect(getOrderByIdSpy).toHaveBeenCalledWith('order-1');
    expect(sendEmailSpy).toHaveBeenCalledTimes(1);
    expect(sendEmailSpy.mock.calls[0]![0]!).toMatchObject({
      to: 'parent@example.com',
      subject: "Iris's book is ready",
    });
    expect(updateJobNotificationStatusSpy).toHaveBeenCalledWith(
      'job-1',
      expect.objectContaining({
        notificationMessageId: 'msg_xyz',
        notificationError: null,
      }),
    );
    expect(updateJobNotificationStatusSpy.mock.calls[0]![1]!.notificationSentAt).toBeInstanceOf(
      Date,
    );
    expect(revalidatePathSpy).toHaveBeenCalledWith('/admin/orders', 'layout');
    expect(revalidatePathSpy).toHaveBeenCalledWith('/admin/orders/job-1');
    expect(redirectSpy).toHaveBeenCalledWith('/admin/orders');
    expect(sentryCaptureExceptionSpy).not.toHaveBeenCalled();
  });

  it('ends the review lifecycle: clears review artifacts for the shipped order', async () => {
    await expect(shipJobAction('job-1', fd())).rejects.toBeInstanceOf(RedirectSentinel);
    expect(clearReviewArtifactsSpy).toHaveBeenCalledWith('order-1');
    // Cleanup success ⇒ no ops alert.
    expect(sentryCaptureExceptionSpy).not.toHaveBeenCalled();
  });

  it('review cleanup failure: ship NOT rolled back, Sentry ops-alert raised, still redirects', async () => {
    clearReviewArtifactsSpy.mockRejectedValue(new Error('review cleanup incomplete for order-1'));
    await expect(shipJobAction('job-1', fd())).rejects.toBeInstanceOf(RedirectSentinel);
    // Ship went through: the customer email still dispatched, redirect still happened.
    expect(sendEmailSpy).toHaveBeenCalledTimes(1);
    expect(redirectSpy).toHaveBeenCalledWith('/admin/orders');
    // The failure is surfaced as an ops alert tagged so it can be filtered + swept.
    expect(sentryCaptureExceptionSpy).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        tags: expect.objectContaining({ failure: 'review-cleanup' }),
        extra: expect.objectContaining({ orderId: 'order-1' }),
      }),
    );
  });

  it('passes reviewNotes=undefined when textarea is empty', async () => {
    await expect(shipJobAction('job-1', fd({ review_notes: '   ' }))).rejects.toBeInstanceOf(
      RedirectSentinel,
    );
    expect(markShippedSpy).toHaveBeenCalledWith('job-1', {
      reviewedBy: 'adro',
      reviewNotes: undefined,
    });
  });

  it('throws when ADMIN_USERNAME is unconfigured (defence-in-depth)', async () => {
    adminUsernameSpy.mockReturnValue(null);
    await expect(shipJobAction('job-1', fd())).rejects.toThrow(/ADMIN_USERNAME/);
    expect(markShippedSpy).not.toHaveBeenCalled();
  });

  // Track B removed the stub-PDF concept (real PDFs now flow from the worker).
  // The only remaining skip path is the defensive null-pdf_url case.
  it('null pdf_url: skips sendEmail, records skip reason, still redirects (defensive)', async () => {
    markShippedSpy.mockResolvedValue(shippedJob({ pdf_url: null }));
    await expect(shipJobAction('job-1', fd())).rejects.toBeInstanceOf(RedirectSentinel);
    expect(sendEmailSpy).not.toHaveBeenCalled();
    expect(updateJobNotificationStatusSpy).toHaveBeenCalledWith('job-1', {
      notificationSentAt: null,
      notificationMessageId: null,
      notificationError: expect.stringMatching(/no PDF URL/i),
    });
    // Audit-trail: Sentry sees a warning-level message (not exception).
    expect(sentryCaptureMessageSpy).toHaveBeenCalledWith(
      'Ship notification skipped — no PDF URL',
      expect.objectContaining({
        level: 'warning',
        tags: expect.objectContaining({ skip: 'no-pdf-url' }),
      }),
    );
    expect(sentryCaptureExceptionSpy).not.toHaveBeenCalled();
    expect(redirectSpy).toHaveBeenCalledWith('/admin/orders');
  });

  it('order missing: Sentry-captures + records "order not found" + skips send + redirects', async () => {
    getOrderByIdSpy.mockResolvedValue(null);
    await expect(shipJobAction('job-1', fd())).rejects.toBeInstanceOf(RedirectSentinel);
    expect(sendEmailSpy).not.toHaveBeenCalled();
    expect(updateJobNotificationStatusSpy).toHaveBeenCalledWith('job-1', {
      notificationSentAt: null,
      notificationMessageId: null,
      notificationError: expect.stringMatching(/order not found/i),
    });
    expect(sentryCaptureExceptionSpy).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringMatching(/order not found/i) }),
      expect.objectContaining({
        tags: expect.objectContaining({ failure: 'order-missing' }),
      }),
    );
    expect(redirectSpy).toHaveBeenCalledWith('/admin/orders');
  });

  it('sendEmail failure: records notification_error, no Sentry capture from action (send.ts already did)', async () => {
    sendEmailSpy.mockResolvedValue({
      success: false,
      error: 'Resend rejected: invalid recipient',
    });
    await expect(shipJobAction('job-1', fd())).rejects.toBeInstanceOf(RedirectSentinel);
    expect(updateJobNotificationStatusSpy).toHaveBeenCalledWith('job-1', {
      notificationSentAt: null,
      notificationMessageId: null,
      notificationError: 'Resend rejected: invalid recipient',
    });
    // shipJobAction does NOT capture — sendEmail() already captured
    // with full context. Double-capture would just be noise.
    expect(sentryCaptureExceptionSpy).not.toHaveBeenCalled();
    expect(redirectSpy).toHaveBeenCalledWith('/admin/orders');
  });

  it('updateJobNotificationStatus failure: Sentry captures + redirect still happens', async () => {
    updateJobNotificationStatusSpy.mockRejectedValue(new Error('PG connection dropped'));
    await expect(shipJobAction('job-1', fd())).rejects.toBeInstanceOf(RedirectSentinel);
    expect(sentryCaptureExceptionSpy).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringMatching(/PG connection/) }),
      expect.objectContaining({
        tags: expect.objectContaining({ failure: 'notification-status-persist' }),
      }),
    );
    // Ship + email steps still ran.
    expect(markShippedSpy).toHaveBeenCalled();
    expect(sendEmailSpy).toHaveBeenCalled();
    expect(redirectSpy).toHaveBeenCalledWith('/admin/orders');
  });

  it('markShipped failure: nothing downstream runs, error propagates', async () => {
    markShippedSpy.mockRejectedValue(new Error('Invalid status transition'));
    await expect(shipJobAction('job-1', fd())).rejects.toThrow(/Invalid status transition/);
    expect(getOrderByIdSpy).not.toHaveBeenCalled();
    expect(sendEmailSpy).not.toHaveBeenCalled();
    expect(updateJobNotificationStatusSpy).not.toHaveBeenCalled();
    expect(redirectSpy).not.toHaveBeenCalled();
  });
});

describe('retryJobAction', () => {
  beforeEach(() => {
    retrySpy.mockReset();
    inngestSendSpy.mockReset();
    revalidatePathSpy.mockReset();
    redirectSpy.mockReset();
    adminUsernameSpy.mockReset();
    adminUsernameSpy.mockReturnValue('adro');
    retrySpy.mockResolvedValue({
      id: 'job-1',
      order_id: 'order-1',
      status: 'running',
      attempt_count: 2,
    });
    inngestSendSpy.mockResolvedValue({ ids: ['evt_retry'] });
  });

  it('calls retry + dispatches pipeline/job.retried with previousAttemptCount = attempt_count - 1', async () => {
    await expect(
      retryJobAction('job-1', fd({ review_notes: 'try once more' })),
    ).rejects.toBeInstanceOf(RedirectSentinel);
    expect(retrySpy).toHaveBeenCalledWith('job-1');
    expect(inngestSendSpy).toHaveBeenCalledWith({
      name: 'pipeline/job.retried',
      data: {
        jobId: 'job-1',
        orderId: 'order-1',
        retryReason: 'try once more',
        previousAttemptCount: 1,
      },
    });
    expect(revalidatePathSpy).toHaveBeenCalledWith('/admin/orders', 'layout');
    expect(revalidatePathSpy).toHaveBeenCalledWith('/admin/orders/job-1');
    expect(redirectSpy).toHaveBeenCalledWith('/admin/orders/job-1');
  });

  it('falls back to "Manual retry by <admin>" when notes are empty', async () => {
    await expect(retryJobAction('job-1', fd())).rejects.toBeInstanceOf(RedirectSentinel);
    expect(inngestSendSpy.mock.calls[0]![0]!.data.retryReason).toBe('Manual retry by adro');
  });

  it('floors previousAttemptCount at 0 when retry somehow returns attempt_count=0', async () => {
    retrySpy.mockResolvedValue({
      id: 'job-1',
      order_id: 'order-1',
      status: 'running',
      attempt_count: 0,
    });
    await expect(retryJobAction('job-1', fd())).rejects.toBeInstanceOf(RedirectSentinel);
    expect(inngestSendSpy.mock.calls[0]![0]!.data.previousAttemptCount).toBe(0);
  });
});

describe('cancelJobAction', () => {
  beforeEach(() => {
    markCancelledSpy.mockReset();
    revalidatePathSpy.mockReset();
    redirectSpy.mockReset();
    adminUsernameSpy.mockReset();
    adminUsernameSpy.mockReturnValue('adro');
    clearReviewArtifactsSpy.mockReset();
    sentryCaptureExceptionSpy.mockReset();
    markCancelledSpy.mockResolvedValue({ id: 'job-1', order_id: 'order-1', status: 'cancelled' });
    clearReviewArtifactsSpy.mockResolvedValue({ deleted: 0 });
  });

  it('calls markCancelled with admin + notes + redirects to list', async () => {
    await expect(
      cancelJobAction('job-1', fd({ review_notes: 'customer changed their mind' })),
    ).rejects.toBeInstanceOf(RedirectSentinel);
    expect(markCancelledSpy).toHaveBeenCalledWith('job-1', {
      reviewedBy: 'adro',
      reviewNotes: 'customer changed their mind',
    });
    expect(redirectSpy).toHaveBeenCalledWith('/admin/orders');
  });

  it('clears review artifacts too — cancel is also an exit from awaiting_review', async () => {
    await expect(cancelJobAction('job-1', fd())).rejects.toBeInstanceOf(RedirectSentinel);
    expect(clearReviewArtifactsSpy).toHaveBeenCalledWith('order-1');
    expect(sentryCaptureExceptionSpy).not.toHaveBeenCalled();
  });

  it('cancel cleanup failure: Sentry ops-alert, cancel still completes + redirects', async () => {
    clearReviewArtifactsSpy.mockRejectedValue(new Error('cleanup incomplete'));
    await expect(cancelJobAction('job-1', fd())).rejects.toBeInstanceOf(RedirectSentinel);
    expect(redirectSpy).toHaveBeenCalledWith('/admin/orders');
    expect(sentryCaptureExceptionSpy).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        tags: expect.objectContaining({ component: 'cancel-job-action', failure: 'review-cleanup' }),
        extra: expect.objectContaining({ orderId: 'order-1' }),
      }),
    );
  });

  it('passes reviewNotes=undefined when textarea is empty', async () => {
    await expect(cancelJobAction('job-1', fd())).rejects.toBeInstanceOf(RedirectSentinel);
    expect(markCancelledSpy).toHaveBeenCalledWith('job-1', {
      reviewedBy: 'adro',
      reviewNotes: undefined,
    });
  });
});
