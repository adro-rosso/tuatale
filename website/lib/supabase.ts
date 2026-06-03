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

export function createBrowserClient(): TuataleSupabaseClient {
  const url = requireEnv('NEXT_PUBLIC_SUPABASE_URL');
  const anonKey = requireEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY');
  return createClient<Database>(url, anonKey);
}

export function createServerClient(): TuataleSupabaseClient {
  const url = requireEnv('NEXT_PUBLIC_SUPABASE_URL');
  const serviceRoleKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY');
  return createClient<Database>(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
