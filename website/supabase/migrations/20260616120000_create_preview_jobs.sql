-- Migration: preview_jobs queue table + tuatale-previews Storage bucket.
--
-- One row per whole-character PREVIEW generation request (S-C). The website's
-- requestPreview server action creates a row + sends a `preview/requested`
-- Inngest event; the Fly worker's runPreview function mints ONE character image,
-- uploads it to the tuatale-previews bucket, and marks the row done/failed. The
-- website polls the row for the result.
--
-- Lifecycle:
--   queued   → row created, event sent, waiting for the worker
--   running  → worker minting
--   done     → image_url populated
--   failed   → error_message populated (timeout / API incident)
--
-- COST CONTROL (the table is the funnel-COGS ledger):
--   - input_hash: sha256 of the normalized inputs. Same inputs → cache HIT,
--     no regen, no spend (requestPreview looks up a prior `done` row by hash).
--   - draft_id: lets us count previews per draft for the bounded-free-count cap
--     (enforcement lands in S-E; the column + index are here now).
--
-- Security: service-role-only (mirrors pipeline_jobs). RLS enabled; the worker
-- (service role) writes, the website server actions (service role) read/insert.

create table public.preview_jobs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Draft this preview belongs to (for the per-draft free-count cap). Nullable +
  -- ON DELETE SET NULL: previews outlive a cleaned-up draft as cache/audit rows.
  draft_id uuid references public.drafts (id) on delete set null,

  -- sha256 of the normalized inputs (features + free text + age + gender + photo
  -- hash + style version). The cache key — identical inputs reuse the image.
  input_hash text not null,

  status text not null default 'queued'
    check (status in ('queued', 'running', 'done', 'failed')),

  -- The inputs (for audit / re-dispatch). Photo is NOT stored here — only its
  -- storage path (the bytes live in the bucket).
  inputs jsonb,

  -- Result: a (signed or public) URL to the minted character image in the bucket.
  image_url text,

  -- Failure one-liner for the UI ("that one got stuck — try again").
  error_message text,

  started_at timestamptz,
  completed_at timestamptz,

  constraint preview_jobs_completed_after_started check (
    completed_at is null or started_at is null or completed_at >= started_at
  )
);

-- Cache lookup: newest `done` row for a given input_hash.
create index preview_jobs_input_hash_idx
  on public.preview_jobs (input_hash, status, created_at desc);

-- Per-draft count (free-preview cap) + draft cleanup.
create index preview_jobs_draft_id_idx
  on public.preview_jobs (draft_id)
  where draft_id is not null;

create trigger preview_jobs_set_updated_at
  before update on public.preview_jobs
  for each row execute function public.set_updated_at();

alter table public.preview_jobs enable row level security;

comment on table public.preview_jobs is
  'Whole-character preview generation queue (S-C). queued → running → done/failed. '
  'input_hash = cache key (same inputs reuse the image); draft_id = per-draft '
  'free-count ledger. Service-role-only.';

-- ---- tuatale-previews Storage bucket --------------------------------------
-- The worker uploads each minted preview PNG here. public = false; the website
-- hands the customer a signed URL (same model as tuatale-books).
insert into storage.buckets (id, name, public)
values ('tuatale-previews', 'tuatale-previews', false)
on conflict (id) do nothing;

drop policy if exists "service_role_insert_previews" on storage.objects;
create policy "service_role_insert_previews"
  on storage.objects for insert to service_role
  with check (bucket_id = 'tuatale-previews');

drop policy if exists "service_role_select_previews" on storage.objects;
create policy "service_role_select_previews"
  on storage.objects for select to service_role
  using (bucket_id = 'tuatale-previews');

drop policy if exists "service_role_update_previews" on storage.objects;
create policy "service_role_update_previews"
  on storage.objects for update to service_role
  using (bucket_id = 'tuatale-previews');

drop policy if exists "service_role_delete_previews" on storage.objects;
create policy "service_role_delete_previews"
  on storage.objects for delete to service_role
  using (bucket_id = 'tuatale-previews');
