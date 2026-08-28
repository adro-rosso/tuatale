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
  getBatchRows: vi.fn(),
  countBatchesForDraft: vi.fn(),
}));
vi.mock('@/lib/inngest/client', () => ({ inngest: { send: vi.fn() } }));
vi.mock('@/lib/supabase', () => ({ createServerClient: vi.fn() }));
vi.mock('@/lib/draft-cookie', () => ({ getDraftCookieFromRequest: vi.fn() }));
vi.mock('@/db/drafts', () => ({ getDraftByCookieId: vi.fn(), updateDraftByCookieId: vi.fn() }));
vi.mock('@/lib/moderation/child-photo', () => ({ moderateChildPhoto: vi.fn() }));

import { requestPreview, getPreviewStatus, requestPreviewBatch, getPreviewBatchStatus, uploadPhoto, uploadPetPhoto, uploadAdultPhoto, removeAdultPhoto, removeChildPhoto, removePetPhoto, uploadCompanionPhoto, removeCompanionPhoto } from '@/app/start/_actions/preview';
import { getDraftCookieFromRequest } from '@/lib/draft-cookie';
import { getDraftByCookieId, updateDraftByCookieId } from '@/db/drafts';
import { moderateChildPhoto } from '@/lib/moderation/child-photo';
import { createServerClient } from '@/lib/supabase';
import {
  findCachedPreview,
  createPreviewJob,
  getPreviewJob,
  countPreviewsForDraft,
  countPreviewsForDraftSince,
  getBatchRows,
  countBatchesForDraft,
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
  const ORIGINAL = process.env.CHILD_PHOTO_ENABLED;
  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.CHILD_PHOTO_ENABLED;
    else process.env.CHILD_PHOTO_ENABLED = ORIGINAL;
  });

  // The load-bearing test. A Server Action is a POST endpoint whose id ships in the
  // client bundle, so "the UI doesn't render it" is NOT a gate — this must refuse
  // server-side until the privacy/consent/content-safety review lands.
  it('BLOCKED by default: refuses without touching Storage (no env flag set)', async () => {
    delete process.env.CHILD_PHOTO_ENABLED;
    const upload = vi.fn().mockResolvedValue({ error: null });
    (createServerClient as ReturnType<typeof vi.fn>).mockReturnValue({ storage: { from: () => ({ upload }) } });
    const fd = new FormData();
    fd.append('photo', new File([Uint8Array.from([1, 2, 3])], 'me.png', { type: 'image/png' }));

    await expect(uploadPhoto(fd)).rejects.toThrow(/not available|disabled/i);
    expect(upload).not.toHaveBeenCalled(); // refused BEFORE any Storage write
  });

  it('BLOCKED for any value other than the explicit opt-in', async () => {
    process.env.CHILD_PHOTO_ENABLED = 'true'; // not the magic 'on'
    const upload = vi.fn().mockResolvedValue({ error: null });
    (createServerClient as ReturnType<typeof vi.fn>).mockReturnValue({ storage: { from: () => ({ upload }) } });
    const fd = new FormData();
    fd.append('photo', new File([Uint8Array.from([1, 2, 3])], 'me.png', { type: 'image/png' }));

    await expect(uploadPhoto(fd)).rejects.toThrow(/not available|disabled/i);
    expect(upload).not.toHaveBeenCalled();
  });

  // CONSENT is a hard precondition (fail-closed): the parent/guardian attestation must be
  // present, and the SERVER stores the canonical text for the given version.
  function childForm(consentVersion?: string): FormData {
    const fd = pngForm([1, 2, 3], 'kid.png');
    if (consentVersion) fd.append('consent_version', consentVersion);
    return fd;
  }

  it('BLOCKED without consent even when the flag is on (no photo stored)', async () => {
    process.env.CHILD_PHOTO_ENABLED = 'on';
    const { upload } = mockStorage();
    mockOwnDraft('draft-1');
    await expect(uploadPhoto(childForm(/* no consent */))).rejects.toThrow(/consent/i);
    expect(upload).not.toHaveBeenCalled();
  });

  it('BLOCKED with an unknown consent version', async () => {
    process.env.CHILD_PHOTO_ENABLED = 'on';
    const { upload } = mockStorage();
    mockOwnDraft('draft-1');
    await expect(uploadPhoto(childForm('child-v999'))).rejects.toThrow(/consent/i);
    expect(upload).not.toHaveBeenCalled();
  });

  it('REJECTED by moderation (fail-closed): not stored, kind error', async () => {
    process.env.CHILD_PHOTO_ENABLED = 'on';
    const { upload } = mockStorage();
    mockOwnDraft('draft-1');
    (moderateChildPhoto as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false, reason: 'not a person' });
    await expect(uploadPhoto(childForm('child-v1'))).rejects.toThrow(/can't use that photo/i);
    expect(upload).not.toHaveBeenCalled(); // never stored
  });

  it('with consent + moderation pass: stores, tracks photo_urls.child, records versioned consent', async () => {
    process.env.CHILD_PHOTO_ENABLED = 'on';
    const { upload } = mockStorage();
    mockOwnDraft('draft-1');
    (moderateChildPhoto as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true });
    const r = await uploadPhoto(childForm('child-v1'));

    expect(r.photoPath).toMatch(/^uploads\/draft-1\/[a-f0-9]{64}\.png$/);
    expect(upload).toHaveBeenCalledOnce();
    // persisted: photo tracked + versioned consent record (canonical text) + photo_assisted mode
    const patch = (updateDraftByCookieId as ReturnType<typeof vi.fn>).mock.calls[0]![1] as Record<string, unknown>;
    expect((patch.photo_urls as { child: string[] }).child).toEqual([r.photoPath]);
    expect(patch.character_generation_mode).toBe('photo_assisted');
    const consent = patch.photo_consent as { version: string; text: string; at: string };
    expect(consent.version).toBe('child-v1');
    expect(consent.text).toMatch(/parent or legal guardian/i);
    expect(consent.at).toBeTruthy();
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


// ---- uploadAdultPhoto — gating (Slice 2) -----------------------------------
// Distinct from the child gate: adult photos carry no child-photo legal gate, so this
// can be enabled while uploadPhoto (child) stays hard-denied. Fail-closed: default OFF.
describe('uploadAdultPhoto — gate', () => {
  const ORIGINAL = process.env.ADULT_PHOTO_UPLOAD;
  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.ADULT_PHOTO_UPLOAD;
    else process.env.ADULT_PHOTO_UPLOAD = ORIGINAL;
  });

  it('BLOCKED by default (fail-closed): refuses without touching Storage', async () => {
    delete process.env.ADULT_PHOTO_UPLOAD;
    const { upload } = mockStorage();
    mockOwnDraft('draft-1');
    await expect(uploadAdultPhoto(pngForm())).rejects.toThrow(/not available/i);
    expect(upload).not.toHaveBeenCalled();
  });

  it('BLOCKED for any value other than the explicit opt-in', async () => {
    process.env.ADULT_PHOTO_UPLOAD = 'true';
    const { upload } = mockStorage();
    mockOwnDraft('draft-1');
    await expect(uploadAdultPhoto(pngForm())).rejects.toThrow(/not available/i);
    expect(upload).not.toHaveBeenCalled();
  });

  it("when enabled ('on'): uploads under the owning draft prefix (hardened path)", async () => {
    process.env.ADULT_PHOTO_UPLOAD = 'on';
    const { upload } = mockStorage();
    mockOwnDraft('draft-7');
    const r = await uploadAdultPhoto(pngForm());
    expect(r.photoPath).toMatch(/^uploads\/draft-7\/[a-f0-9]{64}\.png$/);
    expect(upload).toHaveBeenCalledOnce();
  });

  it('child uploadPhoto STAYS hard-denied regardless of the adult flag', async () => {
    process.env.ADULT_PHOTO_UPLOAD = 'on'; // adult on
    delete process.env.CHILD_PHOTO_ENABLED; // child still off
    const { upload } = mockStorage();
    mockOwnDraft('draft-1');
    await expect(uploadPhoto(pngForm())).rejects.toThrow(/not available|disabled/i);
    expect(upload).not.toHaveBeenCalled();
  });
});

