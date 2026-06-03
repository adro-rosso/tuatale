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
 * bare `https://<ref>.supabase.co` — if the env value accidentally
 * includes `/rest/v1/` or a trailing slash (easy mistake when copying
 * from the dashboard's REST URL field), PostgREST queries silently
 * break with PGRST125 "Invalid path specified in request URL". Auth
 * calls don't trip on this because the SDK uses the host-only form for
 * auth, so the breakage only shows up under real DB queries.
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
