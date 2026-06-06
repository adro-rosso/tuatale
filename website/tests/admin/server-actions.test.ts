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
  adminUsernameSpy,
  inngestSendSpy,
  revalidatePathSpy,
  redirectSpy,
} = vi.hoisted(() => ({
  markShippedSpy: vi.fn(),
  markCancelledSpy: vi.fn(),
  retrySpy: vi.fn(),
  updateReviewNotesSpy: vi.fn(),
  adminUsernameSpy: vi.fn(),
  inngestSendSpy: vi.fn(),
  revalidatePathSpy: vi.fn(),
  redirectSpy: vi.fn(),
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
  beforeEach(() => {
    markShippedSpy.mockReset();
    revalidatePathSpy.mockReset();
    redirectSpy.mockReset();
    adminUsernameSpy.mockReset();
    adminUsernameSpy.mockReturnValue('adro');
    markShippedSpy.mockResolvedValue({ id: 'job-1', status: 'shipped' });
  });

  it('calls markShipped with the admin username + trimmed notes + redirects to list', async () => {
    await expect(
      shipJobAction('job-1', fd({ review_notes: '  looks good  ' })),
    ).rejects.toBeInstanceOf(RedirectSentinel);
    expect(markShippedSpy).toHaveBeenCalledWith('job-1', {
      reviewedBy: 'adro',
      reviewNotes: 'looks good',
    });
    expect(revalidatePathSpy).toHaveBeenCalledWith('/admin/orders', 'layout');
    expect(redirectSpy).toHaveBeenCalledWith('/admin/orders');
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
    markCancelledSpy.mockResolvedValue({ id: 'job-1', status: 'cancelled' });
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

  it('passes reviewNotes=undefined when textarea is empty', async () => {
    await expect(cancelJobAction('job-1', fd())).rejects.toBeInstanceOf(RedirectSentinel);
    expect(markCancelledSpy).toHaveBeenCalledWith('job-1', {
      reviewedBy: 'adro',
      reviewNotes: undefined,
    });
  });
});
