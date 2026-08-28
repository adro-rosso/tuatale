/**
 * Child-photo moderation — FAIL-CLOSED. Only an explicit, parseable suitable:true accepts;
 * every other outcome (no key, HTTP error, unparseable, timeout/throw, suitable:false)
 * rejects. Anthropic is mocked (stubbed fetch) — no network, no spend.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { moderateChildPhoto } from '@/lib/moderation/child-photo';

function mockAnthropic(text: string, ok = true, status = 200) {
  return vi.fn().mockResolvedValue({ ok, status, json: async () => ({ content: [{ type: 'text', text }] }) });
}
const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

beforeEach(() => {
  vi.clearAllMocks();
  process.env.ANTHROPIC_API_KEY = 'test-key';
});
afterEach(() => vi.unstubAllGlobals());

describe('moderateChildPhoto — fail-closed', () => {
  it('no ANTHROPIC_API_KEY → reject (never calls the API)', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const fetchMock = mockAnthropic('{}');
    vi.stubGlobal('fetch', fetchMock);
    expect(await moderateChildPhoto(bytes)).toEqual({ ok: false, category: 'unavailable', reason: 'unavailable' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('suitable:true → accept (and sends Haiku 4.5 + an image block)', async () => {
    const fetchMock = mockAnthropic(JSON.stringify({ suitable: true, reason: 'ordinary child portrait' }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await moderateChildPhoto(bytes)).toEqual({ ok: true });
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as { body: string }).body);
    expect(body.model).toBe('claude-haiku-4-5-20251001');
    expect(body.messages[0].content[0].type).toBe('image');
  });

  it('suitable:false → reject as unsafe with the reason', async () => {
    vi.stubGlobal('fetch', mockAnthropic(JSON.stringify({ suitable: false, reason: 'not a person' })));
    expect(await moderateChildPhoto(bytes)).toEqual({ ok: false, category: 'unsafe', reason: 'not a person' });
  });

  it('an ADULT photo is NOT rejected for age (safety-only gate)', async () => {
    // The gate must accept adults (child-book companions are often parents/grandparents).
    vi.stubGlobal('fetch', mockAnthropic(JSON.stringify({ suitable: true, reason: 'ordinary adult portrait' })));
    expect(await moderateChildPhoto(bytes)).toEqual({ ok: true });
  });

  it('HTTP error → reject', async () => {
    vi.stubGlobal('fetch', mockAnthropic('boom', false, 500));
    expect(await moderateChildPhoto(bytes)).toMatchObject({ ok: false });
  });

  it('unparseable / no boolean → reject', async () => {
    vi.stubGlobal('fetch', mockAnthropic('the photo looks fine to me'));
    expect(await moderateChildPhoto(bytes)).toMatchObject({ ok: false });
    vi.stubGlobal('fetch', mockAnthropic(JSON.stringify({ suitable: 'yes' }))); // not a boolean
    expect(await moderateChildPhoto(bytes)).toMatchObject({ ok: false });
  });

  it('thrown fetch (network/timeout) → reject as unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('aborted')));
    expect(await moderateChildPhoto(bytes)).toEqual({ ok: false, category: 'unavailable', reason: 'unavailable' });
  });
});
