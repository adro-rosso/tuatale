/**
 * improveStory server action (Batch 3 — "Help me write this").
 *
 * The LLM is fully mocked (global fetch stubbed), so no network and no spend. Verifies:
 *   - inert without ANTHROPIC_API_KEY (soft-fail, fetch never called)
 *   - the request shape (URL, x-api-key + anthropic-version headers, Haiku 4.5 model)
 *   - the happy path returns { improvedText, questions }
 *   - the hard 2000-char server cap on improvedText
 *   - empty input still runs (the "no story yet" placeholder reaches the prompt)
 *   - soft-fail on HTTP error, and on a response with no parseable JSON
 *   - the light per-draft burst rate-limit
 *
 * Each test uses a distinct draft-cookie id so the in-memory abuse cap can't leak state
 * between tests.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/draft-cookie', () => ({ getDraftCookieFromRequest: vi.fn() }));

import { improveStory } from '@/app/start/_actions/improve-story';
import { getDraftCookieFromRequest } from '@/lib/draft-cookie';

const cookieMock = getDraftCookieFromRequest as ReturnType<typeof vi.fn>;
let cookieSeq = 0;

/** A fake Anthropic Messages response carrying `text` as the model's output block. */
function mockAnthropic(text: string, ok = true, status = 200) {
  const res = { ok, status, json: async () => ({ content: [{ type: 'text', text }] }) };
  return vi.fn().mockResolvedValue(res);
}

const baseInput = { text: 'a puppy who is scared of the vacuum', bookType: 'child', heroName: 'Mia' };

beforeEach(() => {
  vi.clearAllMocks();
  process.env.ANTHROPIC_API_KEY = 'test-key';
  // Distinct cookie per test → each gets its own abuse-cap bucket.
  cookieSeq += 1;
  cookieMock.mockResolvedValue(`cookie-${cookieSeq}`);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('improveStory — inert without the key', () => {
  it('returns { ok:false, reason:no_key } and never calls the LLM', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const fetchMock = mockAnthropic('{}');
    vi.stubGlobal('fetch', fetchMock);

    const r = await improveStory(baseInput);

    expect(r).toEqual({ ok: false, reason: 'no_key' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('improveStory — happy path', () => {
  it('returns improvedText + questions and calls Haiku 4.5 with the right headers', async () => {
    const fetchMock = mockAnthropic(
      JSON.stringify({ improvedText: 'Mia the puppy learns the vacuum is a friend.', questions: ['Where does it happen?'] }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const r = await improveStory(baseInput);

    expect(r.ok).toBe(true);
    expect(r.improvedText).toBe('Mia the puppy learns the vacuum is a friend.');
    expect(r.questions).toEqual(['Where does it happen?']);

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, opts] = fetchMock.mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect(opts.headers['x-api-key']).toBe('test-key');
    expect(opts.headers['anthropic-version']).toBe('2023-06-01');
    const body = JSON.parse(opts.body as string);
    expect(body.model).toBe('claude-haiku-4-5');
    expect(body.messages[0].content).toContain('a puppy who is scared of the vacuum');
  });

  it('caps improvedText at 2000 chars even when the model returns more', async () => {
    const long = 'x'.repeat(5000);
    const fetchMock = mockAnthropic(JSON.stringify({ improvedText: long, questions: [] }));
    vi.stubGlobal('fetch', fetchMock);

    const r = await improveStory(baseInput);

    expect(r.ok).toBe(true);
    expect(r.improvedText!.length).toBe(2000);
  });

  it('caps the number of questions at 2 and drops empties', async () => {
    const fetchMock = mockAnthropic(
      JSON.stringify({ improvedText: 'A tidy brief.', questions: ['Q1?', '  ', 'Q2?', 'Q3?'] }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const r = await improveStory(baseInput);

    expect(r.questions).toEqual(['Q1?', 'Q2?']);
  });

  it('empty input still runs; the "no story yet" placeholder reaches the prompt', async () => {
    const fetchMock = mockAnthropic(JSON.stringify({ improvedText: 'A gentle starter about a happy day.', questions: [] }));
    vi.stubGlobal('fetch', fetchMock);

    const r = await improveStory({ text: '   ', bookType: 'child' });

    expect(r.ok).toBe(true);
    const [, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(opts.body as string);
    expect(body.messages[0].content).toContain('they have not written anything yet');
  });
});

describe('improveStory — soft-fail (never crashes the theme step)', () => {
  it('HTTP error → { ok:false, reason:llm_error }', async () => {
    const fetchMock = mockAnthropic('boom', false, 500);
    vi.stubGlobal('fetch', fetchMock);

    const r = await improveStory(baseInput);

    expect(r).toEqual({ ok: false, reason: 'llm_error' });
  });

  it('unparseable response → { ok:false, reason:bad_response }', async () => {
    const fetchMock = mockAnthropic('sorry, here is some prose with no json');
    vi.stubGlobal('fetch', fetchMock);

    const r = await improveStory(baseInput);

    expect(r).toEqual({ ok: false, reason: 'bad_response' });
  });

  it('a thrown fetch (network/timeout) → { ok:false, reason:llm_error }', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('aborted'));
    vi.stubGlobal('fetch', fetchMock);

    const r = await improveStory(baseInput);

    expect(r).toEqual({ ok: false, reason: 'llm_error' });
  });
});

describe('improveStory — light abuse cap', () => {
  it('a rapid second call on the same draft is rate-limited (burst debounce)', async () => {
    const fetchMock = mockAnthropic(JSON.stringify({ improvedText: 'ok', questions: [] }));
    vi.stubGlobal('fetch', fetchMock);
    cookieMock.mockResolvedValue('same-cookie-burst');

    const first = await improveStory(baseInput);
    const second = await improveStory(baseInput);

    expect(first.ok).toBe(true);
    expect(second).toEqual({ ok: false, reason: 'rate_limited' });
    // The rate-limited call must not have spent a second LLM request.
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
