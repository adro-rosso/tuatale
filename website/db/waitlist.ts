/**
 * Waitlist query helpers.
 *
 * The waitlist is the pre-launch "be the first to know" email list. One
 * row per email; `email` is unique so a repeat signup is idempotent —
 * addSignup upserts on the email conflict and never errors on a duplicate.
 *
 * Service-role-only (RLS is on with no policies) — same posture as the
 * other tables. The landing-page server action is the only caller.
 */
import { createServerClient, type TuataleSupabaseClient } from '@/lib/supabase';
import type { Tables, TablesInsert } from '@/types/database';
import { DatabaseError } from './errors';

type WaitlistRow = Tables<'waitlist'>;
type WaitlistInsert = TablesInsert<'waitlist'>;

/**
 * Add (or re-confirm) a waitlist signup. Upserts on the unique email so a
 * repeat submission is a no-op success rather than a duplicate-key error —
 * the caller can always treat a non-throw as "you're on the list".
 *
 * The email is expected pre-normalized (trimmed + lower-cased) by the
 * caller so the unique constraint catches case/whitespace variants.
 */
export async function addSignup(
  payload: WaitlistInsert,
  client: TuataleSupabaseClient = createServerClient(),
): Promise<WaitlistRow> {
  const { data, error } = await client
    .from('waitlist')
    .upsert(payload, { onConflict: 'email', ignoreDuplicates: false })
    .select()
    .single();
  if (error) throw new DatabaseError('waitlist.addSignup', error);
  return data;
}

/**
 * Total signup count. Handy for an admin glance / launch-readiness; not
 * used on the customer path.
 */
export async function count(
  client: TuataleSupabaseClient = createServerClient(),
): Promise<number> {
  const { count: n, error } = await client
    .from('waitlist')
    .select('id', { count: 'exact', head: true });
  if (error) throw new DatabaseError('waitlist.count', error);
  return n ?? 0;
}
