/**
 * proxy.ts unit tests.
 *
 * Mocks @/lib/supabase to point at the tuatale-test project so the
 * resolver's DB calls hit test data, not prod. Constructs NextRequest
 * instances directly + calls the proxy function; inspects the returned
 * NextResponse's cookie jar.
 *
 * Coverage (matches Phase 2.B.1 Item 6 spec):
 *   1. no cookie         → mints + sets cookie
 *   2. valid cookie      → passes through, no DB writes
 *   3. stale cookie      → mints fresh (different value)
 *   4. expired draft     → mints fresh
 *   5. converted draft   → mints fresh
 *   6. cookie options    → httpOnly, sameSite=lax, maxAge=30d
 *   7. matcher config    → includes both '/start' AND '/start/:path*'
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

vi.mock('@/lib/supabase', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/supabase')>();
  const { createClient } = await import('@supabase/supabase-js');
  return {
    ...actual,
    createServerClient: () => {
      const url = process.env.TEST_SUPABASE_URL;
      const key = process.env.TEST_SUPABASE_SERVICE_ROLE_KEY;
      if (!url || !key) {
        throw new Error('TEST_SUPABASE_* env vars not set in mock factory');
      }
      return createClient(url, key, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
    },
  };
});

import { NextRequest } from 'next/server';
import { proxy, config as proxyConfig } from '@/proxy';
import { COOKIE_NAME, COOKIE_MAX_AGE_SECONDS } from '@/lib/draft-cookie';
import { createDraft, getDraftByCookieId, updateDraft } from '@/db/drafts';
import { createTestClient, freshUuid, shouldSkipIntegrationTests, truncateAll } from './db/helpers';
import type { TuataleSupabaseClient } from '@/lib/supabase';

const skipSuite = shouldSkipIntegrationTests();
const describeIntegration = skipSuite ? describe.skip : describe;

function makeRequest(url: string, cookieValue?: string): NextRequest {
  const headers = new Headers();
  if (cookieValue) {
    headers.set('cookie', `${COOKIE_NAME}=${cookieValue}`);
  }
  return new NextRequest(url, { headers });
}

describeIntegration('proxy — first-visit cookie minting', () => {
  let client: TuataleSupabaseClient;

  beforeAll(() => {
    client = createTestClient();
  });

  beforeEach(async () => {
    await truncateAll(client);
  });

  it('no cookie → mints cookie + creates draft', async () => {
    const req = makeRequest('http://localhost/start');
    const res = await proxy(req);

    const cookie = res.cookies.get(COOKIE_NAME);
    expect(cookie).toBeDefined();
    expect(cookie?.value).toMatch(/^[0-9a-f-]{36}$/);

    const draft = await getDraftByCookieId(cookie!.value, client);
    expect(draft).not.toBeNull();
    expect(draft?.current_step).toBe('child');
    expect(draft?.status).toBe('active');
  });

  it('cookie has correct options', async () => {
    const req = makeRequest('http://localhost/start');
    const res = await proxy(req);
    const cookie = res.cookies.get(COOKIE_NAME);

    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.sameSite).toBe('lax');
    expect(cookie?.maxAge).toBe(COOKIE_MAX_AGE_SECONDS);
    expect(cookie?.path).toBe('/');
    // Secure follows NODE_ENV — test env is non-production.
    expect(cookie?.secure).toBe(process.env.NODE_ENV === 'production');
  });

  it('valid cookie → passes through, no new cookie set, no DB writes', async () => {
    const cookieId = freshUuid();
    const created = await createDraft(cookieId, client);
    const beforeUpdatedAt = created.updated_at;

    const req = makeRequest('http://localhost/start', cookieId);
    const res = await proxy(req);

    // No Set-Cookie on the response.
    expect(res.cookies.get(COOKIE_NAME)).toBeUndefined();

    // Same draft row, untouched.
    const after = await getDraftByCookieId(cookieId, client);
    expect(after?.id).toBe(created.id);
    expect(after?.updated_at).toBe(beforeUpdatedAt);
  });

  it('stale cookie (no DB row) → mints fresh cookie + new draft', async () => {
    const staleCookieId = freshUuid();
    const req = makeRequest('http://localhost/start', staleCookieId);
    const res = await proxy(req);

    const cookie = res.cookies.get(COOKIE_NAME);
    expect(cookie).toBeDefined();
    expect(cookie?.value).not.toBe(staleCookieId);
    expect(cookie?.value).toMatch(/^[0-9a-f-]{36}$/);

    // The fresh draft exists under the new cookie value.
    const draft = await getDraftByCookieId(cookie!.value, client);
    expect(draft).not.toBeNull();
  });

  it('cookie pointing at expired draft → mints fresh cookie + new draft', async () => {
    const cookieId = freshUuid();
    const draft = await createDraft(cookieId, client);
    await updateDraft(draft.id, { status: 'expired' }, client);

    const req = makeRequest('http://localhost/start', cookieId);
    const res = await proxy(req);

    const cookie = res.cookies.get(COOKIE_NAME);
    expect(cookie).toBeDefined();
    expect(cookie?.value).not.toBe(cookieId);
  });

  it('cookie pointing at converted draft → mints fresh cookie + new draft', async () => {
    const cookieId = freshUuid();
    const draft = await createDraft(cookieId, client);
    await updateDraft(draft.id, { status: 'converted' }, client);

    const req = makeRequest('http://localhost/start', cookieId);
    const res = await proxy(req);

    const cookie = res.cookies.get(COOKIE_NAME);
    expect(cookie).toBeDefined();
    expect(cookie?.value).not.toBe(cookieId);
  });

  it('/start/success → passes through without minting a new cookie', async () => {
    // Customer's draft was just converted by the webhook. Without the
    // early-return, the resolver would see "no active draft" and mint
    // a fresh cookie + draft pair every time the success page renders.
    const cookieId = freshUuid();
    const draft = await createDraft(cookieId, client);
    await updateDraft(draft.id, { status: 'converted' }, client);

    const req = makeRequest('http://localhost/start/success?session_id=cs_test_abc', cookieId);
    const res = await proxy(req);

    // No new cookie minted.
    expect(res.cookies.get(COOKIE_NAME)).toBeUndefined();
    // No new draft created.
    const fresh = await getDraftByCookieId(cookieId, client);
    expect(fresh).toBeNull(); // converted, not active
  });
});

describe('proxy — matcher config', () => {
  // No DB needed for the matcher test — it's structural.
  it("matches bare '/start' AND nested '/start/:path*'", () => {
    expect(proxyConfig.matcher).toEqual(['/start', '/start/:path*']);
  });
});
