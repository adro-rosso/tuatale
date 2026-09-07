/**
 * Orders query helpers.
 *
 * Orders are permanent (no delete helper here — orders are retained
 * forever for legal + business needs). The Stripe webhook is the only
 * caller of createOrder; the pipeline integration in Phase 4 will use
 * updateOrderPipelineStatus.
 */
import { createServerClient, type TuataleSupabaseClient } from '@/lib/supabase';
import type { Tables, TablesInsert, TablesUpdate } from '@/types/database';
import { DatabaseError } from './errors';

type OrderRow = Tables<'orders'>;
type OrderInsert = TablesInsert<'orders'>;
type OrderUpdate = TablesUpdate<'orders'>;

/**
 * Create a fresh order from the payment + draft data captured at
 * checkout. Called by the Stripe webhook handler after payment success.
 * stripe_session_id is unique; collisions throw DatabaseError (which the
 * webhook handler should treat as idempotency rather than re-erroring,
 * since Stripe will retry the webhook).
 */
export async function createOrder(
  payload: OrderInsert,
  client: TuataleSupabaseClient = createServerClient(),
): Promise<OrderRow> {
  const { data, error } = await client.from('orders').insert(payload).select().single();
  if (error) throw new DatabaseError('orders.create', error);
  return data;
}

export async function getOrderById(
  id: string,
  client: TuataleSupabaseClient = createServerClient(),
): Promise<OrderRow | null> {
  const { data, error } = await client.from('orders').select('*').eq('id', id).maybeSingle();
  if (error) throw new DatabaseError('orders.getById', error);
  return data;
}

/**
 * Look up orders by customer email. Sorted newest-first. Used by the
 * status / order-history pages.
 */
export async function getOrdersByEmail(
  email: string,
  client: TuataleSupabaseClient = createServerClient(),
): Promise<OrderRow[]> {
  const { data, error } = await client
    .from('orders')
    .select('*')
    .eq('customer_email', email)
    .order('created_at', { ascending: false });
  if (error) throw new DatabaseError('orders.getByEmail', error);
  return data ?? [];
}

/**
 * Look up an order by its Stripe Checkout Session id. Used by the
 * webhook handler for idempotency checks and by the success page to
 * surface the order to the customer after redirect.
 */
export async function getOrderByStripeSessionId(
  stripeSessionId: string,
  client: TuataleSupabaseClient = createServerClient(),
): Promise<OrderRow | null> {
  const { data, error } = await client
    .from('orders')
    .select('*')
    .eq('stripe_session_id', stripeSessionId)
    .maybeSingle();
  if (error) throw new DatabaseError('orders.getByStripeSessionId', error);
  return data;
}

/**
 * One entry in orders.email_change_log — an append-only audit of customer_email changes.
 * `source` distinguishes channels (self-serve success page vs. a future admin edit).
 */
export interface EmailChangeLogEntry {
  from: string;
  to: string;
  at: string; // ISO timestamp
  source: string;
}

/**
 * Apply a self-serve email correction: set customer_email AND replace email_change_log with the
 * caller-computed (existing + new entry) array, in one write. The caller already fetched the
 * order (ownership + shipped gate + current log), so it owns the append. email_change_log lags
 * the generated types (project_migration-history-drift) → cast the write.
 */
export async function applyEmailCorrection(
  id: string,
  newEmail: string,
  log: EmailChangeLogEntry[],
  client: TuataleSupabaseClient = createServerClient(),
): Promise<void> {
  const { error } = await client
    .from('orders')
    .update({ customer_email: newEmail, email_change_log: log } as never)
    .eq('id', id);
  if (error) throw new DatabaseError('orders.applyEmailCorrection', error);
}

/**
 * Patch the pipeline-related fields on an order (status, timing, error
 * payload, output URLs). Called from the pipeline integration layer in
 * Phase 4. Order's customer / child / payment fields are never patched
 * via this helper — those are immutable post-creation.
 */
export async function updateOrderPipelineStatus(
  id: string,
  updates: Pick<
    OrderUpdate,
    | 'pipeline_status'
    | 'pipeline_started_at'
    | 'pipeline_completed_at'
    | 'pipeline_error'
    | 'story_dir'
    | 'book_pdf_url'
  >,
  client: TuataleSupabaseClient = createServerClient(),
): Promise<OrderRow> {
  const { data, error } = await client
    .from('orders')
    .update(updates)
    .eq('id', id)
    .select()
    .single();
  if (error) throw new DatabaseError('orders.updatePipelineStatus', error);
  return data;
}
