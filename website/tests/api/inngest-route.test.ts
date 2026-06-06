/**
 * Smoke test for /api/inngest route handler.
 *
 * The route just wires `inngest/next`'s `serve()` to our client +
 * functions list. There's no business logic to assert beyond "the
 * route exists and the introspection endpoint returns a 2xx" — the
 * actual Inngest webhook handling is the SDK's concern.
 *
 * GET on the endpoint returns the function metadata Inngest uses to
 * discover what's deployed (mode + function ids + capabilities). In
 * dev mode (no INNGEST_SIGNING_KEY) the introspection is open; in
 * production it's gated on the signing key, so we don't try to
 * assert specific body shape — just that the route handler exists
 * and is callable.
 */
import { describe, it, expect } from 'vitest';
import { GET, POST, PUT } from '@/app/api/inngest/route';

describe('/api/inngest', () => {
  it('exports GET, POST, PUT handlers from inngest/next serve()', () => {
    expect(typeof GET).toBe('function');
    expect(typeof POST).toBe('function');
    expect(typeof PUT).toBe('function');
  });

  it('GET returns a Response (introspection or signed challenge)', async () => {
    const req = new Request('http://localhost/api/inngest');
    // inngest/next typed the second arg as `unknown` for Next 12+
    // compatibility — App Router doesn't actually use it, so passing
    // null is safe.
    const res = await GET(req as never, null);
    expect(res).toBeInstanceOf(Response);
    // We don't pin the status — without a signing key it's 200 with
    // introspection; with one it's gated. Either way, a Response object
    // proves the SDK wired the route.
    expect(typeof res.status).toBe('number');
  });
});
