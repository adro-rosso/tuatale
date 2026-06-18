/**
 * preview_jobs data access (S-C). Cache lookup + row create/read + per-draft count.
 *
 * preview_jobs isn't in the generated Database type yet (migration written, applied
 * at deploy), so we access it through a deliberately-narrowed cast. A `client` is
 * injectable for unit tests (mirrors the worker's setClientForTesting pattern).
 */
import { createServerClient } from '@/lib/supabase';
import type { PreviewJobRow } from './types';

// Minimal shape of the Supabase query-builder we use — lets us cast off the
// generated Database type (which lacks preview_jobs) without an `any` blast radius.
type PreviewTable = {
  from(table: 'preview_jobs'): {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped table (migration applied at deploy); chainable PostgREST builder
    select: (cols?: string, opts?: { count?: 'exact'; head?: boolean }) => any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped table; chainable PostgREST builder
    insert: (row: Record<string, unknown>) => any;
  };
};

function previewTable(client?: unknown) {
  const c = (client ?? createServerClient()) as unknown as PreviewTable;
  return c.from('preview_jobs');
}

/** Newest `done` row for these exact inputs — the cache hit. */
export async function findCachedPreview(inputHash: string, client?: unknown): Promise<PreviewJobRow | null> {
  const { data } = await previewTable(client)
    .select('*')
    .eq('input_hash', inputHash)
    .eq('status', 'done')
    .not('image_url', 'is', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as PreviewJobRow | null) ?? null;
}

export async function createPreviewJob(
  args: { draftId?: string | null; inputHash: string; inputs: unknown },
  client?: unknown,
): Promise<PreviewJobRow> {
  const { data, error } = await previewTable(client)
    .insert({ draft_id: args.draftId ?? null, input_hash: args.inputHash, inputs: args.inputs, status: 'queued' })
    .select('*')
    .single();
  if (error) throw new Error(`createPreviewJob failed: ${error.message}`);
  return data as PreviewJobRow;
}

export async function getPreviewJob(id: string, client?: unknown): Promise<PreviewJobRow | null> {
  const { data } = await previewTable(client).select('*').eq('id', id).maybeSingle();
  return (data as PreviewJobRow | null) ?? null;
}

/** Per-draft preview count — the free-cap ledger (S-E free-preview cap). */
export async function countPreviewsForDraft(draftId: string, client?: unknown): Promise<number> {
  const { count } = await previewTable(client)
    .select('*', { count: 'exact', head: true })
    .eq('draft_id', draftId);
  return count ?? 0;
}

/**
 * Per-draft preview count since `sinceIso` — the S-E rate-limit window. Reuses
 * the preview_jobs rows' created_at (every new-gen miss writes a row), so no new
 * infra. Used for the burst (≥1 in 5s) + hourly (≥N in 1h) ceilings.
 */
export async function countPreviewsForDraftSince(
  draftId: string,
  sinceIso: string,
  client?: unknown,
): Promise<number> {
  const { count } = await previewTable(client)
    .select('*', { count: 'exact', head: true })
    .eq('draft_id', draftId)
    .gte('created_at', sinceIso);
  return count ?? 0;
}
