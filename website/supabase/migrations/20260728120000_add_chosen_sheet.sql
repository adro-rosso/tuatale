-- Character-picker Slice 2 (2026-07-28) — additive, idempotent.
--   preview_jobs: batch_id + variant_index — group the N options of a picker batch.
--   drafts/orders: chosen_sheet jsonb      — the customer's locked pick (Slice 4 reads it).
--
-- Applied via scripts/_apply-chosen-sheet-mig.mjs (guarded, ref+identity check), NOT
-- `supabase db push` — both histories are drifted (see the migration-drift memory). This
-- file is the tracked RECORD; the script is the safe applier. Already applied to
-- tuatale-test; prod rides the coordinated Slice-4 deploy.
alter table public.preview_jobs add column if not exists batch_id uuid;
alter table public.preview_jobs add column if not exists variant_index int;
alter table public.drafts add column if not exists chosen_sheet jsonb;
alter table public.orders add column if not exists chosen_sheet jsonb;

-- Partial index so the batch-aware cap/rate-limit count (one row per batch, variant_index=0,
-- per draft) stays fast.
create index if not exists preview_jobs_batch_first_idx
  on public.preview_jobs (draft_id, created_at) where variant_index = 0;