// ---- requestPreview threads isAdult into the worker event ------------------
describe('requestPreview — isAdult flows to the worker', () => {
  it('passes isAdult through to preview/requested', async () => {
    (findCachedPreview as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (createPreviewJob as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'p', status: 'queued', input_hash: 'h' });
    await requestPreview({ age: 40, style: 'watercolour', draftId: 'draft-1', isAdult: true });
    const sent = (inngest.send as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(sent.data.isAdult).toBe(true);
  });
});


// ---- requestPreviewBatch — N book-faithful options (character-picker Slice 2) ----
describe('soft-fail: generation dispatch/poll NEVER throws an unhandled error', () => {
  // Regression: a missing INNGEST_EVENT_KEY in an env scope made inngest.send throw,
  // surfacing as an unhandled server error (Sentry) on POST /start/child. The generation
  // path must degrade to a graceful "unavailable" instead — matters in Production too.
  //
  // NOTE: the top-level beforeEach uses vi.clearAllMocks() which resets call history but
  // NOT implementations, so a mockRejectedValue set here would leak into later tests.
  // Reset the rejected mocks explicitly.
  afterEach(() => {
    delete process.env.CHARACTER_PICKER_ENABLED;
    (inngest.send as ReturnType<typeof vi.fn>).mockReset();
    (getPreviewJob as ReturnType<typeof vi.fn>).mockReset();
    (getBatchRows as ReturnType<typeof vi.fn>).mockReset();
  });

  it('requestPreview: inngest.send rejects → { previewId:"", status:"failed", blocked:"unavailable" }, no throw', async () => {
    (findCachedPreview as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (createPreviewJob as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'p-new', status: 'queued' });
    (inngest.send as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('Failed to send event ... could not find an event key. Set INNGEST_EVENT_KEY'),
    );
    const r = await requestPreview({ age: 7, gender: 'girl', features: { hair_colour: 'brown' }, style: 'watercolour', draftId: 'draft-1' });
    expect(r).toEqual({ previewId: '', status: 'failed', cached: false, blocked: 'unavailable' });
  });

  it('getPreviewStatus: a poll DB error → failed, no throw', async () => {
    (getPreviewJob as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('db down'));
    const r = await getPreviewStatus('p-1');
    expect(r).toMatchObject({ previewId: 'p-1', status: 'failed' });
  });

  it('requestPreviewBatch: every option fails to dispatch → all failed + blocked:"unavailable", no throw', async () => {
    process.env.CHARACTER_PICKER_ENABLED = 'on';
    mockOwnDraft('draft-1');
    (countBatchesForDraft as ReturnType<typeof vi.fn>).mockResolvedValue(0);
    (createPreviewJob as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'p', status: 'queued' });
    (inngest.send as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('no event key'));
    const r = await requestPreviewBatch({
      role: 'protagonist',
      inputs: { name: 'Benji', subject_type: 'non_human' },
      artStyle: 'watercolour',
      photoPaths: ['uploads/draft-1/a.png'],
    });
    expect(r.blocked).toBe('unavailable');
    expect(r.options.length).toBeGreaterThan(0);
    expect(r.options.every((o) => o.status === 'failed')).toBe(true);
  });

  it('getPreviewBatchStatus: a poll DB error → empty options, no throw', async () => {
    (getBatchRows as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('db down'));
    const r = await getPreviewBatchStatus('batch-1');
    expect(r).toEqual({ batchId: 'batch-1', options: [] });
  });
});

