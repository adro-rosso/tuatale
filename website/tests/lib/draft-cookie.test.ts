/**
 * draft-cookie unit tests.
 *
 * Mocks Next 16's next/headers cookies() API. cookies() is async in
 * Next 16 — the mock returns Promise<Store> where Store has get/set
 * methods. The setDraftCookie test verifies the right options are
 * passed (httpOnly, sameSite, etc.) at the .set() callsite.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('next/headers', () => ({
  cookies: vi.fn(),
}));

import { cookies } from 'next/headers';
import {
  getDraftCookieFromRequest,
  setDraftCookie,
  clearDraftCookie,
  getCookieOptions,
  COOKIE_NAME,
  COOKIE_MAX_AGE_SECONDS,
} from '@/lib/draft-cookie';

const mockedCookies = vi.mocked(cookies);

interface StoredCookie {
  name: string;
  value: string;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: string;
  maxAge?: number;
  path?: string;
}

function stubStore(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  const setCalls: StoredCookie[] = [];
  const store = {
    get: vi.fn((name: string) => (map.has(name) ? { name, value: map.get(name) } : undefined)),
    set: vi.fn((obj: StoredCookie) => {
      setCalls.push(obj);
      map.set(obj.name, obj.value);
    }),
    setCalls,
  };
  return store;
}

describe('draft-cookie', () => {
  beforeEach(() => mockedCookies.mockReset());

  it('getDraftCookieFromRequest returns null when no cookie', async () => {
    const store = stubStore();
    mockedCookies.mockResolvedValue(store as never);
    const result = await getDraftCookieFromRequest();
    expect(result).toBeNull();
    expect(store.get).toHaveBeenCalledWith(COOKIE_NAME);
  });

  it('getDraftCookieFromRequest returns value when cookie present', async () => {
    const store = stubStore({ [COOKIE_NAME]: 'cookie-value-abc' });
    mockedCookies.mockResolvedValue(store as never);
    const result = await getDraftCookieFromRequest();
    expect(result).toBe('cookie-value-abc');
  });

  it('setDraftCookie stores the value with the right options', async () => {
    const store = stubStore();
    mockedCookies.mockResolvedValue(store as never);
    await setDraftCookie('new-cookie-id');
    expect(store.set).toHaveBeenCalledTimes(1);
    const passed = store.setCalls[0]!;
    expect(passed.name).toBe(COOKIE_NAME);
    expect(passed.value).toBe('new-cookie-id');
    expect(passed.httpOnly).toBe(true);
    expect(passed.sameSite).toBe('lax');
    expect(passed.maxAge).toBe(COOKIE_MAX_AGE_SECONDS);
    expect(passed.path).toBe('/');
    // `secure` follows NODE_ENV — test env should be non-production.
    expect(passed.secure).toBe(process.env.NODE_ENV === 'production');
  });

  it('clearDraftCookie sets maxAge: 0', async () => {
    const store = stubStore();
    mockedCookies.mockResolvedValue(store as never);
    await clearDraftCookie();
    expect(store.set).toHaveBeenCalledTimes(1);
    expect(store.setCalls[0]!.value).toBe('');
    expect(store.setCalls[0]!.maxAge).toBe(0);
  });

  it('getCookieOptions returns the configured shape', () => {
    const opts = getCookieOptions();
    expect(opts.httpOnly).toBe(true);
    expect(opts.sameSite).toBe('lax');
    expect(opts.maxAge).toBe(COOKIE_MAX_AGE_SECONDS);
    expect(opts.path).toBe('/');
  });
});
