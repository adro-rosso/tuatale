/**
 * Navigation Server Action integration tests.
 *
 * Three module mocks:
 *   - @/lib/supabase: swap createServerClient → test-project client
 *   - next/navigation: redirect() throws a sentinel + records the URL
 *   - next/headers: cookies() returns a stub keyed off the test's
 *     cookieValue.current local
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

// vi.hoisted lets the next/navigation + next/headers mock factories
// reference these locals — the factory itself is hoisted above all
// imports, so plain top-level consts wouldn't be accessible there.
const { redirectSpy, cookieValue } = vi.hoisted(() => ({
  redirectSpy: vi.fn(),
  cookieValue: { current: null as string | null },
}));

class RedirectSentinel extends Error {
  constructor(public readonly url: string) {
    super(`REDIRECT:${url}`);
    this.name = 'RedirectSentinel';
  }
}

vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    redirectSpy(url);
    throw new RedirectSentinel(url);
  },
}));

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({
    get: (name: string) =>
      name === 'tuatale_draft_id' && cookieValue.current
        ? { name, value: cookieValue.current }
        : undefined,
  })),
}));

import { advanceStep, goBack } from '@/app/start/_actions/navigation';
import { InvalidTransitionError } from '@/app/start/_actions/errors';
import { createDraft, getDraftByCookieId } from '@/db/drafts';
import {
  createTestClient,
  freshUuid,
  shouldSkipIntegrationTests,
  truncateAll,
} from '../../db/helpers';
import type { TuataleSupabaseClient } from '@/lib/supabase';

const skipSuite = shouldSkipIntegrationTests();
const describeIntegration = skipSuite ? describe.skip : describe;

describeIntegration('wizard navigation actions', () => {
  let client: TuataleSupabaseClient;

  beforeAll(() => {
    client = createTestClient();
  });

  beforeEach(async () => {
    await truncateAll(client);
    redirectSpy.mockClear();
    cookieValue.current = null;
  });

  it('advanceStep persists current_step forward and redirects', async () => {
    const cookieId = freshUuid();
    await createDraft(cookieId, client);
    cookieValue.current = cookieId;

    await expect(advanceStep('child')).rejects.toBeInstanceOf(RedirectSentinel);
    expect(redirectSpy).toHaveBeenCalledWith('/start/secondaries');

    const draft = await getDraftByCookieId(cookieId, client);
    expect(draft?.current_step).toBe('secondaries');
  });

  it('advanceStep throws InvalidTransitionError from the last step', async () => {
    cookieValue.current = freshUuid();
    await expect(advanceStep('payment')).rejects.toBeInstanceOf(InvalidTransitionError);
    expect(redirectSpy).not.toHaveBeenCalled();
  });

  it('goBack redirects without rewinding current_step', async () => {
    const cookieId = freshUuid();
    await createDraft(cookieId, client);
    cookieValue.current = cookieId;
    await expect(advanceStep('child')).rejects.toBeInstanceOf(RedirectSentinel);
    await expect(advanceStep('secondaries')).rejects.toBeInstanceOf(RedirectSentinel);

    redirectSpy.mockClear();
    await expect(goBack('theme')).rejects.toBeInstanceOf(RedirectSentinel);
    expect(redirectSpy).toHaveBeenCalledWith('/start/secondaries');

    const draft = await getDraftByCookieId(cookieId, client);
    expect(draft?.current_step).toBe('theme');
  });

  it('goBack throws InvalidTransitionError from the first step', async () => {
    cookieValue.current = freshUuid();
    await expect(goBack('child')).rejects.toBeInstanceOf(InvalidTransitionError);
    expect(redirectSpy).not.toHaveBeenCalled();
  });

  it('redirects to /start if cookie missing', async () => {
    cookieValue.current = null;
    await expect(advanceStep('child')).rejects.toBeInstanceOf(RedirectSentinel);
    expect(redirectSpy).toHaveBeenCalledWith('/start');
  });

  it('redirects to /start if cookie present but no draft', async () => {
    cookieValue.current = freshUuid();
    await expect(advanceStep('child')).rejects.toBeInstanceOf(RedirectSentinel);
    expect(redirectSpy).toHaveBeenCalledWith('/start');
  });
});