describe('requestPreviewBatch', () => {
  const cn = () => createPreviewJob as ReturnType<typeof vi.fn>;
  const batchInput = {
    role: 'protagonist' as const,
    inputs: { name: 'Benji', subject_type: 'non_human' as const, animal_kind: 'dog', appearance: 'a labradoodle' },
    artStyle: 'watercolour',
    photoPaths: ['uploads/draft-1/a.png', 'uploads/draft-1/b.png'],
  };
  const ORIGINAL_FLAG = process.env.CHARACTER_PICKER_ENABLED;
  beforeEach(() => {
    process.env.CHARACTER_PICKER_ENABLED = 'on'; // the batch action is flag-gated (Gate 2)
    mockOwnDraft('draft-1');
    (countBatchesForDraft as ReturnType<typeof vi.fn>).mockResolvedValue(0); // under cap, no recent batch
    let n = 0;
    cn().mockImplementation(async () => ({ id: `p-${n++}`, status: 'queued', input_hash: 'h' }));
  });
  afterEach(() => {
    if (ORIGINAL_FLAG === undefined) delete process.env.CHARACTER_PICKER_ENABLED;
    else process.env.CHARACTER_PICKER_ENABLED = ORIGINAL_FLAG;
  });

  it('FLAG OFF (byte-identical): CHARACTER_PICKER_ENABLED unset → blocked:disabled, NO spend', async () => {
    delete process.env.CHARACTER_PICKER_ENABLED;
    const r = await requestPreviewBatch(batchInput);
    expect(r.blocked).toBe('disabled');
    expect(r.options).toEqual([]);
    expect(cn()).not.toHaveBeenCalled();
    expect(inngest.send).not.toHaveBeenCalled();
  });

  it('FLAG must be exactly "on" (fail-closed): "true" → disabled', async () => {
    process.env.CHARACTER_PICKER_ENABLED = 'true';
    const r = await requestPreviewBatch(batchInput);
    expect(r.blocked).toBe('disabled');
    expect(cn()).not.toHaveBeenCalled();
  });

  it('mints MAX_BATCH_OPTIONS (3) rows + 3 picker events; batch_id + variant_index set', async () => {
    const r = await requestPreviewBatch(batchInput);
    expect(r.blocked).toBeUndefined();
    expect(r.options).toHaveLength(3);
    expect(r.options.map((o) => o.variant)).toEqual([0, 1, 2]);
    expect(cn()).toHaveBeenCalledTimes(3);
    // every row carries the SAME batch_id and its own variant_index
    const batchIds = cn().mock.calls.map((c) => c[0].batchId);
    expect(new Set(batchIds).size).toBe(1);
    expect(cn().mock.calls.map((c) => c[0].variantIndex)).toEqual([0, 1, 2]);
    // 3 picker events, book-faithful mode + subject inputs + photos
    expect((inngest.send as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(3);
    const sent = (inngest.send as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(sent.name).toBe('preview/requested');
    expect(sent.data).toMatchObject({ mode: 'picker', role: 'protagonist', artStyle: 'watercolour', photo_paths: batchInput.photoPaths });
  });

  it('the 3 variants get 3 DISTINCT input hashes (no cache-collapse to one image)', async () => {
    await requestPreviewBatch(batchInput);
    const hashes = cn().mock.calls.map((c) => c[0].inputHash);
    expect(new Set(hashes).size).toBe(3);
  });

  it('SERVER-CAPS the count: a client asking for 99 still gets only 3', async () => {
    const r = await requestPreviewBatch({ ...batchInput, count: 99 });
    expect(r.options).toHaveLength(3);
    expect(cn()).toHaveBeenCalledTimes(3);
  });

  it('NO PHOTOS (all foreign/absent) → blocked no_photos, no spend', async () => {
    const r = await requestPreviewBatch({ ...batchInput, photoPaths: ['uploads/draft-2/x.png'] });
    expect(r.blocked).toBe('no_photos');
    expect(cn()).not.toHaveBeenCalled();
    expect(inngest.send).not.toHaveBeenCalled();
  });

  it('BATCH-AWARE CAP: at the free cap (counting BATCHES) → capped, no spend', async () => {
    (countBatchesForDraft as ReturnType<typeof vi.fn>).mockResolvedValue(10); // == FREE_PREVIEW_CAP
    const r = await requestPreviewBatch(batchInput);
    expect(r.blocked).toBe('capped');
    expect(cn()).not.toHaveBeenCalled();
  });

  it('BATCH-AWARE RATE: a recent BATCH in the burst window → rate_limited (N options are ONE request)', async () => {
    // cap call (no since) = 0; burst call (with since) = 1.
    (countBatchesForDraft as ReturnType<typeof vi.fn>).mockImplementation(async (_id: string, since?: string) => (since ? 1 : 0));
    const r = await requestPreviewBatch(batchInput);
    expect(r.blocked).toBe('rate_limited');
    expect(cn()).not.toHaveBeenCalled();
  });

  it('OWNERSHIP: no draft cookie → refuses before any spend', async () => {
    mockOwnDraft(null);
    await expect(requestPreviewBatch(batchInput)).rejects.toThrow(/no active session/i);
    expect(cn()).not.toHaveBeenCalled();
  });
});

describe('getPreviewBatchStatus — graceful (returns what landed)', () => {
  it('maps rows to options; done carry url, failed/running reported as-is', async () => {
    (getBatchRows as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 'p0', status: 'done', image_url: 'u0', bg_color: '#eee', variant_index: 0 },
      { id: 'p1', status: 'failed', image_url: null, variant_index: 1 },
      { id: 'p2', status: 'running', image_url: null, variant_index: 2 },
    ]);
    const r = await getPreviewBatchStatus('batch-1');
    expect(r.options).toEqual([
      { variant: 0, previewId: 'p0', status: 'done', imageUrl: 'u0', bgColor: '#eee' },
      { variant: 1, previewId: 'p1', status: 'failed', imageUrl: null, bgColor: null },
      { variant: 2, previewId: 'p2', status: 'running', imageUrl: null, bgColor: null },
    ]);
  });
});

// ---- removeAdultPhoto — the "you can remove it any time" promise (Slice 2) ---
// Must be true at full scope: unlink from the draft AND delete the object.
describe('removeAdultPhoto', () => {
  function mockRemoveEnv({ objectStillListed = false } = {}) {
    (getDraftCookieFromRequest as ReturnType<typeof vi.fn>).mockResolvedValue('cookie-1');
    (getDraftByCookieId as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'draft-1', photo_urls: { adult: ['uploads/draft-1/keep.png', 'uploads/draft-1/gone.png'] },
    });
    const remove = vi.fn().mockResolvedValue({ error: null });
    const list = vi.fn().mockResolvedValue({ data: objectStillListed ? [{ name: 'gone.png' }] : [], error: null });
    (createServerClient as ReturnType<typeof vi.fn>).mockReturnValue({ storage: { from: () => ({ remove, list }) } });
    (updateDraftByCookieId as ReturnType<typeof vi.fn>).mockResolvedValue({});
    return { remove, list };
  }

  it('UNLINKS the path from the draft and DELETES the object', async () => {
    const { remove } = mockRemoveEnv();
    const r = await removeAdultPhoto('uploads/draft-1/gone.png');
    expect(r).toEqual({ ok: true });
    // unlink: the OTHER photo remains, the removed one is dropped
    expect((updateDraftByCookieId as ReturnType<typeof vi.fn>).mock.calls[0]![1]).toMatchObject({
      photo_urls: { adult: ['uploads/draft-1/keep.png'] },
    });
    // delete: the object is removed from storage
    expect(remove).toHaveBeenCalledWith(['uploads/draft-1/gone.png']);
  });

  it('removing the LAST photo clears photo_urls + consent (back to text-only)', async () => {
    (getDraftCookieFromRequest as ReturnType<typeof vi.fn>).mockResolvedValue('cookie-1');
    (getDraftByCookieId as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'draft-1', photo_urls: { adult: ['uploads/draft-1/only.png'] } });
    const remove = vi.fn().mockResolvedValue({ error: null });
    const list = vi.fn().mockResolvedValue({ data: [], error: null });
    (createServerClient as ReturnType<typeof vi.fn>).mockReturnValue({ storage: { from: () => ({ remove, list }) } });
    (updateDraftByCookieId as ReturnType<typeof vi.fn>).mockResolvedValue({});
    await removeAdultPhoto('uploads/draft-1/only.png');
    expect((updateDraftByCookieId as ReturnType<typeof vi.fn>).mock.calls[0]![1]).toMatchObject({
      photo_urls: {}, photo_consent_at: null, character_generation_mode: 'text_only',
    });
  });

  it('OWNERSHIP: refuses a path outside the callers own draft prefix', async () => {
    mockRemoveEnv();
    await expect(removeAdultPhoto('uploads/draft-2/x.png')).rejects.toThrow(/not your photo/i);
  });

  it('VERIFY: throws if the object is STILL listed after delete (failed erasure)', async () => {
    mockRemoveEnv({ objectStillListed: true });
    await expect(removeAdultPhoto('uploads/draft-1/gone.png')).rejects.toThrow(/could not remove/i);
  });
});

