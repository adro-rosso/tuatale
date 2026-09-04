/**
 * Multi-draft actions (startNewBook / switchToDraft / deleteDraft). DB + cookie mocked; the
 * redirect() sentinel records the target URL. Verifies the flag gate, cookie-ownership guards,
 * and that each action calls the right DB helper.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { redirectSpy } = vi.hoisted(() => ({ redirectSpy: vi.fn() }));
class RedirectSentinel extends Error {
  constructor(public readonly url: string) {
    super(`REDIRECT:${url}`);
  }
}
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    redirectSpy(url);
    throw new RedirectSentinel(url);
  },
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/draft-cookie', () => ({ getDraftCookieFromRequest: vi.fn() }));
vi.mock('@/db/drafts', () => ({
  createDraft: vi.fn(),
  getDraftById: vi.fn(),
  touchDraftOpened: vi.fn(),
  expireDraftNow: vi.fn(),
}));

import { startNewBook, switchToDraft, deleteDraft } from '@/app/start/_actions/drafts';
import { getDraftCookieFromRequest } from '@/lib/draft-cookie';
import { createDraft, getDraftById, touchDraftOpened, expireDraftNow } from '@/db/drafts';

const cookie = getDraftCookieFromRequest as ReturnType<typeof vi.fn>;
const redirectUrl = () => redirectSpy.mock.calls.at(-1)?.[0] as string | undefined;
/** Run an action that always redirects; swallow the sentinel. */
async function run(fn: () => Promise<void>) {
  try {
    await fn();
  } catch (e) {
    if (!(e instanceof RedirectSentinel)) throw e;
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.MULTI_DRAFT_ENABLED = 'on';
  cookie.mockResolvedValue('cookie-1');
});

describe('multi-draft actions — flag gate', () => {
  it('flag off → every action bounces to /start and touches no DB', async () => {
    delete process.env.MULTI_DRAFT_ENABLED;
    await run(startNewBook);
    await run(() => switchToDraft('d1'));
    await run(() => deleteDraft('d1'));
    expect(redirectSpy).toHaveBeenCalledTimes(3);
    expect(createDraft).not.toHaveBeenCalled();
    expect(touchDraftOpened).not.toHaveBeenCalled();
    expect(expireDraftNow).not.toHaveBeenCalled();
  });
});

describe('startNewBook', () => {
  it('creates a new draft on the SAME cookie (old parked) → /start/child', async () => {
    await run(startNewBook);
    expect(createDraft).toHaveBeenCalledWith('cookie-1');
    expect(redirectUrl()).toBe('/start/child');
  });
  it('no cookie → bounce, nothing created', async () => {
    cookie.mockResolvedValue(null);
    await run(startNewBook);
    expect(createDraft).not.toHaveBeenCalled();
    expect(redirectUrl()).toBe('/start');
  });
});

describe('switchToDraft', () => {
  it('OWN active draft → touch + land on its step', async () => {
    (getDraftById as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'd2', cookie_id: 'cookie-1', status: 'active', current_step: 'theme' });
    await run(() => switchToDraft('d2'));
    expect(touchDraftOpened).toHaveBeenCalledWith('d2');
    expect(redirectUrl()).toBe('/start/theme');
  });
  it('OWNERSHIP: a foreign cookie draft is refused (no touch, bounce)', async () => {
    (getDraftById as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'd2', cookie_id: 'someone-else', status: 'active', current_step: 'theme' });
    await run(() => switchToDraft('d2'));
    expect(touchDraftOpened).not.toHaveBeenCalled();
    expect(redirectUrl()).toBe('/start');
  });
  it('unknown current_step → /start', async () => {
    (getDraftById as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'd2', cookie_id: 'cookie-1', status: 'active', current_step: 'bogus' });
    await run(() => switchToDraft('d2'));
    expect(redirectUrl()).toBe('/start');
  });
});

describe('deleteDraft', () => {
  it('OWN draft → expire (reaper cleans up) → /start', async () => {
    (getDraftById as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'd2', cookie_id: 'cookie-1', status: 'active' });
    await run(() => deleteDraft('d2'));
    expect(expireDraftNow).toHaveBeenCalledWith('d2');
    expect(redirectUrl()).toBe('/start');
  });
  it('OWNERSHIP: a foreign draft is refused (no expire)', async () => {
    (getDraftById as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'd2', cookie_id: 'someone-else', status: 'active' });
    await run(() => deleteDraft('d2'));
    expect(expireDraftNow).not.toHaveBeenCalled();
    expect(redirectUrl()).toBe('/start');
  });
});
