// Server only — bridges the Phase 2.B `resolveDraftReadOnly()` (which
// takes a cookieId) and Phase 2.C's getDraft() pattern (which reads
// the cookie itself + caches the result per request via React.cache).
//
// Why cache(): the wizard layout fetches the draft to personalise the
// step header AND the PricePanel reads it to compute the live total.
// Without cache, each Server Component that calls getDraft() would
// trigger its own Supabase round-trip. cache() dedupes calls within a
// single request so we get a single DB hit per page render.
import { cache } from 'react';
import { resolveDraftReadOnly, type ResolveResult } from './draft-resolver';
import { getDraftCookieFromRequest } from './draft-cookie';

/**
 * Read the customer's active draft for the current request. Result is
 * memoised per request via React.cache; subsequent calls within the same
 * render are free.
 *
 * Returns the full ResolveResult — callers can discriminate between
 * 'found' (happy path) and 'cookieless' (proxy didn't run, cookie was
 * cleared, or DB lookup failed). The wizard layout treats 'cookieless'
 * as a redirect to /start/reset; the price panel can render its base
 * total even without a draft.
 */
export const getDraft = cache(async (): Promise<ResolveResult> => {
  const cookieId = await getDraftCookieFromRequest();
  return resolveDraftReadOnly(cookieId);
});
