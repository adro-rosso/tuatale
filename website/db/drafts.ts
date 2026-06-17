/**
 * Drafts query helpers.
 *
 * Each function takes an optional `client` parameter — defaults to the
 * production server client, but tests pass a test-project client. This
 * dependency-injection pattern keeps the helpers production-clean while
 * being trivially testable against a separate Supabase project.
 *
 * All errors are wrapped in DatabaseError so callers handle a single
 * typed exception instead of Supabase's response shape.
 */
import { createServerClient, type TuataleSupabaseClient } from '@/lib/supabase';
import type { Tables, TablesInsert, TablesUpdate } from '@/types/database';
import { DatabaseError } from './errors';

// Convenience aliases for the official generated Tables<>/Inserts<>/Updates<>
// helpers — these stay local to the module so swapping in a regenerated
// types/database.ts only touches files that actually consume the shapes.
type DraftRow = Tables<'drafts'>;
type DraftInsert = TablesInsert<'drafts'>;
export type DraftUpdate = TablesUpdate<'drafts'>;

/**
 * Create a fresh draft for the given cookie. The draft starts in 'active'
 * status with current_step='child' and a 30-day expiry (both DB defaults).
 */
export async function createDraft(
  cookieId: string,
  client: TuataleSupabaseClient = createServerClient(),
): Promise<DraftRow> {
  const payload: DraftInsert = { cookie_id: cookieId };
  const { data, error } = await client.from('drafts').insert(payload).select().single();
  if (error) throw new DatabaseError('drafts.create', error);
  return data;
}

/**
 * Look up the most recent active draft for a browser cookie. Returns null
 * if the cookie has no active draft (already converted, expired, or never
 * existed). One cookie can have multiple drafts over time (each successful
 * conversion is a separate draft); this returns only the active one.
 */
export async function getDraftByCookieId(
  cookieId: string,
  client: TuataleSupabaseClient = createServerClient(),
): Promise<DraftRow | null> {
  const { data, error } = await client
    .from('drafts')
    .select('*')
    .eq('cookie_id', cookieId)
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new DatabaseError('drafts.getByCookieId', error);
  return data;
}

/**
 * Look up a draft by its primary key. Returns null if not found.
 */
export async function getDraftById(
  id: string,
  client: TuataleSupabaseClient = createServerClient(),
): Promise<DraftRow | null> {
  const { data, error } = await client.from('drafts').select('*').eq('id', id).maybeSingle();
  if (error) throw new DatabaseError('drafts.getById', error);
  return data;
}

/**
 * Patch a draft by its primary key. updated_at refreshes automatically
 * via DB trigger; do not include it in the updates payload.
 *
 * If you're inside a Server Action that only has the cookie value (not
 * the draft.id), use `updateDraftByCookieId` instead — it does the
 * cookie → draft.id lookup for you.
 */
export async function updateDraft(
  id: string,
  updates: DraftUpdate,
  client: TuataleSupabaseClient = createServerClient(),
): Promise<DraftRow> {
  const { data, error } = await client
    .from('drafts')
    .update(updates)
    .eq('id', id)
    .select()
    .single();
  if (error) throw new DatabaseError('drafts.update', error);
  return data;
}

/**
 * Look up the active draft for a cookie + patch it in one call. The
 * canonical pattern for Server Actions that receive just the cookie
 * value: avoids each action duplicating the
 * `getDraftByCookieId → updateDraft(draft.id, …)` two-step.
 *
 * Throws DatabaseError with operation `drafts.updateByCookieId` when
 * the cookie has no active draft (treated as a programmer error — the
 * Proxy should have ensured a draft exists; if it didn't, redirect to
 * /start/reset before calling this).
 */
export async function updateDraftByCookieId(
  cookieId: string,
  updates: DraftUpdate,
  client: TuataleSupabaseClient = createServerClient(),
): Promise<DraftRow> {
  const draft = await getDraftByCookieId(cookieId, client);
  if (!draft) {
    throw new DatabaseError('drafts.updateByCookieId', {
      message: `No active draft for cookie_id ${cookieId.slice(0, 8)}…`,
    });
  }
  return updateDraft(draft.id, updates, client);
}

/**
 * Mark a draft as converted to an order. Sets status='converted' and
 * records the order id for forensic linkage. Called from the Stripe
 * webhook handler after orders.create succeeds.
 */
export async function markDraftConverted(
  id: string,
  orderId: string,
  client: TuataleSupabaseClient = createServerClient(),
): Promise<void> {
  const { error } = await client
    .from('drafts')
    .update({ status: 'converted', converted_to_order_id: orderId })
    .eq('id', id);
  if (error) throw new DatabaseError('drafts.markConverted', error);
}

/**
 * Delete every draft past its expires_at — EXCEPT converted ones, which
 * are kept as a forensic trail back to the order. Called by the pg_cron
 * job (see the cleanup migration); also safe to invoke manually for
 * one-off cleanups. Returns the count of rows removed.
 */
export async function deleteExpiredDrafts(
  client: TuataleSupabaseClient = createServerClient(),
): Promise<number> {
  const { count, error } = await client
    .from('drafts')
    .delete({ count: 'exact' })
    .lt('expires_at', new Date().toISOString())
    .neq('status', 'converted');
  if (error) throw new DatabaseError('drafts.deleteExpired', error);
  return count ?? 0;
}