// ---- removeChildPhoto / removePetPhoto — real erasure (was client-only before) --------
// Child + pet remove now do the SAME unlink + DELETE + verify as adult (shared helper), so
// "remove any time" is honest for every role.
describe('removeChildPhoto / removePetPhoto — real erasure', () => {
  function mockRole(role: 'child' | 'pet') {
    (getDraftCookieFromRequest as ReturnType<typeof vi.fn>).mockResolvedValue('cookie-1');
    (getDraftByCookieId as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'draft-1', photo_urls: { [role]: ['uploads/draft-1/keep.png', 'uploads/draft-1/gone.png'] },
    });
    const remove = vi.fn().mockResolvedValue({ error: null });
    const list = vi.fn().mockResolvedValue({ data: [], error: null });
    (createServerClient as ReturnType<typeof vi.fn>).mockReturnValue({ storage: { from: () => ({ remove, list }) } });
    (updateDraftByCookieId as ReturnType<typeof vi.fn>).mockResolvedValue({});
    return { remove };
  }

  it('child: unlinks from photo_urls.child + deletes the object', async () => {
    const { remove } = mockRole('child');
    expect(await removeChildPhoto('uploads/draft-1/gone.png')).toEqual({ ok: true });
    expect((updateDraftByCookieId as ReturnType<typeof vi.fn>).mock.calls[0]![1]).toMatchObject({
      photo_urls: { child: ['uploads/draft-1/keep.png'] },
    });
    expect(remove).toHaveBeenCalledWith(['uploads/draft-1/gone.png']);
  });

  it('pet: unlinks from photo_urls.pet + deletes the object', async () => {
    const { remove } = mockRole('pet');
    expect(await removePetPhoto('uploads/draft-1/gone.png')).toEqual({ ok: true });
    expect((updateDraftByCookieId as ReturnType<typeof vi.fn>).mock.calls[0]![1]).toMatchObject({
      photo_urls: { pet: ['uploads/draft-1/keep.png'] },
    });
    expect(remove).toHaveBeenCalledWith(['uploads/draft-1/gone.png']);
  });

  it('OWNERSHIP: refuses a foreign draft prefix (child)', async () => {
    mockRole('child');
    await expect(removeChildPhoto('uploads/draft-2/x.png')).rejects.toThrow(/not your photo/i);
  });
});

