/**
 * Test helpers for db/ integration tests.
 *
 * Tests run against a SEPARATE Supabase project (tuatale-test), identified
 * by TEST_SUPABASE_URL + TEST_SUPABASE_SERVICE_ROLE_KEY env vars. CI does
 * NOT have these set — db/ tests skip automatically in CI (see
 * `shouldSkipIntegrationTests` below). Local runs need .env.local
 * populated with the tuatale-test credentials AND migrations applied
 * (see db/README.md for setup).
 *
 * Migration application is manual today: `npx supabase db push
 * --db-url <test connection string>`. We could automate it (read SQL
 * files, exec via rpc) but the once-per-machine setup tax is small.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import type { TuataleSupabaseClient } from '@/lib/supabase';

export function shouldSkipIntegrationTests(): boolean {
  return !process.env.TEST_SUPABASE_URL || !process.env.TEST_SUPABASE_SERVICE_ROLE_KEY;
}

/**
 * Build a Supabase client pointed at tuatale-test. Throws clearly if the
 * env isn't set — but in practice the calling test suite should
 * `describe.skipIf(shouldSkipIntegrationTests())` first.
 */
export function createTestClient(): TuataleSupabaseClient {
  const url = process.env.TEST_SUPABASE_URL;
  const key = process.env.TEST_SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      'TEST_SUPABASE_URL and TEST_SUPABASE_SERVICE_ROLE_KEY must be set ' +
        'to run db/ integration tests. See website/db/README.md.',
    );
  }
  const client: SupabaseClient<Database> = createClient<Database>(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return client;
}

/**
 * Wipe every row from the application tables. Called from `beforeEach`
 * in each suite so tests start from a known empty state.
 *
 * We use bulk delete with an impossible-id .neq() filter rather than
 * TRUNCATE because Supabase's REST client requires a WHERE clause on
 * destructive ops.
 *
 * Order matters — FK constraints:
 *   pipeline_jobs  (FK -> orders, ON DELETE RESTRICT)
 *   preview_events (loose draft_id reference, no FK)
 *   orders         (loose converted_from_draft_id, no FK)
 *   drafts         (root)
 */
const IMPOSSIBLE_UUID = '00000000-0000-0000-0000-000000000000';

export async function truncateAll(client: TuataleSupabaseClient): Promise<void> {
  for (const table of ['pipeline_jobs', 'preview_events', 'orders', 'drafts'] as const) {
    const { error } = await client.from(table).delete().neq('id', IMPOSSIBLE_UUID);
    if (error) {
      throw new Error(`truncateAll: failed on ${table}: ${error.message}`);
    }
  }
}

/**
 * Generate a fresh uuid for use as a test cookie or draft id. Uses
 * crypto.randomUUID which is built-in in Node ≥ 19.
 */
export function freshUuid(): string {
  return crypto.randomUUID();
}
