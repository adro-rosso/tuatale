/**
 * E1 cascade-deletion tests. The load-bearing ones are the RULE tests: delete only
 * from the row's own path list, and never delete a path a surviving row still needs
 * (the ae04d56c dangling-reference failure mode).
 */
import { describe, it, expect } from 'vitest';
import { collectPhotoPaths, reapExpiredDrafts } from '@/lib/retention/reap-drafts';

type Row = { id: string; photo_urls: unknown };

/**
 * Minimal Supabase double. Records every Storage remove + row delete so the tests can
 * assert on exactly what was touched — and, just as importantly, what wasn't.
 */
function fakeClient({
  expired = [],
  drafts = [],
  orders = [],
  removeError = null,
}: { expired?: Row[]; drafts?: Row[]; orders?: Row[]; removeError?: string | null }) {
  const removed: string[][] = [];
  const deletedIds: string[] = [];
  const client = {
    from(table: string) {
      const all: Row[] = table === 'orders' ? orders : drafts;
      return {
        select: () => ({
          // reapExpiredDrafts's expired query chains .lt().neq(); the plain
          // select() (no chain) is the surviving-reference scan.
          lt: () => ({ neq: () => Promise.resolve({ data: expired, error: null }) }),
          then: (res: (v: { data: Row[]; error: null }) => unknown) => res({ data: all, error: null }),
        }),
        delete: () => ({
          eq: (_c: string, id: string) => {
            deletedIds.push(id);
            return Promise.resolve({ error: null });
          },
        }),
      };
    },
    storage: {
      from: () => ({
        remove: (paths: string[]) => {
          removed.push(paths);
          return Promise.resolve({ error: removeError ? { message: removeError } : null });
        },
      }),
    },
  };
  return { client: client as never, removed, deletedIds };
}

describe('collectPhotoPaths', () => {
  it('handles the child ARRAY shape and the pet OBJECT shape', () => {
    expect(collectPhotoPaths(['uploads/a.png'])).toEqual(['uploads/a.png']);
    expect(collectPhotoPaths({ pet: ['uploads/a.png', 'uploads/b.png'] })).toEqual([
      'uploads/a.png',
      'uploads/b.png',
    ]);
  });

  it('returns ONLY uploads/ paths — a book PDF or rendered preview is never deletable here', () => {
    expect(collectPhotoPaths({ pet: ['uploads/a.png'], cover: 'previews/x.png', pdf: 'orders/1/book.pdf' }))
      .toEqual(['uploads/a.png']);
  });

  // `_dangling_photos` records objects that are already gone (2026-07-16 tidy). It is
  // metadata, not a live reference — counting it would make the reaper "retain"
  // nonexistent objects and re-flag corrected rows as broken.
  it('skips _-prefixed metadata keys', () => {
    expect(
      collectPhotoPaths({
        pet: ['uploads/live.png'],
        _dangling_photos: ['uploads/gone.png'],
        _dangling_note: 'removed by the residue cleanup',
      }),
    ).toEqual(['uploads/live.png']);
  });

  it('tolerates empty/garbage without throwing (photo_urls defaults to [] or {})', () => {
    expect(collectPhotoPaths([])).toEqual([]);
    expect(collectPhotoPaths({})).toEqual([]);
    expect(collectPhotoPaths(null)).toEqual([]);
    expect(collectPhotoPaths(42)).toEqual([]);
  });
});

describe('reapExpiredDrafts', () => {
  it('DRY-RUN BY DEFAULT: reports what would go, deletes nothing', async () => {
    const { client, removed, deletedIds } = fakeClient({
      expired: [{ id: 'd1', photo_urls: { pet: ['uploads/d1/a.png'] } }],
    });
    const r = await reapExpiredDrafts({}, client);
    expect(r.dryRun).toBe(true);
    expect(r.photosDeleted).toEqual(['uploads/d1/a.png']);
    expect(removed).toEqual([]);
    expect(deletedIds).toEqual([]);
  });

  it('CASCADE: deletes the photos THEN the row', async () => {
    const { client, removed, deletedIds } = fakeClient({
      expired: [{ id: 'd1', photo_urls: { pet: ['uploads/d1/a.png', 'uploads/d1/b.png'] } }],
    });
    const r = await reapExpiredDrafts({ dryRun: false }, client);
    expect(removed).toEqual([['uploads/d1/a.png', 'uploads/d1/b.png']]);
    expect(deletedIds).toEqual(['d1']);
    expect(r.draftsReaped).toBe(1);
  });

  // RULE 2 — the ae04d56c failure mode. Legacy paths are content-hashed, so two rows
  // can share one object; deleting on the first reap strands the second.
  it('REFERENTIAL: never deletes a path a PAID ORDER still references', async () => {
    const shared = 'uploads/deadbeef.png';
    const { client, removed, deletedIds } = fakeClient({
      expired: [{ id: 'd1', photo_urls: { pet: [shared] } }],
      orders: [{ id: 'o1', photo_urls: { pet: [shared] } }],
    });
    const r = await reapExpiredDrafts({ dryRun: false }, client);
    expect(removed).toEqual([]);                       // photo survives
    expect(deletedIds).toEqual(['d1']);                // row still reaped
    expect(r.photosRetained.map((p) => p.path)).toEqual([shared]);
  });

  it('REFERENTIAL: never deletes a path a SURVIVING DRAFT still references', async () => {
    const shared = 'uploads/deadbeef.png';
    const { client, removed } = fakeClient({
      expired: [{ id: 'd1', photo_urls: [shared] }],
      drafts: [
        { id: 'd1', photo_urls: [shared] },
        { id: 'd2', photo_urls: [shared] }, // not expired → survives
      ],
    });
    await reapExpiredDrafts({ dryRun: false }, client);
    expect(removed).toEqual([]);
  });

  it('REFERENTIAL: a path held only by OTHER EXPIRED drafts is still deletable', async () => {
    const shared = 'uploads/deadbeef.png';
    const expired = [
      { id: 'd1', photo_urls: [shared] },
      { id: 'd2', photo_urls: [shared] },
    ];
    const { client, removed } = fakeClient({ expired, drafts: expired });
    await reapExpiredDrafts({ dryRun: false }, client);
    expect(removed.flat()).toContain(shared);
  });

  // Losing the row while the object survives is the permanent-orphan state this whole
  // fix exists to prevent, so a failed Storage delete must NOT proceed to the row.
  it('SAFETY: a Storage failure keeps the row (retryable, never orphaned)', async () => {
    const { client, deletedIds } = fakeClient({
      expired: [{ id: 'd1', photo_urls: ['uploads/d1/a.png'] }],
      removeError: 'network',
    });
    const r = await reapExpiredDrafts({ dryRun: false }, client);
    expect(deletedIds).toEqual([]);
    expect(r.draftsReaped).toBe(0);
    expect(r.errors[0]).toMatch(/storage remove/i);
  });

  it('reaps a photo-less draft cleanly (most drafts have no photos)', async () => {
    const { client, removed, deletedIds } = fakeClient({ expired: [{ id: 'd1', photo_urls: [] }] });
    await reapExpiredDrafts({ dryRun: false }, client);
    expect(removed).toEqual([]);
    expect(deletedIds).toEqual(['d1']);
  });
});
