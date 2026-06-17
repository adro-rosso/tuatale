/**
 * draft-resolver integration tests against the tuatale-test Supabase
 * project. Skips entirely when TEST_SUPABASE_URL is not set.
 *
 * createServerClient (the default client used by the @/db/drafts
 * helpers when no client is passed) is mocked here to return the test-
 * project client instead of the production one. That way the resolver's
 * "no client arg" code path still talks to tuatale-test.
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

import { resolveDraftReadOnly, getOrCreateDraftForCookie } from '@/lib/draft-resolver';
import { createDraft } from '@/db/drafts';
import {
  createTestClient,
  freshUuid,
  shouldSkipIntegrationTests,
  truncateAll,
} from '../db/helpers';
import type { TuataleSupabaseClient } from '@/lib/supabase';

const skipSuite = shouldSkipIntegrationTests();
const describeIntegration = skipSuite ? describe.skip : describe;

describeIntegration('draft-resolver', () => {
  let client: TuataleSupabaseClient;

  beforeAll(() => {
    client = createTestClient();
  });

  beforeEach(async () => {
    await truncateAll(client);
  });

  describe('resolveDraftReadOnly (Server Component path)', () => {
    it('returns cookieless when no cookie supplied', async () => {
      const result = await resolveDraftReadOnly(null);
      expect(result.kind).toBe('cookieless');
    });

    it('returns cookieless when cookie has no active draft', async () => {
      const result = await resolveDraftReadOnly(freshUuid());
      expect(result.kind).toBe('cookieless');
    });

    it('returns found when cookie maps to an active draft', async () => {
      const cookieId = freshUuid();
      await createDraft(cookieId, client);
      const result = await resolveDraftReadOnly(cookieId);
      expect(result.kind).toBe('found');
      if (result.kind === 'found') {
        expect(result.draft.cookie_id).toBe(cookieId);
        expect(result.draft.status).toBe('active');
      }
    });
  });

  describe('getOrCreateDraftForCookie (Proxy path)', () => {
    it('creates a new cookie_id + draft when none supplied', async () => {
      const result = await getOrCreateDraftForCookie(null);
      expect(result.kind).toBe('created');
      if (result.kind === 'created') {
        expect(result.draft.cookie_id).toBe(result.newCookieId);
        expect(result.draft.status).toBe('active');
        expect(result.draft.current_step).toBe('style'); // W-F: 'style' is now the first step
      }
    });

    it('returns found when cookie maps to an existing active draft', async () => {
      const cookieId = freshUuid();
      const existing = await createDraft(cookieId, client);
      const result = await getOrCreateDraftForCookie(cookieId);
      expect(result.kind).toBe('found');
      if (result.kind === 'found') {
        expect(result.draft.id).toBe(existing.id);
      }
    });

    it('mints a fresh cookie_id when supplied cookie is stale', async () => {
      const staleCookieId = freshUuid();
      const result = await getOrCreateDraftForCookie(staleCookieId);
      expect(result.kind).toBe('created');
      if (result.kind === 'created') {
        expect(result.newCookieId).not.toBe(staleCookieId);
        expect(result.draft.cookie_id).toBe(result.newCookieId);
      }
    });
  });
});
