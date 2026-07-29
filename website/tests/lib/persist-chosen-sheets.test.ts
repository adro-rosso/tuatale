// @vitest-environment node
/**
 * persistChosenSheetsForOrder (Slice 4) — the durable copy at order creation, with Supabase
 * Storage + the order update mocked. Covers HAPPY (preview→books/chosen + imagePath rewrite),
 * DEGRADE B (copy fails → degraded + order proceeds, never throws), IDEMPOTENT (already-durable
 * → no re-copy), and a secondary pick.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const downloadMock = vi.fn();
const uploadMock = vi.fn();
const updateEqMock = vi.fn();
const fromStorage = vi.fn(() => ({ download: downloadMock, upload: uploadMock }));
const fromTable = vi.fn(() => ({ update: (obj: unknown) => ({ eq: (_col: string, id: string) => updateEqMock(obj, id) }) }));

vi.mock('@/lib/supabase', () => ({
  createServerClient: () => ({ storage: { from: fromStorage }, from: fromTable }),
}));

import { persistChosenSheetsForOrder, durableChosenPath } from '@/lib/checkout/persist-chosen-sheets';

beforeEach(() => {
  vi.clearAllMocks();
  uploadMock.mockResolvedValue({ error: null });
  updateEqMock.mockResolvedValue({ error: null });
  downloadMock.mockResolvedValue({ data: { arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer }, error: null });
});

describe('persistChosenSheetsForOrder', () => {
  it('HAPPY: copies preview → books/chosen and rewrites imagePath to the durable path', async () => {
    const order = { id: 'o1', chosen_sheet: { subjectId: 'protagonist', previewId: 'p', imagePath: 'previews/p.png' }, secondaries: [] };
    await persistChosenSheetsForOrder(order);
    expect(downloadMock).toHaveBeenCalledWith('previews/p.png');
    expect(uploadMock).toHaveBeenCalledWith(durableChosenPath('o1', 'protagonist'), expect.anything(), expect.objectContaining({ upsert: true }));
    const [obj] = updateEqMock.mock.calls[0]!;
    expect((obj as { chosen_sheet: { imagePath: string; degraded?: boolean } }).chosen_sheet.imagePath).toBe('orders/o1/chosen/protagonist.png');
    expect((obj as { chosen_sheet: { degraded?: boolean } }).chosen_sheet.degraded).toBeFalsy();
  });

  it('DEGRADE B: copy failure → pick marked degraded, order PROCEEDS (never throws)', async () => {
    downloadMock.mockResolvedValue({ data: null, error: { message: 'preview gone' } });
    const order = { id: 'o1', chosen_sheet: { subjectId: 'protagonist', previewId: 'p', imagePath: 'previews/p.png' }, secondaries: [] };
    await expect(persistChosenSheetsForOrder(order)).resolves.toBeUndefined(); // never throws
    const [obj] = updateEqMock.mock.calls[0]!;
    const cs = (obj as { chosen_sheet: { degraded: boolean; degradedReason: string } }).chosen_sheet;
    expect(cs.degraded).toBe(true);
    expect(cs.degradedReason).toBe('copy_failed_at_order');
  });

  it('IDEMPOTENT: an already-durable imagePath is NOT re-copied (webhook replay-safe)', async () => {
    const order = { id: 'o1', chosen_sheet: { subjectId: 'protagonist', imagePath: 'orders/o1/chosen/protagonist.png' }, secondaries: [] };
    await persistChosenSheetsForOrder(order);
    expect(downloadMock).not.toHaveBeenCalled();
    expect(uploadMock).not.toHaveBeenCalled();
  });

  it('no chosen_sheet → no storage ops, no order update (byte-identical path)', async () => {
    await persistChosenSheetsForOrder({ id: 'o1', chosen_sheet: null, secondaries: [] });
    expect(downloadMock).not.toHaveBeenCalled();
    expect(uploadMock).not.toHaveBeenCalled();
    expect(updateEqMock).not.toHaveBeenCalled();
  });

  it('secondary pick is copied to its companion durable path', async () => {
    const order = { id: 'o1', chosen_sheet: null, secondaries: [{ id: 'companion-1', chosen_sheet: { imagePath: 'previews/s.png' } }] };
    await persistChosenSheetsForOrder(order);
    expect(uploadMock).toHaveBeenCalledWith(durableChosenPath('o1', 'companion-1'), expect.anything(), expect.anything());
  });
});
