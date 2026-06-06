/**
 * HTTP Basic Auth helpers for /admin/* routes.
 *
 * Single-admin design (v1): one shared username/password pair in env,
 * fail-closed when either is missing. The proxy gates every /admin/*
 * request through this check. The browser caches the credentials per
 * session via the WWW-Authenticate prompt.
 *
 * Future migration to multi-admin will swap this for a real auth
 * layer (Supabase Auth / Clerk / etc.); the contract these helpers
 * own — "is this request authorised as an admin" + "who is the
 * admin" — stays the same.
 *
 * Server-only. Never import from a client component.
 */
import { timingSafeEqual } from 'node:crypto';

/**
 * Build the expected `Basic <base64>` string from the env-configured
 * admin credentials. Returns null when either env var is missing
 * (the proxy treats that as a hard-deny so /admin/* can't be hit
 * accidentally in a half-configured environment).
 */
export function expectedBasicAuthHeader(): string | null {
  const username = process.env.ADMIN_USERNAME;
  const password = process.env.ADMIN_PASSWORD;
  if (!username || !password) return null;
  const encoded = Buffer.from(`${username}:${password}`).toString('base64');
  return `Basic ${encoded}`;
}

/**
 * Constant-time comparison of the supplied Authorization header
 * against the expected value. Constant-time matters because a naive
 * `===` reveals position-of-first-mismatch via response timing,
 * which over enough requests narrows the password.
 *
 * We pre-check length before timingSafeEqual: the underlying buffer
 * comparison throws on length mismatch, which would itself become a
 * timing oracle. Branching on length when the inputs differ in
 * length is fine — the attacker already knows the prefix length
 * (it's "Basic ") so any leak of the suffix length only narrows by
 * the base64 padding, which they could compute anyway.
 */
export function isValidBasicAuth(authHeader: string | null | undefined): boolean {
  const expected = expectedBasicAuthHeader();
  if (!expected) return false;
  if (!authHeader) return false;
  if (authHeader.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(authHeader), Buffer.from(expected));
  } catch {
    return false;
  }
}

/**
 * The configured admin's username. Used as `reviewed_by` on
 * pipeline_jobs transitions (markShipped, markCancelled, retry).
 *
 * Returns null when ADMIN_USERNAME is unset — callers should already
 * have hit the auth gate by this point, but defensive null is
 * cheaper than throwing.
 */
export function adminUsername(): string | null {
  return process.env.ADMIN_USERNAME ?? null;
}
