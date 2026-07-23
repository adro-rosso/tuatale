// reapReviewArtifacts orchestration — stub query + mocked clear/list. The TTL boundary and
// status scope are exercised end-to-end in the integration test; this locks the
// orchestration in CI: dry-run never deletes, apply clears each candidate, one bad order
// can't stop the sweep, and the cutoff/status filter are passed to the query.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { clearSpy, listSpy } = vi.hoisted(() => ({ clearSpy: vi.fn(), listSpy: vi.fn() }));
vi.mock('@/lib/retention/review-artifacts', () => ({
  clearReviewArtifacts: clearSpy,
  listReviewArtifacts: listSpy,
}));

import { reapReviewArtifacts } from '@/lib/retention/reap-review-artifacts';

// Chainable stub for .from('pipeline_jobs').select().in().not().lt() → { data, error }.
// Records the arguments so the TTL cutoff + status filter can be asserted.
function stubClient(jobs: unknown[], captured: Record<string, unknown>) {
  const q = {
    select: () => q,
    in: (col: string, vals: unknown) => {
      captured.inCol = col;
      captured.inVals = vals;
      return q;
    },
    not: (col: string, op: string) => {
      captured.notCol = col;
      captured.notOp = op;
      return q;
    },
    lt: (col: string, val: unknown) => {
      captured.ltCol = col;
      captured.ltVal = val;
      return Promise.resolve({ data: jobs, error: null });
    },
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { from: () => q } as any;
}

beforeEach(() => {
  clearSpy.mockReset();
  listSpy.mockReset();
});

describe('reapReviewArtifacts', () => {
  const jobs = [
    { id: 'j1', order_id: 'o1', status: 'awaiting_review', completed_at: '2026-01-01' },
    { id: 'j2', order_id: 'o2', status: 'cancelled', completed_at: '2026-01-01' },
  ];

  it('queries completed_at < cutoff for awaiting_review + cancelled only', async () => {
    const cap: Record<string, unknown> = {};
    const now = new Date('2026-09-01T00:00:00Z');
    await reapReviewArtifacts({ dryRun: true, now }, { client: stubClient([], cap) });
    expect(cap.inCol).toBe('status');
    expect(cap.inVals).toEqual(['awaiting_review', 'cancelled']);
    expect(cap.notCol).toBe('completed_at'); // completed_at IS NOT NULL
    expect(cap.ltCol).toBe('completed_at'); // the clock column, not created_at/paid_at
    // 30 days before now.
    expect(cap.ltVal).toBe(new Date(now.getTime() - 30 * 864e5).toISOString());
  });

  it('dry-run counts via list, deletes nothing', async () => {
    listSpy.mockResolvedValue(['a', 'b', 'c']);
    const rep = await reapReviewArtifacts({ dryRun: true }, { client: stubClient(jobs, {}) });
    expect(clearSpy).not.toHaveBeenCalled();
    expect(rep.ordersCleared).toBe(2);
    expect(rep.objectsDeleted).toBe(6); // 3 per order
  });

  it('apply clears each candidate and sums deletions', async () => {
    clearSpy.mockResolvedValue({ deleted: 4 });
    const rep = await reapReviewArtifacts({ dryRun: false }, { client: stubClient(jobs, {}) });
    expect(clearSpy).toHaveBeenCalledWith('o1', expect.anything());
    expect(clearSpy).toHaveBeenCalledWith('o2', expect.anything());
    expect(rep.ordersCleared).toBe(2);
    expect(rep.objectsDeleted).toBe(8);
    expect(rep.errors).toEqual([]);
  });

  it('collects a per-order error and keeps sweeping (idempotent retry next run)', async () => {
    clearSpy.mockRejectedValueOnce(new Error('boom on o1')).mockResolvedValueOnce({ deleted: 4 });
    const rep = await reapReviewArtifacts({ dryRun: false }, { client: stubClient(jobs, {}) });
    expect(rep.errors).toHaveLength(1);
    expect(rep.errors[0]).toContain('o1');
    expect(rep.ordersCleared).toBe(1); // o2 still cleared despite o1 failing
  });

  it('reports a query error without throwing', async () => {
    const q = { select: () => q, in: () => q, not: () => q, lt: () => Promise.resolve({ data: null, error: { message: 'db down' } }) };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rep = await reapReviewArtifacts({ dryRun: false }, { client: { from: () => q } as any });
    expect(rep.errors[0]).toContain('db down');
    expect(rep.scanned).toBe(0);
  });
});
