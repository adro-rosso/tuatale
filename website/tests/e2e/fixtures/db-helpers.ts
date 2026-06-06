/**
 * Direct DB access for Playwright e2e fixtures.
 *
 * These bypass the production code's `createServerClient` so e2e
 * tests can seed + truncate + assert against tuatale-test
 * regardless of what the dev server's NEXT_PUBLIC_SUPABASE_URL
 * happens to point at. The dev server is overridden via
 * playwright.config.ts:webServer.env to also use tuatale-test,
 * but this module is the test-process equivalent.
 *
 * Live in tests/e2e/fixtures/ — never imported from production code.
 *
 * Requires TEST_SUPABASE_URL + TEST_SUPABASE_SERVICE_ROLE_KEY in
 * the test process env. Reuses the existing tests/db/helpers.ts
 * primitives so we have one source of truth for the test client +
 * truncation order.
 */
import { createTestClient, truncateAll } from '../../db/helpers';
import type { Tables } from '@/types/database';

export type DraftRow = Tables<'drafts'>;
export type OrderRow = Tables<'orders'>;
export type PipelineJobRow = Tables<'pipeline_jobs'>;

const client = () => createTestClient();

export async function resetTestDb(): Promise<void> {
  await truncateAll(client());
}

export async function getDraftByIdFromDb(id: string): Promise<DraftRow | null> {
  const { data, error } = await client().from('drafts').select('*').eq('id', id).maybeSingle();
  if (error) throw new Error(`db-helpers.getDraftById: ${error.message}`);
  return data;
}

export async function getOrderByIdFromDb(id: string): Promise<OrderRow | null> {
  const { data, error } = await client().from('orders').select('*').eq('id', id).maybeSingle();
  if (error) throw new Error(`db-helpers.getOrderById: ${error.message}`);
  return data;
}

export async function getOrderByStripeSessionIdFromDb(sessionId: string): Promise<OrderRow | null> {
  const { data, error } = await client()
    .from('orders')
    .select('*')
    .eq('stripe_session_id', sessionId)
    .maybeSingle();
  if (error) throw new Error(`db-helpers.getOrderByStripeSessionId: ${error.message}`);
  return data;
}

export async function getJobByIdFromDb(id: string): Promise<PipelineJobRow | null> {
  const { data, error } = await client()
    .from('pipeline_jobs')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(`db-helpers.getJobById: ${error.message}`);
  return data;
}

export async function getJobByOrderIdFromDb(orderId: string): Promise<PipelineJobRow | null> {
  const { data, error } = await client()
    .from('pipeline_jobs')
    .select('*')
    .eq('order_id', orderId)
    .maybeSingle();
  if (error) throw new Error(`db-helpers.getJobByOrderId: ${error.message}`);
  return data;
}

/**
 * Patch pipeline_jobs.pdf_url to a non-stub value so the
 * shipJobAction's stub-skip guard doesn't short-circuit. Used in
 * the full-funnel test right before the Ship click to exercise the
 * real email-send code path.
 */
export async function updateJobPdfUrlInDb(id: string, pdfUrl: string): Promise<void> {
  const { error } = await client().from('pipeline_jobs').update({ pdf_url: pdfUrl }).eq('id', id);
  if (error) throw new Error(`db-helpers.updateJobPdfUrl: ${error.message}`);
}
