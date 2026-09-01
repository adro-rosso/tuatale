/**
 * probeStory server action ("go deeper" enrichment questions).
 *
 * LLM fully mocked (global fetch stubbed) — no network, no spend. Verifies:
 *   - FLAG-GATED: inert (reason:'disabled') when STORY_PROBE_ENABLED !== 'on', fetch never called
 *   - inert without ANTHROPIC_API_KEY (soft-fail)
 *   - happy path returns 3-5 questions; Haiku 4.5 + right headers; request carries the story text
 *   - questions capped at 5 + per-question char cap
 *   - fewer than 3 questions → reason:'empty'
 *   - soft-fail on HTTP error and unparseable JSON
 *   - the light per-draft burst rate-limit
 *
 * Distinct draft-cookie id per test so the in-memory abuse cap can't leak between tests.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/draft-cookie', () => ({ getDraftCookieFromRequest: vi.fn() }));

import { probeStory } from '@/app/start/_actions/probe-story';
import { getDraftCookieFromRequest } from '@/lib/draft-cookie';

const cookieMock = getDraftCookieFromRequest as ReturnType<typeof vi.fn>;
let cookieSeq = 0;

function mockAnthropic(text: string, ok = true, status = 200) {
  return vi.fn().mockResolvedValue({ ok, status, json: async () => ({ content: [{ type: 'text', text }] }) });
}
const qs = (arr: string[]) => JSON.stringify({ questions: arr });
const threeQ = ['What colour is the backpack?', 'Who else is there?', 'What time of day is it?'];
const baseInput = { text: 'Mia starts school with her red backpack', bookType: 'child', heroName: 'Mia', age: 6, gender: 'girl' };

beforeEach(() => {
  vi.clearAllMocks();
  process.env.STORY_PROBE_ENABLED = 'on';
  process.env.ANTHROPIC_API_KEY = 'test-key';
  cookieSeq += 1;
  cookieMock.mockResolvedValue(`cookie-${cookieSeq}`);
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.STORY_PROBE_ENABLED;
});

describe('probeStory — flag gate', () => {
  it('flag off → { ok:false, reason:disabled }, never calls the LLM', async () => {
    delete process.env.STORY_PROBE_ENABLED;
    const fetchMock = mockAnthropic(qs(threeQ));
    vi.stubGlobal('fetch', fetchMock);
    expect(await probeStory(baseInput)).toEqual({ ok: false, reason: 'disabled' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('probeStory — inert without the key', () => {
  it('flag on but no key → { ok:false, reason:no_key }, no LLM call', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const fetchMock = mockAnthropic(qs(threeQ));
    vi.stubGlobal('fetch', fetchMock);
    expect(await probeStory(baseInput)).toEqual({ ok: false, reason: 'no_key' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('probeStory — happy path', () => {
  it('returns 3-5 questions; Haiku 4.5 + headers; request carries the story text', async () => {
    const fetchMock = mockAnthropic(qs(threeQ));
    vi.stubGlobal('fetch', fetchMock);
    const r = await probeStory(baseInput);
    expect(r.ok).toBe(true);
    expect(r.questions).toEqual(threeQ);
    const [url, opts] = fetchMock.mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect(opts.headers['x-api-key']).toBe('test-key');
    const body = JSON.parse(opts.body as string);
    expect(body.model).toBe('claude-haiku-4-5-20251001');
    expect(body.messages[0].content).toContain('Mia starts school with her red backpack');
  });

  it('caps at 5 questions and trims an over-long question', async () => {
    const long = 'a '.repeat(200) + 'end?';
    vi.stubGlobal('fetch', mockAnthropic(qs(['q1?', 'q2?', 'q3?', 'q4?', 'q5?', 'q6?', long])));
    const r = await probeStory(baseInput);
    expect(r.ok).toBe(true);
    expect(r.questions!.length).toBe(5);
    expect(r.questions!.every((q) => q.length <= 140)).toBe(true);
  });
});

describe('probeStory — soft-fail paths', () => {
  it('fewer than 3 questions → reason:empty', async () => {
    vi.stubGlobal('fetch', mockAnthropic(qs(['only one?'])));
    expect(await probeStory(baseInput)).toEqual({ ok: false, reason: 'empty' });
  });
  it('HTTP error → llm_error', async () => {
    vi.stubGlobal('fetch', mockAnthropic('boom', false, 500));
    expect(await probeStory(baseInput)).toMatchObject({ ok: false, reason: 'llm_error' });
  });
  it('unparseable JSON → bad_response', async () => {
    vi.stubGlobal('fetch', mockAnthropic('no json here'));
    expect(await probeStory(baseInput)).toMatchObject({ ok: false, reason: 'bad_response' });
  });
});

describe('probeStory — abuse cap', () => {
  it('a second call within the burst window is rate-limited', async () => {
    vi.stubGlobal('fetch', mockAnthropic(qs(threeQ)));
    cookieMock.mockResolvedValue('same-cookie'); // same bucket for both calls
    expect((await probeStory(baseInput)).ok).toBe(true);
    expect(await probeStory(baseInput)).toEqual({ ok: false, reason: 'rate_limited' });
  });
});