// ---- ④ companion un-gate: uploadCompanionPhoto / removeCompanionPhoto -------------------
// Child-book companions can be children → SAME consent + moderation as the protagonist.
describe('uploadCompanionPhoto / removeCompanionPhoto (child-book companions)', () => {
  const ORIGINAL = process.env.CHILD_PHOTO_ENABLED;
  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.CHILD_PHOTO_ENABLED;
    else process.env.CHILD_PHOTO_ENABLED = ORIGINAL;
  });
  function companionForm(consentVersion?: string): FormData {
    const fd = pngForm([1, 2, 3], 'gran.png');
    if (consentVersion) fd.append('consent_version', consentVersion);
    return fd;
  }

  it('BLOCKED when CHILD_PHOTO_ENABLED is off', async () => {
    delete process.env.CHILD_PHOTO_ENABLED;
    const { upload } = mockStorage();
    await expect(uploadCompanionPhoto(companionForm('companion-v1'))).rejects.toThrow(/not available|disabled/i);
    expect(upload).not.toHaveBeenCalled();
  });

  it('BLOCKED without consent', async () => {
    process.env.CHILD_PHOTO_ENABLED = 'on';
    const { upload } = mockStorage();
    mockOwnDraft('draft-1');
    await expect(uploadCompanionPhoto(companionForm(/* none */))).rejects.toThrow(/consent/i);
    expect(upload).not.toHaveBeenCalled();
  });

  it('REJECTED by moderation (fail-closed): not stored', async () => {
    process.env.CHILD_PHOTO_ENABLED = 'on';
    const { upload } = mockStorage();
    mockOwnDraft('draft-1');
    (moderateChildPhoto as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false, reason: 'x' });
    await expect(uploadCompanionPhoto(companionForm('companion-v1'))).rejects.toThrow(/can't use that photo/i);
    expect(upload).not.toHaveBeenCalled();
  });

  it('with consent + moderation pass: stores + returns the path (no draft persistence)', async () => {
    process.env.CHILD_PHOTO_ENABLED = 'on';
    const { upload } = mockStorage();
    mockOwnDraft('draft-1');
    (moderateChildPhoto as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true });
    const r = await uploadCompanionPhoto(companionForm('companion-v1'));
    expect(r.photoPath).toMatch(/^uploads\/draft-1\/[a-f0-9]{64}\.png$/);
    expect(upload).toHaveBeenCalledOnce();
  });

  it('removeCompanionPhoto: deletes the object; refuses a foreign prefix', async () => {
    (getDraftCookieFromRequest as ReturnType<typeof vi.fn>).mockResolvedValue('cookie-1');
    (getDraftByCookieId as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'draft-1' });
    const remove = vi.fn().mockResolvedValue({ error: null });
    const list = vi.fn().mockResolvedValue({ data: [], error: null });
    (createServerClient as ReturnType<typeof vi.fn>).mockReturnValue({ storage: { from: () => ({ remove, list }) } });
    expect(await removeCompanionPhoto('uploads/draft-1/gran.png')).toEqual({ ok: true });
    expect(remove).toHaveBeenCalledWith(['uploads/draft-1/gran.png']);
    await expect(removeCompanionPhoto('uploads/draft-2/x.png')).rejects.toThrow(/not your photo/i);
  });
});
