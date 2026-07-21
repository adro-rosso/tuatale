/**
 * submit-hero — LAYER 2 of the adult gate.
 *   2b: a stale/forged 'adult' submit with the branch OFF REDIRECTS to hero (never
 *       silently substitutes a child book for the adult the customer chose).
 *   2a: persisting a non-adult book_type CLEARS adult-shaped stale fields (a >12
 *       child_age, an adult-only vibe) — required so the update satisfies the migrated
 *       drafts CHECK, and makes the charged-then-failed prevention explicit.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { redirectSpy, updateSpy, draftStore } = vi.hoisted(() => ({
  redirectSpy: vi.fn(),
  updateSpy: vi.fn(),
  draftStore: { current: null as Record<string, unknown> | null },
}));

class RedirectSentinel extends Error {}
vi.mock('next/navigation', () => ({
  redirect: (url: string) => { redirectSpy(url); throw new RedirectSentinel(url); },
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/db/drafts', () => ({
  updateDraftByCookieId: (...a: unknown[]) => updateSpy(...a),
  getDraftByCookieId: vi.fn(async () => draftStore.current),
}));
vi.mock('@/lib/draft-cookie', () => ({ getDraftCookieFromRequest: vi.fn().mockResolvedValue('cookie-1') }));

import { submitHeroStep } from '@/app/start/_actions/submit-hero';

function fd(bookType: string): FormData {
  const f = new FormData();
  f.append('book_type', bookType);
  return f;
}
const run = (bt: string) => submitHeroStep({ errors: {} }, fd(bt)).catch((e) => { if (!(e instanceof RedirectSentinel)) throw e; });
const updateArg = () => updateSpy.mock.calls[0]?.[1] as Record<string, unknown> | undefined;

beforeEach(() => { redirectSpy.mockClear(); updateSpy.mockClear(); draftStore.current = null; delete process.env.ADULT_BRANCH_ENABLED; });
afterEach(() => { delete process.env.ADULT_BRANCH_ENABLED; });

describe('submitHeroStep — layer 2b (redirect, never substitute)', () => {
  it('flag OFF + adult submit → REDIRECTS to hero, does NOT persist', async () => {
    await run('adult');
    expect(redirectSpy).toHaveBeenCalledWith('/start/hero');
    expect(updateSpy).not.toHaveBeenCalled(); // never silently became a child book
  });

  it('flag ON + adult submit → persists adult (no redirect-away)', async () => {
    process.env.ADULT_BRANCH_ENABLED = 'on';
    await run('adult');
    expect(updateArg()).toMatchObject({ book_type: 'adult' });
    expect(redirectSpy).toHaveBeenCalledWith('/start/style');
  });
});

describe('submitHeroStep — layer 2a (clear adult-shaped stale fields)', () => {
  it('adult draft → pick child: clears >12 child_age AND adult-only vibe', async () => {
    draftStore.current = { child_age: 38, vibe: 'roast', age_range: null };
    await run('child');
    const u = updateArg()!;
    expect(u.book_type).toBe('child');
    expect(u.child_age).toBeNull();
    expect(u.vibe).toBeNull();
  });

  it("keeps a SHARED vibe ('adventure') when switching adult → pet", async () => {
    draftStore.current = { child_age: 40, vibe: 'adventure' };
    await run('pet');
    const u = updateArg()!;
    expect(u.child_age).toBeNull(); // >12 still cleared
    expect('vibe' in u).toBe(false); // 'adventure' is valid for pets — untouched
  });

  it('a fresh child draft (no stale fields) is not needlessly modified', async () => {
    draftStore.current = { child_age: null, vibe: null };
    await run('child');
    const u = updateArg()!;
    expect('child_age' in u).toBe(false);
    expect('vibe' in u).toBe(false);
  });
});

describe('submitHeroStep — byte-identical child/pet, flag OFF and ON', () => {
  it('child + pet persist their own book_type in either flag state', async () => {
    for (const flag of [undefined, 'on']) {
      for (const bt of ['child', 'pet']) {
        updateSpy.mockClear();
        draftStore.current = { child_age: null, vibe: null };
        if (flag) process.env.ADULT_BRANCH_ENABLED = flag; else delete process.env.ADULT_BRANCH_ENABLED;
        await run(bt);
        expect((updateArg() as { book_type: string }).book_type).toBe(bt);
      }
    }
  });
});
