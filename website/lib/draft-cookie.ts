// Server only — this module reads + writes the wizard draft cookie via
// next/headers' cookies() API. NEVER import from a client component.
//
// The cookie stores a `cookie_id` UUID that identifies a browser session
// (NOT a particular draft). One cookie can map to many drafts over time
// — each successful conversion creates a fresh draft row, but the cookie
// stays the same so the customer's identity persists across orders.
import { cookies } from 'next/headers';

/**
 * Cookie name used everywhere — proxy, Server Actions, layout.
 * Never typo this anywhere else; always import.
 */
export const COOKIE_NAME = 'tuatale_draft_id';

/**
 * 30-day cookie lifetime in seconds. Matches the drafts table's expiry
 * window so the cookie outlives any draft it might be associated with
 * (cookie expires roughly together with the draft, not before it).
 */
export const COOKIE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

interface CookieOptions {
  httpOnly: boolean;
  secure: boolean;
  sameSite: 'lax';
  maxAge: number;
  path: string;
}

/**
 * Cookie options for the current environment. Production demands HTTPS
 * (Secure flag) but local dev runs on plain HTTP and would silently drop
 * Secure cookies. NODE_ENV is the env var Next + Vercel set — 'production'
 * in built deploys, 'development' for `next dev`.
 */
export function getCookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: COOKIE_MAX_AGE_SECONDS,
    path: '/',
  };
}

/**
 * Read the draft cookie from the current request. Returns the cookie's
 * UUID value or null. Safe to call from Server Components, Server
 * Actions, Route Handlers — anywhere `cookies()` is allowed.
 *
 * Note: `cookies()` is async in Next 16 — must be awaited.
 */
export async function getDraftCookieFromRequest(): Promise<string | null> {
  const store = await cookies();
  return store.get(COOKIE_NAME)?.value ?? null;
}

/**
 * Set the draft cookie. ONLY callable from Server Actions or Route
 * Handlers — Next 16 explicitly forbids cookie mutation during Server
 * Component render (see node_modules/next/dist/docs/.../cookies.md).
 *
 * Proxy uses a different API (response.cookies.set on NextResponse) —
 * see proxy.ts for the proxy-side equivalent. This function is only for
 * Server Action contexts.
 */
export async function setDraftCookie(cookieId: string): Promise<void> {
  const store = await cookies();
  store.set({
    name: COOKIE_NAME,
    value: cookieId,
    ...getCookieOptions(),
  });
}

/**
 * Clear the draft cookie. Same Server-Action-or-Route-Handler-only
 * restriction as setDraftCookie. Used for explicit reset flows and on
 * order completion (Phase 2.E will wire that).
 */
export async function clearDraftCookie(): Promise<void> {
  const store = await cookies();
  store.set({
    name: COOKIE_NAME,
    value: '',
    ...getCookieOptions(),
    maxAge: 0,
  });
}
