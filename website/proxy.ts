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
import { isValidBasicAuth } from '@/lib/admin-auth';

export const config = {
  // Run on the wizard entry route (bare /start) AND every nested step
  // (/start/child, /start/secondaries, etc.). The /start/:path* glob
  // does NOT match bare /start — path-to-regexp treats the segment
  // after the slash as mandatory — so we list both explicitly.
  //
  // /admin and /admin/* are gated by HTTP Basic Auth (Cycle A.4).
  matcher: ['/start', '/start/:path*', '/admin', '/admin/:path*'],
};

export async function proxy(request: NextRequest): Promise<NextResponse> {
  const pathname = request.nextUrl.pathname;

  // /admin/* — HTTP Basic Auth gate. Fail-closed: if ADMIN_USERNAME
  // or ADMIN_PASSWORD env vars are missing, every request returns
  // 401 so a half-configured environment can't leak the admin
  // surface. Browser prompts for credentials via the WWW-Authenticate
  // header and caches them per session.
  if (pathname === '/admin' || pathname.startsWith('/admin/')) {
    if (!isValidBasicAuth(request.headers.get('authorization'))) {
      return new NextResponse('Authentication required', {
        status: 401,
        headers: { 'WWW-Authenticate': 'Basic realm="Tuatale Admin"' },
      });
    }
    return NextResponse.next();
  }

  // Stash the pathname on a request header so /start/layout.tsx (a
  // Server Component, no access to useSelectedLayoutSegment) can
  // detect the active route and switch between wizard chrome and the
  // success page's minimal chrome.
  const forwardedHeaders = new Headers(request.headers);
  forwardedHeaders.set('x-pathname', pathname);
  const nextOptions = { request: { headers: forwardedHeaders } };

  // /start/success runs AFTER the customer's draft has been converted
  // to an order by the Stripe webhook. The resolver would see "cookie
  // present but no active draft" and mint a fresh cookie + draft pair
  // every time the success page renders — polluting drafts with rows
  // the customer doesn't want and silently replacing their cookie.
  // Skip cookie work for this route entirely; the success page reads
  // the order via the URL's session_id, not the cookie.
  if (pathname === '/start/success') {
    return NextResponse.next(nextOptions);
  }

  const existing = request.cookies.get(COOKIE_NAME)?.value ?? null;

  // Always pass the incoming cookie (or null) to the resolver. The
  // resolver decides: found-and-fresh (no work), stale → mint new
  // cookie + draft, missing → same. The proxy itself stays a thin
  // wrapper around the resolver's decision.
  try {
    const result = await getOrCreateDraftForCookie(existing);
    const response = NextResponse.next(nextOptions);
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
    return NextResponse.next(nextOptions);
  }
}
