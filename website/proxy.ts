// Next 16 Proxy (formerly Middleware). Runs before any /start/* route
// renders. Mints a draft + sets the cookie for first-time visitors;
// passes through for visitors who already have one.
//
// Why proxy-not-layout: Next 16 forbids cookie mutation during Server
// Component render (see node_modules/next/dist/docs/.../cookies.md).
// Proxy is the only render-time hook that can both read and write
// cookies on the response.
//
// Why pass-through on cookie-present: the proxy docs warn against using
// it for "slow data fetching". A DB round-trip on every navigation
// would add ~26ms (Sydney→Supabase) × 6 step navigations per wizard run.
// We accept that a stale-cookie case (cookie set but DB row missing —
// pg_cron deleted it after 30 days) shows up as cookieless in the
// layout, which redirects to /start/reset (a Route Handler that
// regenerates everything — to be added in Phase 2.C if it bites).
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { COOKIE_NAME, getCookieOptions } from '@/lib/draft-cookie';
import { getOrCreateDraftForCookie } from '@/lib/draft-resolver';

export const config = {
  // Run on the wizard entry route (bare /start) AND every nested step
  // (/start/child, /start/secondaries, etc.). The /start/:path* glob
  // does NOT match bare /start — path-to-regexp treats the segment
  // after the slash as mandatory — so we list both explicitly. Phase
  // 2.D will extend the array for /api/preview/* to attach rate-limit
  // headers.
  matcher: ['/start', '/start/:path*'],
};

export async function proxy(request: NextRequest): Promise<NextResponse> {
  const existing = request.cookies.get(COOKIE_NAME)?.value;

  // Fast path: cookie present. Trust it and let the layout do the DB
  // read. Stale-cookie recovery isn't this layer's job.
  if (existing) {
    return NextResponse.next();
  }

  // Cold path: first visit, no cookie. Mint a draft + set the cookie
  // before the layout renders. Failure to create the draft is
  // non-fatal — the layout will detect cookieless state and show a
  // graceful "couldn't start a new book right now" message.
  try {
    const result = await getOrCreateDraftForCookie(null);
    const response = NextResponse.next();
    if (result.kind === 'created') {
      response.cookies.set({
        name: COOKIE_NAME,
        value: result.newCookieId,
        ...getCookieOptions(),
      });
    }
    return response;
  } catch (err) {
    // Sentry doesn't run in the proxy (no instrumentation hook here).
    // Log to stderr so the dev-server output surfaces the cause; the
    // layout will see cookieless state and render an error UI; that
    // path DOES report to Sentry via the standard mechanism.
    console.error('[proxy] failed to mint draft cookie:', err);
    return NextResponse.next();
  }
}
