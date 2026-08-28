/**
 * 30-day post-ship order-photo reaper. Deletes a shipped order's SOURCE photos after the
 * TTL, clears the references (order + converted draft), and is dry-run by default +
 * idempotent. Errors are collected, not thrown.
 */
import { describe, it, expect } from 'vitest';
import { reapShippedOrderPhotos } from '@/lib/retention/reap-order-photos';
import type { TuataleSupabaseClient } from '@/lib/supabase';

type Order = { id: string; photo_urls: unknown; converted_from_draft_id: string | null };

function fakeClient({
  jobs = [],
  orders = {},
  removeError = null,
}: {
  jobs?: { order_id: string; shipped_at: string }[];
  orders?: Record<string, Order>;
  removeError?: string | null;
}) {
  const removed: string[][] = [];
  const orderUpdates: { id: string; patch: Record<string, unknown> }[] = [];
  const draftUpdates: { id: string; patch: Record<string, unknown> }[] = [];
  const client = {
    from(table: string) {
      if (table === 'pipeline_jobs') {
        return { select: () => ({ eq: () => ({ lt: () => Promise.resolve({ data: jobs, error: null }) }) }) };
      }
      if (table === 'orders') {
        return {
          select: () => ({
            eq: (_c: string, id: string) => ({
              single: () =>
                Promise.resolve(orders[id] ? { data: orders[id], error: null } : { data: null, error: { message: 'not found' } }),
            }),
          }),
          update: (patch: Record<string, unknown>) => ({
            eq: (_c: string, id: string) => {
              orderUpdates.push({ id, patch });
              return Promise.resolve({ error: null });
            },
          }),
        };
      }
      if (table === 'drafts') {
        return {
          update: (patch: Record<string, unknown>) => ({
            eq: (_c: string, id: string) => {
              draftUpdates.push({ id, patch });
              return Promise.resolve({ error: null });
            },
          }),
        };
      }
      return {};
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
  return { client: client as unknown as TuataleSupabaseClient, removed, orderUpdates, draftUpdates };
}

const order1: Order = {
  id: 'order-1',
  photo_urls: { child: ['uploads/d/a.png', 'uploads/d/b.png'] },
  converted_from_draft_id: 'd',
};

describe('reapShippedOrderPhotos', () => {
  it('no shipped jobs past TTL → nothing scanned or deleted', async () => {
    const { client, removed } = fakeClient({ jobs: [] });
    const r = await reapShippedOrderPhotos({ dryRun: false }, client);
    expect(r.scanned).toBe(0);
    expect(r.ordersErased).toBe(0);
    expect(removed).toEqual([]);
  });

  it('DRY-RUN: reports what would be erased, touches nothing', async () => {
    const { client, removed, orderUpdates } = fakeClient({
      jobs: [{ order_id: 'order-1', shipped_at: '2020-01-01T00:00:00Z' }],
      orders: { 'order-1': order1 },
    });
    const r = await reapShippedOrderPhotos({ dryRun: true }, client);
    expect(r.scanned).toBe(1);
    expect(r.photosDeleted).toEqual(['uploads/d/a.png', 'uploads/d/b.png']);
    expect(removed).toEqual([]); // no delete
    expect(orderUpdates).toEqual([]); // no reference clearing
  });

  it('APPLY: deletes the objects and clears BOTH references (order + converted draft)', async () => {
    const { client, removed, orderUpdates, draftUpdates } = fakeClient({
      jobs: [{ order_id: 'order-1', shipped_at: '2020-01-01T00:00:00Z' }],
      orders: { 'order-1': order1 },
    });
    const r = await reapShippedOrderPhotos({ dryRun: false }, client);
    expect(r.ordersErased).toBe(1);
    expect(removed).toEqual([['uploads/d/a.png', 'uploads/d/b.png']]);
    expect(orderUpdates).toEqual([{ id: 'order-1', patch: { photo_urls: {} } }]);
    expect(draftUpdates[0]).toMatchObject({ id: 'd', patch: { photo_urls: {}, photo_consent_at: null } });
  });

  it('IDEMPOTENT: an order whose photos were already erased is a no-op', async () => {
    const { client, removed } = fakeClient({
      jobs: [{ order_id: 'order-1', shipped_at: '2020-01-01T00:00:00Z' }],
      orders: { 'order-1': { id: 'order-1', photo_urls: {}, converted_from_draft_id: 'd' } },
    });
    const r = await reapShippedOrderPhotos({ dryRun: false }, client);
    expect(r.scanned).toBe(0);
    expect(removed).toEqual([]);
  });

  it('a storage-remove failure is COLLECTED (not thrown) and does not count as erased', async () => {
    const { client, orderUpdates } = fakeClient({
      jobs: [{ order_id: 'order-1', shipped_at: '2020-01-01T00:00:00Z' }],
      orders: { 'order-1': order1 },
      removeError: 'S3 down',
    });
    const r = await reapShippedOrderPhotos({ dryRun: false }, client);
    expect(r.errors.length).toBe(1);
    expect(r.ordersErased).toBe(0);
    expect(orderUpdates).toEqual([]); // references kept for retry
  });
});
