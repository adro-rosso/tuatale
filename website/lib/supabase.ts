/**
 * Supabase clients for Tuatale.
 *
 * Two factories — never accept the wrong one in the wrong context:
 *
 *   createBrowserClient() — uses the anon (public) key. Safe in client
 *     components, browser bundles, and anywhere user-visible. Subject to
 *     Row-Level Security policies.
 *
 *   createServerClient() — uses the service role key. NEVER expose this
 *     to the browser. Use only in server components, route handlers, and
 *     server actions. Bypasses RLS — be deliberate with what you query.
 *
 * Phase 1 is inert: clients construct, no schema is queried, /api/health
 * just confirms construction succeeded. Real queries arrive in Phase 2.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';

/**
 * Typed Supabase client alias. Callers get full IntelliSense on
 * `.from('drafts')` / `.from('orders')` / `.from('preview_events')`
 * including Row / Insert / Update shapes from types/database.ts.
 */
export type TuataleSupabaseClient = SupabaseClient<Database>;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === '') {
    throw new Error(
      `Missing required environment variable: ${name}. ` +
        `Copy .env.example to .env.local and fill in real values.`,
    );
  }
  return value;
}

/**
 * Strip any path / trailing slash from a Supabase URL. The SDK expects
 * bare `https://<ref>.supabase.co`.
 *
 * Defense-in-depth: as of Phase 2.B.1 (2026-06-03), .env.local and the
 * Vercel project both hold the bare host form, so this function is a
 * no-op on the happy path. Kept anyway because the failure mode of a
 * mis-copied URL (e.g. pasting the dashboard's REST URL field, which
 * has `/rest/v1/` appended) is silent and very hard to diagnose:
 * Auth calls work because the SDK uses host-only for auth, so /api/health
 * reports "connected" even with a broken URL. The breakage only shows
 * up under PostgREST queries with code PGRST125 "Invalid path specified
 * in request URL". Phase 2.B spent ~30 minutes debugging exactly that;
 * the normalization stops it ever happening again. Cost is zero —
 * `new URL(raw).host` runs once per client construction.
 */
function normalizeSupabaseUrl(raw: string): string {
  try {
    const u = new URL(raw);
    return `${u.protocol}//${u.host}`;
  } catch {
    return raw.replace(/\/+$/, '');
  }
}

export function createBrowserClient(): TuataleSupabaseClient {
  const url = normalizeSupabaseUrl(requireEnv('NEXT_PUBLIC_SUPABASE_URL'));
  const anonKey = requireEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY');
  return createClient<Database>(url, anonKey);
}

export function createServerClient(): TuataleSupabaseClient {
  const url = normalizeSupabaseUrl(requireEnv('NEXT_PUBLIC_SUPABASE_URL'));
  const serviceRoleKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY');
  return createClient<Database>(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
