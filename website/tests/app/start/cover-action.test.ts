/**
 * getCoverPreview server action (Batch 4a). Data layer + preview actions mocked — no
 * network, no Gemini. Verifies: flag-off pass-through (no calls), reuse-chosen-image
 * ($0, no requestPreview), child fresh-render (calls requestPreview), and pet-without-pick
 * (no cover, no requestPreview → no misrender).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/draft-cookie', () => ({ getDraftCookieFromRequest: vi.fn() }));
vi.mock('@/db/drafts', () => ({ getDraftByCookieId: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ createServerClient: vi.fn() }));
vi.mock('@/app/start/_actions/preview', () => ({ getChosenSheet: vi.fn(), requestPreview: vi.fn() }));

import { getCoverPreview } from '@/app/start/_actions/cover';
import { getDraftCookieFromRequest } from '@/lib/draft-cookie';
import { getDraftByCookieId } from '@/db/drafts';
import { createServerClient } from '@/lib/supabase';
import { getChosenSheet, requestPreview } from '@/app/start/_actions/preview';

const cookie = getDraftCookieFromRequest as ReturnType<typeof vi.fn>;
const getDraft = getDraftByCookieId as ReturnType<typeof vi.fn>;
const serverClient = createServerClient as ReturnType<typeof vi.fn>;
const chosen = getChosenSheet as ReturnType<typeof vi.fn>;
const reqPreview = requestPreview as ReturnType<typeof vi.fn>;

const childDraft = {
  id: 'draft-1',
  child_name: 'Mia',
  book_type: 'child',
  theme_template_id: 'milestone_first_school',
  child_age: 6,
  child_gender: 'girl',
  child_features: { hair_colour: 'brown' },
  child_appearance: 'freckles',
  background: null,
  art_style: 'watercolour',
};

/** Mock createServerClient().storage.from().createSignedUrl() → a fresh URL. */
function stubSignedUrl(url: string) {
  serverClient.mockReturnValue({
    storage: { from: () => ({ createSignedUrl: async () => ({ data: { signedUrl: url }, error: null }) }) },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.COVER_PREVIEW_ENABLED = 'on';
  cookie.mockResolvedValue('cookie-1');
  getDraft.mockResolvedValue(childDraft);
  chosen.mockResolvedValue(null);
});

describe('getCoverPreview — gate', () => {
  it('flag off → disabled pass-through, no draft/preview calls', async () => {
    delete process.env.COVER_PREVIEW_ENABLED;
    const r = await getCoverPreview();
    expect(r).toEqual({ enabled: false, status: 'none', title: '', subtitle: null });
    expect(getChosenSheet).not.toHaveBeenCalled();
    expect(requestPreview).not.toHaveBeenCalled();
  });
});

describe('getCoverPreview — reuse chosen image ($0)', () => {
  it('re-signs the chosen image path and returns done without calling requestPreview', async () => {
    chosen.mockResolvedValue({ subjectId: 'protagonist', imagePath: 'previews/abc.png', imageUrl: 'stale' });
    stubSignedUrl('https://signed/fresh.png');

    const r = await getCoverPreview();

    expect(r.status).toBe('done');
    expect(r.imageUrl).toBe('https://signed/fresh.png');
    expect(r.title).toBe('Your first day of school'); // preset
    expect(r.subtitle).toBe('for Mia');
    expect(requestPreview).not.toHaveBeenCalled(); // no spend
  });

  it('skips a degraded pick and does not reuse it', async () => {
    chosen.mockResolvedValue({ subjectId: 'protagonist', imagePath: '', imageUrl: null, degraded: true });
    reqPreview.mockResolvedValue({ status: 'done', imageUrl: 'https://gen.png', bgColor: null, cached: false, previewId: 'p' });

    const r = await getCoverPreview(); // child draft → falls through to fresh render

    expect(r.status).toBe('done');
    expect(r.imageUrl).toBe('https://gen.png');
    expect(requestPreview).toHaveBeenCalledOnce();
  });
});

describe('getCoverPreview — child fresh render via the existing rails', () => {
  it('calls requestPreview with the draft build and returns a done image', async () => {
    reqPreview.mockResolvedValue({ status: 'done', imageUrl: 'https://gen.png', bgColor: '#fffdf8', cached: false, previewId: 'p1' });

    const r = await getCoverPreview();

    expect(r.status).toBe('done');
    expect(r.imageUrl).toBe('https://gen.png');
    expect(reqPreview.mock.calls[0]![0]).toMatchObject({
      draftId: 'draft-1',
      name: 'Mia',
      age: 6,
      style: 'watercolour',
      features: { hair_colour: 'brown' },
      isAdult: false,
    });
  });

  it('returns queued+previewId to poll when the render is not yet done', async () => {
    reqPreview.mockResolvedValue({ status: 'queued', imageUrl: null, cached: false, previewId: 'p2' });
    const r = await getCoverPreview();
    expect(r.status).toBe('queued');
    expect(r.previewId).toBe('p2');
  });

  it('blocked (capped/rate-limited) → pass-through, never blocks Continue', async () => {
    reqPreview.mockResolvedValue({ previewId: '', status: 'failed', cached: false, blocked: 'capped' });
    const r = await getCoverPreview();
    expect(r.status).toBe('none');
    expect(r.enabled).toBe(true);
  });
});

describe('getCoverPreview — pet/adult without a pick → no misrender', () => {
  it('pet with no chosen_sheet returns none and does NOT fresh-render (human path would misrender a pet)', async () => {
    getDraft.mockResolvedValue({ ...childDraft, book_type: 'pet', child_name: 'Benji', theme_template_id: null });
    const r = await getCoverPreview();
    expect(r.status).toBe('none');
    expect(r.title).toBe("Benji's Tale");
    expect(requestPreview).not.toHaveBeenCalled();
  });
});
