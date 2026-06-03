// Server only — wraps the db/drafts helpers with the wizard-specific
// "get-or-create" logic the proxy + Server Components both need.
import { drafts } from '@/db';
import type { Tables } from '@/types/database';

type DraftRow = Tables<'drafts'>;

/**
 * Lookup result for a cookie. Discriminated union so callers can tell
 * "found an active draft" apart from "cookie present but no usable
 * draft" without inspecting nulls.
 */
export type ResolveResult =
  | { kind: 'found'; draft: DraftRow }
  | { kind: 'created'; draft: DraftRow; newCookieId: string }
  | { kind: 'cookieless'; draft: null };

/**
 * Server Component / layout path: read-only lookup.
 *
 * Returns 'found' when the cookie identifies an active draft. Returns
 * 'cookieless' for any "no draft for this cookie" case (no cookie,
 * stale cookie, expired draft, converted draft) — the caller decides
 * what to do, since render-time code CAN'T set cookies in Next 16.
 *
 * Pair this with the proxy's getOrCreateForCookie: the proxy ensures a
 * fresh visitor gets a cookie + draft on first request, so by the time
 * the layout calls this it should only hit 'found' on the happy path.
 */
export async function resolveDraftReadOnly(cookieId: string | null): Promise<ResolveResult> {
  if (!cookieId) return { kind: 'cookieless', draft: null };
  const draft = await drafts.getDraftByCookieId(cookieId);
  if (!draft) return { kind: 'cookieless', draft: null };
  return { kind: 'found', draft };
}

/**
 * Proxy path: get-or-create. ONLY safe to call from contexts that can
 * set cookies (proxy.ts via NextResponse.cookies.set, or Server Actions
 * via cookies().set).
 *
 * Behaviour:
 *   - cookie present + active draft     → { kind: 'found' }
 *   - cookie present but no draft / stale → mint new cookie_id + draft
 *   - no cookie                          → mint new cookie_id + draft
 *
 * When a new cookie_id is minted, the caller MUST set the cookie on the
 * response. The newCookieId field on the 'created' result is the value
 * to set.
 */
export async function getOrCreateDraftForCookie(cookieId: string | null): Promise<ResolveResult> {
  if (cookieId) {
    const existing = await drafts.getDraftByCookieId(cookieId);
    if (existing) return { kind: 'found', draft: existing };
    // Cookie was present but no active draft — treat as fresh start.
    // We MINT A NEW cookie_id rather than reusing the stale one so the
    // old (potentially-leaked) value doesn't keep mapping to anything.
  }
  const newCookieId = crypto.randomUUID();
  const draft = await drafts.createDraft(newCookieId);
  return { kind: 'created', draft, newCookieId };
}
