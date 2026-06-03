/**
 * Preview events query helpers.
 *
 * preview_events is append-only — no updates, no deletes. Each preview
 * attempt writes one row; rate-limit checks read recent rows; admin
 * tooling reads flagged rows.
 *
 * Window queries (countByIpRecent, countByEmailRecent) use Postgres
 * timestamptz arithmetic in the .gte() clause. The composite indexes
 * (ip_address, created_at desc) and (customer_email, created_at desc)
 * make these queries cheap regardless of table size.
 */
import { createServerClient, type TuataleSupabaseClient } from '@/lib/supabase';
import type { Tables, TablesInsert } from '@/types/database';
import { DatabaseError } from './errors';

type PreviewEventRow = Tables<'preview_events'>;
type PreviewEventInsert = TablesInsert<'preview_events'>;

/**
 * Append a preview event. Caller fills in the threshold-state fields
 * (ip_count_24h etc.) from prior count queries so historical reads see
 * the state at the time the event was decided, not a re-computed
 * moving-target value.
 */
export async function insertEvent(
  payload: PreviewEventInsert,
  client: TuataleSupabaseClient = createServerClient(),
): Promise<PreviewEventRow> {
  const { data, error } = await client.from('preview_events').insert(payload).select().single();
  if (error) throw new DatabaseError('preview_events.insert', error);
  return data;
}

/**
 * Count events from a given IP in the last `windowHours` hours. Used by
 * the rate-limit gate before deciding to allow a new preview request.
 */
export async function countByIpRecent(
  ipAddress: string,
  windowHours: number,
  client: TuataleSupabaseClient = createServerClient(),
): Promise<number> {
  const since = new Date(Date.now() - windowHours * 60 * 60 * 1000).toISOString();
  const { count, error } = await client
    .from('preview_events')
    .select('id', { count: 'exact', head: true })
    .eq('ip_address', ipAddress)
    .gte('created_at', since);
  if (error) throw new DatabaseError('preview_events.countByIpRecent', error);
  return count ?? 0;
}

/**
 * Count events for a given email in the last `windowHours` hours.
 */
export async function countByEmailRecent(
  email: string,
  windowHours: number,
  client: TuataleSupabaseClient = createServerClient(),
): Promise<number> {
  const since = new Date(Date.now() - windowHours * 60 * 60 * 1000).toISOString();
  const { count, error } = await client
    .from('preview_events')
    .select('id', { count: 'exact', head: true })
    .eq('customer_email', email)
    .gte('created_at', since);
  if (error) throw new DatabaseError('preview_events.countByEmailRecent', error);
  return count ?? 0;
}

/**
 * Lifetime event count for a given email — no time window. Used to spot
 * customers who hit the lifetime cap across separate sessions / cookies.
 */
export async function countByEmailLifetime(
  email: string,
  client: TuataleSupabaseClient = createServerClient(),
): Promise<number> {
  const { count, error } = await client
    .from('preview_events')
    .select('id', { count: 'exact', head: true })
    .eq('customer_email', email);
  if (error) throw new DatabaseError('preview_events.countByEmailLifetime', error);
  return count ?? 0;
}

/**
 * Fetch flagged events for the admin review queue. Sorted newest-first
 * with an optional limit.
 */
export async function getFlaggedEvents(
  limit = 50,
  client: TuataleSupabaseClient = createServerClient(),
): Promise<PreviewEventRow[]> {
  const { data, error } = await client
    .from('preview_events')
    .select('*')
    .eq('flagged', true)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new DatabaseError('preview_events.getFlagged', error);
  return data ?? [];
}
