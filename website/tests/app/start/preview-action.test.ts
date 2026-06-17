/**
 * requestPreview / getPreviewStatus server actions (S-C). Verifies the cache
 * short-circuit (no spend) and the create-row + dispatch-event path, with the
 * data layer + Inngest mocked.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/preview/preview-jobs', () => ({
  findCachedPreview: vi.fn(),
  createPreviewJob: vi.fn(),
  getPreviewJob: vi.fn(),
}));
vi.mock('@/lib/inngest/client', () => ({ inngest: { send: vi.fn() } }));
vi.mock('@/lib/supabase', () => ({ createServerClient: vi.fn() }));

import { requestPreview, getPreviewStatus, uploadPhoto } from '@/app/start/_actions/preview';
import { createServerClient } from '@/lib/supabase';
import { findCachedPreview, createPreviewJob, getPreviewJob } from '@/lib/preview/preview-jobs';
import { inngest } from '@/lib/inngest/client';

beforeEach(() => vi.clearAllMocks());

describe('requestPreview', () => {
  const input = { age: 7, gender: 'girl', features: { hair_colour: 'brown', eye_colour: 'green' }, style: 'ink_wash', draftId: 'draft-1' };

  it('CACHE HIT: returns the stored image, no row created, no event sent (no spend)', async () => {
    (findCachedPreview as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'p-old', status: 'done', image_url: 'https://x/p.png' });
    const r = await requestPreview(input);
    expect(r).toEqual({ previewId: 'p-old', status: 'done', imageUrl: 'https://x/p.png', cached: true });
    expect(createPreviewJob).not.toHaveBeenCalled();
    expect(inngest.send).not.toHaveBeenCalled();
  });

  it('CACHE MISS: creates a queued row + sends preview/requested', async () => {
    (findCachedPreview as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (createPreviewJob as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'p-new', status: 'queued', input_hash: 'h' });
    const r = await requestPreview(input);
    expect(r).toEqual({ previewId: 'p-new', status: 'queued', cached: false });
    expect(createPreviewJob).toHaveBeenCalledOnce();
    expect((createPreviewJob as ReturnType<typeof vi.fn>).mock.calls[0]![0]).toMatchObject({ draftId: 'draft-1' });
    expect(inngest.send).toHaveBeenCalledOnce();
    const sent = (inngest.send as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(sent.name).toBe('preview/requested');
    // W-F: the chosen art style rides the event so the worker mints in it.
    expect(sent.data).toMatchObject({ previewId: 'p-new', age: 7, features: input.features, style: 'ink_wash' });
  });

  it('W-F: switching style changes the cache lookup hash (re-mints per style)', async () => {
    (findCachedPreview as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (createPreviewJob as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'p', status: 'queued', input_hash: 'h' });
    await requestPreview({ ...input, style: 'watercolour' });
    await requestPreview({ ...input, style: 'cutpaper' });
    const h1 = (findCachedPreview as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    const h2 = (findCachedPreview as ReturnType<typeof vi.fn>).mock.calls[1]![0];
    expect(h1).not.toBe(h2);
  });

  it('CACHE: identical inputs produce the same lookup hash both calls', async () => {
    (findCachedPreview as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (createPreviewJob as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'p', status: 'queued', input_hash: 'h' });
    await requestPreview(input);
    await requestPreview({ ...input, features: { ...input.features } });
    const h1 = (findCachedPreview as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    const h2 = (findCachedPreview as ReturnType<typeof vi.fn>).mock.calls[1]![0];
    expect(h1).toBe(h2);
  });
});

describe('getPreviewStatus', () => {
  it('returns the row status + url', async () => {
    (getPreviewJob as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'p', status: 'done', image_url: 'u' });
    expect(await getPreviewStatus('p')).toEqual({ previewId: 'p', status: 'done', imageUrl: 'u', cached: false });
  });
  it('missing row → failed', async () => {
    (getPreviewJob as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    expect(await getPreviewStatus('gone')).toMatchObject({ status: 'failed' });
  });
});

describe('uploadPhoto (test-wiring)', () => {
  it('uploads the PNG to the bucket and returns a content-hashed path', async () => {
    const upload = vi.fn().mockResolvedValue({ error: null });
    (createServerClient as ReturnType<typeof vi.fn>).mockReturnValue({ storage: { from: () => ({ upload }) } });
    const fd = new FormData();
    fd.append('photo', new File([Uint8Array.from([1, 2, 3])], 'me.png', { type: 'image/png' }));
    const r = await uploadPhoto(fd);
    expect(r.photoPath).toMatch(/^uploads\/[a-f0-9]{64}\.png$/);
    expect(r.photoHash).toHaveLength(64);
    expect(upload).toHaveBeenCalledOnce();
  });
});
