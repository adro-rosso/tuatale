/**
 * resendShipEmailAction: shipped jobs only; always signs a fresh link, stores it, sends the
 * ship template, records success/failure; never throws on a send failure.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const s = vi.hoisted(() => ({
  getJobById: vi.fn(),
  claimNotificationSend: vi.fn(),
  updateJobPdfUrl: vi.fn(),
  updateJobNotificationStatus: vi.fn(),
  getOrderById: vi.fn(),
  sendEmail: vi.fn(),
  signBookPdfUrl: vi.fn(),
  adminUsername: vi.fn(),
  revalidatePath: vi.fn(),
  redirect: vi.fn(),
  captureException: vi.fn(),
}));

class RedirectSentinel extends Error {
  constructor(public readonly url: string) { super(`REDIRECT:${url}`); }
}

vi.mock('@/db/pipeline-jobs', () => ({
  getJobById: s.getJobById,
  claimNotificationSend: s.claimNotificationSend,
  updateJobPdfUrl: s.updateJobPdfUrl,
  updateJobNotificationStatus: s.updateJobNotificationStatus,
}));
vi.mock('@/db/orders', () => ({ getOrderById: s.getOrderById }));
vi.mock('@/lib/email/send', () => ({ sendEmail: s.sendEmail }));
vi.mock('@/lib/email/book-link', () => ({ signBookPdfUrl: s.signBookPdfUrl }));
vi.mock('@/lib/admin-auth', () => ({ adminUsername: s.adminUsername }));
vi.mock('@sentry/nextjs', () => ({ captureException: s.captureException }));
vi.mock('next/cache', () => ({ revalidatePath: s.revalidatePath }));
vi.mock('next/navigation', () => ({
  redirect: (url: string) => { s.redirect(url); throw new RedirectSentinel(url); },
}));

import { resendShipEmailAction } from '@/app/admin/orders/[id]/_actions/resend-email';

const JOB = { id: 'job-1', order_id: 'order-1', status: 'shipped', notification_sent_at: null, notification_error: 'domain not verified' };
const ORDER = { id: 'order-1', customer_email: 'a@b.c', child_name: 'Eddie' };

beforeEach(() => {
  Object.values(s).forEach((f) => f.mockReset());
  s.adminUsername.mockReturnValue('adro');
  s.getJobById.mockResolvedValue(JOB);
  s.getOrderById.mockResolvedValue(ORDER);
  s.signBookPdfUrl.mockResolvedValue('https://signed/fresh.pdf');
  s.claimNotificationSend.mockResolvedValue(true);
});

describe('resendShipEmailAction', () => {
  it('signs a fresh link, stores it, sends, and records success', async () => {
    s.sendEmail.mockResolvedValue({ success: true, messageId: 'msg-1' });
    await expect(resendShipEmailAction('job-1', new FormData())).rejects.toBeInstanceOf(RedirectSentinel);
    expect(s.signBookPdfUrl).toHaveBeenCalledWith('order-1');
    expect(s.updateJobPdfUrl).toHaveBeenCalledWith('job-1', 'https://signed/fresh.pdf');
    const sent = s.sendEmail.mock.calls[0]?.[0];
    expect(JSON.stringify(sent)).toContain('https://signed/fresh.pdf');
    expect(s.updateJobNotificationStatus).toHaveBeenCalledWith('job-1', expect.objectContaining({ notificationMessageId: 'msg-1', notificationError: null }));
    expect(s.redirect).toHaveBeenCalledWith('/admin/orders/job-1');
  });

  it('records a send failure without throwing it', async () => {
    s.sendEmail.mockResolvedValue({ success: false, error: 'domain not verified' });
    await expect(resendShipEmailAction('job-1', new FormData())).rejects.toBeInstanceOf(RedirectSentinel);
    expect(s.updateJobNotificationStatus).toHaveBeenCalledWith('job-1', { notificationSentAt: null, notificationMessageId: null, notificationError: 'domain not verified' });
  });

  it('refuses a job that is not shipped (no send, no re-sign)', async () => {
    s.getJobById.mockResolvedValue({ ...JOB, status: 'awaiting_review' });
    await expect(resendShipEmailAction('job-1', new FormData())).rejects.toBeInstanceOf(RedirectSentinel);
    expect(s.signBookPdfUrl).not.toHaveBeenCalled();
    expect(s.sendEmail).not.toHaveBeenCalled();
  });

  it('ONE TIME: an already-sent email is never resent', async () => {
    s.getJobById.mockResolvedValue({ ...JOB, notification_sent_at: '2026-10-27T12:00:00Z', notification_error: null });
    await expect(resendShipEmailAction('job-1', new FormData())).rejects.toBeInstanceOf(RedirectSentinel);
    expect(s.claimNotificationSend).not.toHaveBeenCalled();
    expect(s.sendEmail).not.toHaveBeenCalled();
  });

  it('ONE TIME: a second press that loses the atomic claim sends nothing', async () => {
    s.claimNotificationSend.mockResolvedValue(false);
    await expect(resendShipEmailAction('job-1', new FormData())).rejects.toBeInstanceOf(RedirectSentinel);
    expect(s.claimNotificationSend).toHaveBeenCalledWith('job-1', 'domain not verified', expect.stringMatching(/^resend in progress since /));
    expect(s.sendEmail).not.toHaveBeenCalled();
  });

  it('ONE TIME: a fresh in-progress claim blocks; a stale (>5 min) one may be retaken', async () => {
    s.getJobById.mockResolvedValue({ ...JOB, notification_error: `resend in progress since ${new Date().toISOString()}` });
    await expect(resendShipEmailAction('job-1', new FormData())).rejects.toBeInstanceOf(RedirectSentinel);
    expect(s.sendEmail).not.toHaveBeenCalled();
    s.getJobById.mockResolvedValue({ ...JOB, notification_error: `resend in progress since ${new Date(Date.now() - 10 * 60_000).toISOString()}` });
    s.sendEmail.mockResolvedValue({ success: true, messageId: 'm2' });
    await expect(resendShipEmailAction('job-1', new FormData())).rejects.toBeInstanceOf(RedirectSentinel);
    expect(s.sendEmail).toHaveBeenCalledTimes(1);
  });

  it('a signing failure is recorded, nothing is sent', async () => {
    s.signBookPdfUrl.mockRejectedValue(new Error('bucket down'));
    await expect(resendShipEmailAction('job-1', new FormData())).rejects.toBeInstanceOf(RedirectSentinel);
    expect(s.sendEmail).not.toHaveBeenCalled();
    expect(s.updateJobNotificationStatus).toHaveBeenCalledWith('job-1', expect.objectContaining({ notificationError: expect.stringContaining('bucket down') }));
  });
});
