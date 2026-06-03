// Next 16 Proxy (formerly Middleware). Runs before any /start/* route
// renders. Mints a draft + sets the cookie for first-time visitors;
// passes through for visitors who already have one.
//
// Why proxy-not-layout: Next 16 forbids cookie mutation during Server
// Component render (see node_modules/next/dist/docs/.../cookies.md).
// Proxy is the only render-time hook that can both read and write
// cookies on the response.
//
// Cost model: we DO a Supabase round-trip on every /start/* request so
// stale cookies (cookie present but draft was deleted by pg_cron,
// expired, or converted) auto-recover into a fresh cookie + draft
// without the customer noticing. ~26ms Sydney→Supabase × 6 step
// navigations per wizard run ≈ 156ms tax total. Acceptable: catches
// the stale case automatically; alternative ("layout detects, redirects
// to /start/reset") trades latency for code complexity and a
// user-visible flash.
//
// Manual reset (customer explicitly wants to start over after finishing
// an order) still exists at /start/reset — that's a different concern
// from automatic stale-cookie recovery.
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
  const existing = request.cookies.get(COOKIE_NAME)?.value ?? null;

  // Always pass the incoming cookie (or null) to the resolver. The
  // resolver decides: found-and-fresh (no work), stale → mint new
  // cookie + draft, missing → same. The proxy itself stays a thin
  // wrapper around the resolver's decision.
  try {
    const result = await getOrCreateDraftForCookie(existing);
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
    // Log to stderr so the dev-server output surfaces the cause. The
    // layout will see whatever cookie state existed before the throw
    // and render either the chrome (cookie was already valid) or an
    // empty wizard (no cookie set). Either way the customer can retry.
    console.error('[proxy] failed to resolve draft:', err);
    return NextResponse.next();
  }
}
