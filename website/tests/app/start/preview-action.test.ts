/**
 * requestPreview / getPreviewStatus server actions (S-C). Verifies the cache
 * short-circuit (no spend) and the create-row + dispatch-event path, with the
 * data layer + Inngest mocked.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/preview/preview-jobs', () => ({
  findCachedPreview: vi.fn(),
  createPreviewJob: vi.fn(),
  getPreviewJob: vi.fn(),
  countPreviewsForDraft: vi.fn(),
  countPreviewsForDraftSince: vi.fn(),
}));
vi.mock('@/lib/inngest/client', () => ({ inngest: { send: vi.fn() } }));
vi.mock('@/lib/supabase', () => ({ createServerClient: vi.fn() }));
vi.mock('@/lib/draft-cookie', () => ({ getDraftCookieFromRequest: vi.fn() }));
vi.mock('@/db/drafts', () => ({ getDraftByCookieId: vi.fn() }));

import { requestPreview, getPreviewStatus, uploadPhoto, uploadPetPhoto } from '@/app/start/_actions/preview';
import { getDraftCookieFromRequest } from '@/lib/draft-cookie';
import { getDraftByCookieId } from '@/db/drafts';
import { createServerClient } from '@/lib/supabase';
import {
  findCachedPreview,
  createPreviewJob,
  getPreviewJob,
  countPreviewsForDraft,
  countPreviewsForDraftSince,
} from '@/lib/preview/preview-jobs';
import { inngest } from '@/lib/inngest/client';

beforeEach(() => {
  vi.clearAllMocks();
  // S-E cost-control defaults: under cap, no recent gens (happy path proceeds).
  (countPreviewsForDraft as ReturnType<typeof vi.fn>).mockResolvedValue(0);
  (countPreviewsForDraftSince as ReturnType<typeof vi.fn>).mockResolvedValue(0);
});

describe('requestPreview', () => {
  const input = { age: 7, gender: 'girl', features: { hair_colour: 'brown', eye_colour: 'green' }, style: 'ink_wash', draftId: 'draft-1' };

  it('CACHE HIT: returns the stored image, no row created, no event sent (no spend)', async () => {
    (findCachedPreview as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'p-old', status: 'done', image_url: 'https://x/p.png', bg_color: '#fdfaee' });
    const r = await requestPreview(input);
    expect(r).toEqual({ previewId: 'p-old', status: 'done', imageUrl: 'https://x/p.png', bgColor: '#fdfaee', cached: true });
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

  // ---- S-E cost-control ----
  it('COST: no draftId → blocked (capped), no row/event (cap/rate-limit need a key)', async () => {
    (findCachedPreview as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const r = await requestPreview({ ...input, draftId: undefined });
    expect(r.blocked).toBe('capped');
    expect(createPreviewJob).not.toHaveBeenCalled();
    expect(inngest.send).not.toHaveBeenCalled();
  });

  it('COST: at the free-preview cap → blocked (capped), no spend', async () => {
    (findCachedPreview as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (countPreviewsForDraft as ReturnType<typeof vi.fn>).mockResolvedValue(10); // == FREE_PREVIEW_CAP
    const r = await requestPreview(input);
    expect(r.blocked).toBe('capped');
    expect(createPreviewJob).not.toHaveBeenCalled();
    expect(inngest.send).not.toHaveBeenCalled();
  });

  it('COST: a recent gen within the burst window → blocked (rate_limited), no spend', async () => {
    (findCachedPreview as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (countPreviewsForDraftSince as ReturnType<typeof vi.fn>).mockResolvedValue(1); // burst ≥ 1
    const r = await requestPreview(input);
    expect(r.blocked).toBe('rate_limited');
    expect(createPreviewJob).not.toHaveBeenCalled();
    expect(inngest.send).not.toHaveBeenCalled();
  });

  // ---- D: photoPath ownership ----
  // photoPath was forwarded verbatim into the Inngest event; the worker fetches it by
  // raw Storage key, so naming another prefix pulled a stranger's image into your gen.
  it('SECURITY: a photoPath outside the caller\'s own draft prefix is blocked, no spend', async () => {
    (findCachedPreview as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const r = await requestPreview({ ...input, photoPath: 'uploads/draft-2/deadbeef.png' });
    expect(r.blocked).toBe('capped');
    expect(createPreviewJob).not.toHaveBeenCalled();
    expect(inngest.send).not.toHaveBeenCalled();
  });

  it('SECURITY: traversal out of the prefix is blocked', async () => {
    (findCachedPreview as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const r = await requestPreview({ ...input, photoPath: 'uploads/draft-1/../draft-2/x.png' });
    expect(r.blocked).toBe('capped');
    expect(inngest.send).not.toHaveBeenCalled();
  });

  it('SECURITY: the caller\'s OWN photoPath still flows through to the worker', async () => {
    (findCachedPreview as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (createPreviewJob as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'p-new', status: 'queued', input_hash: 'h' });
    const photoPath = 'uploads/draft-1/abc.png';
    await requestPreview({ ...input, photoPath });
    expect((inngest.send as ReturnType<typeof vi.fn>).mock.calls[0]![0].data).toMatchObject({ photoPath });
  });

  it('COST: a cache HIT is never capped/rate-limited (free, no counts checked)', async () => {
    (findCachedPreview as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'p-old', status: 'done', image_url: 'u' });
    (countPreviewsForDraft as ReturnType<typeof vi.fn>).mockResolvedValue(999);
    const r = await requestPreview(input);
    expect(r).toMatchObject({ status: 'done', cached: true });
    expect(r.blocked).toBeUndefined();
  });
});

describe('getPreviewStatus', () => {
  it('returns the row status + url', async () => {
    (getPreviewJob as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'p', status: 'done', image_url: 'u', bg_color: '#fdfaee' });
    expect(await getPreviewStatus('p')).toEqual({ previewId: 'p', status: 'done', imageUrl: 'u', bgColor: '#fdfaee', cached: false });
  });
  it('missing row → failed', async () => {
    (getPreviewJob as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    expect(await getPreviewStatus('gone')).toMatchObject({ status: 'failed' });
  });
});

describe('uploadPhoto — CHILD-photo gate (security)', () => {
  const ORIGINAL = process.env.CHILD_PHOTO_UPLOAD;
  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.CHILD_PHOTO_UPLOAD;
    else process.env.CHILD_PHOTO_UPLOAD = ORIGINAL;
  });

  // The load-bearing test. A Server Action is a POST endpoint whose id ships in the
  // client bundle, so "the UI doesn't render it" is NOT a gate — this must refuse
  // server-side until the privacy/consent/content-safety review lands.
  it('BLOCKED by default: refuses without touching Storage (no env flag set)', async () => {
    delete process.env.CHILD_PHOTO_UPLOAD;
    const upload = vi.fn().mockResolvedValue({ error: null });
    (createServerClient as ReturnType<typeof vi.fn>).mockReturnValue({ storage: { from: () => ({ upload }) } });
    const fd = new FormData();
    fd.append('photo', new File([Uint8Array.from([1, 2, 3])], 'me.png', { type: 'image/png' }));

    await expect(uploadPhoto(fd)).rejects.toThrow(/not available|disabled/i);
    expect(upload).not.toHaveBeenCalled(); // refused BEFORE any Storage write
  });

  it('BLOCKED for any value other than the explicit opt-in', async () => {
    process.env.CHILD_PHOTO_UPLOAD = 'true'; // not the magic 'on'
    const upload = vi.fn().mockResolvedValue({ error: null });
    (createServerClient as ReturnType<typeof vi.fn>).mockReturnValue({ storage: { from: () => ({ upload }) } });
    const fd = new FormData();
    fd.append('photo', new File([Uint8Array.from([1, 2, 3])], 'me.png', { type: 'image/png' }));

    await expect(uploadPhoto(fd)).rejects.toThrow(/not available|disabled/i);
    expect(upload).not.toHaveBeenCalled();
  });

  it('when explicitly enabled (local testing): uploads under the OWNING draft prefix', async () => {
    process.env.CHILD_PHOTO_UPLOAD = 'on';
    const { upload } = mockStorage();
    mockOwnDraft('draft-1');
    const r = await uploadPhoto(pngForm());
    expect(r.photoPath).toMatch(/^uploads\/draft-1\/[a-f0-9]{64}\.png$/);
    expect(r.photoHash).toHaveLength(64);
    expect(upload).toHaveBeenCalledOnce();
  });
});

// ---- C: upload hardening -------------------------------------------------
// These endpoints had NO auth, NO ownership, NO content check, NO size cap and NO
// rate limit — a Server Action id ships in the client bundle, so anyone could POST
// arbitrary bytes into Storage in a loop.
const PNG_HEADER = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function pngForm(extra: number[] = [1, 2, 3], name = 'pet.png'): FormData {
  const fd = new FormData();
  fd.append('photo', new File([Uint8Array.from([...PNG_HEADER, ...extra])], name, { type: 'image/png' }));
  return fd;
}
function mockStorage(existing: unknown[] = []) {
  const upload = vi.fn().mockResolvedValue({ error: null });
  const list = vi.fn().mockResolvedValue({ data: existing, error: null });
  (createServerClient as ReturnType<typeof vi.fn>).mockReturnValue({ storage: { from: () => ({ upload, list }) } });
  return { upload, list };
}
function mockOwnDraft(id: string | null) {
  (getDraftCookieFromRequest as ReturnType<typeof vi.fn>).mockResolvedValue(id ? `cookie-${id}` : null);
  (getDraftByCookieId as ReturnType<typeof vi.fn>).mockResolvedValue(id ? { id } : null);
}

describe('uploadPetPhoto — hardening (C)', () => {
  it('OWNERSHIP: no draft cookie → refuses before touching Storage', async () => {
    const { upload } = mockStorage();
    mockOwnDraft(null);
    await expect(uploadPetPhoto(pngForm())).rejects.toThrow(/no active session/i);
    expect(upload).not.toHaveBeenCalled();
  });

  it('OWNERSHIP: a cookie with no matching draft → refuses (no forged-id path)', async () => {
    const { upload } = mockStorage();
    (getDraftCookieFromRequest as ReturnType<typeof vi.fn>).mockResolvedValue('cookie-bogus');
    (getDraftByCookieId as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    await expect(uploadPetPhoto(pngForm())).rejects.toThrow(/no active session/i);
    expect(upload).not.toHaveBeenCalled();
  });

  // contentType was a LABEL written into Storage metadata, never a check: a ZIP/EXE
  // would have been stored and later served as image/png.
  it('CONTENT: non-PNG bytes are rejected even when labelled image/png', async () => {
    const { upload } = mockStorage();
    mockOwnDraft('draft-1');
    const fd = new FormData();
    fd.append('photo', new File([Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 9, 9, 9, 9])], 'evil.png', { type: 'image/png' }));
    await expect(uploadPetPhoto(fd)).rejects.toThrow(/unsupported image format/i);
    expect(upload).not.toHaveBeenCalled();
  });

  it('SIZE: an oversized file is rejected before any Storage write', async () => {
    const { upload } = mockStorage();
    mockOwnDraft('draft-1');
    const fd = new FormData();
    fd.append('photo', new File([new Uint8Array(5 * 1024 * 1024)], 'huge.png', { type: 'image/png' }));
    await expect(uploadPetPhoto(fd)).rejects.toThrow(/too large/i);
    expect(upload).not.toHaveBeenCalled();
  });

  it('RATE: at the per-draft upload ceiling → refuses (bounds bucket abuse)', async () => {
    const { upload } = mockStorage(new Array(20).fill({ name: 'x.png' }));
    mockOwnDraft('draft-1');
    await expect(uploadPetPhoto(pngForm())).rejects.toThrow(/too many photos/i);
    expect(upload).not.toHaveBeenCalled();
  });

  // D: per-draft namespacing. Content-hash-only paths let two customers with the
  // same bytes collide (upsert:true → silent overwrite) and left orphans untraceable.
  it('NAMESPACE (D): writes under uploads/<draftId>/, not a bare content hash', async () => {
    const { upload } = mockStorage();
    mockOwnDraft('draft-7');
    const r = await uploadPetPhoto(pngForm());
    expect(r.photoPath).toMatch(/^uploads\/draft-7\/[a-f0-9]{64}\.png$/);
    expect(upload).toHaveBeenCalledOnce();
  });
});
