-- Migration: pipeline_jobs queue table.
--
-- One row per order, representing the work item between Stripe webhook
-- order creation (Phase 2.E) and the customer-facing book ship signal
-- (Cycle A.5). The status column tracks the job through the full
-- lifecycle:
--
--   pending          → just created, waiting for Inngest to pick up
--   running          → Inngest function executing the pipeline
--   awaiting_review  → pipeline produced a PDF; admin to approve
--   shipped          → admin approved, customer notified
--   failed           → pipeline crashed after retries exhausted
--   cancelled        → admin or system cancelled before completion
--
-- Why a separate table (vs. extending orders.pipeline_status):
--   - orders.pipeline_* fields stay as a denormalized cache of the
--     terminal state — customer-facing reads don't need to join
--   - pipeline_jobs owns retry/attempt counters, structured error
--     blobs, admin-review fields, and Inngest cross-references — none
--     of which belong on the durable order record
--   - 1:1 today via unique(order_id); if a future "regenerate"
--     workflow needs multiple jobs per order, the unique constraint
--     is the only thing that has to change
--
-- Status mapping to orders.pipeline_status (kept loose so orders can
-- stay denormalized; cycle A.3+ will sync these on terminal edges):
--   pending          ↔ orders.pipeline_status='queued'
--   running          ↔ orders.pipeline_status='generating' / 'rendering'
--   awaiting_review  ↔ orders.pipeline_status='complete' (pre-ship)
--   shipped          ↔ orders.pipeline_status='complete'
--   failed           ↔ orders.pipeline_status='failed'
--   cancelled        ↔ (no order-level equivalent today)
--
-- Security: service-role-only access for v1, same pattern as the rest.

create table public.pipeline_jobs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Order this job is generating a book for. ON DELETE RESTRICT so we
  -- never lose audit trail by deleting an order with a job attached;
  -- if you really need to remove an order, delete its job first.
  order_id uuid not null
    references public.orders (id) on delete restrict,

  -- Lifecycle status. The text-based enum mirrors the pattern used by
  -- drafts.status / orders.pipeline_status — the Supabase type
  -- generator doesn't represent CHECK constraints, but they're enforced
  -- at the DB.
  status text not null default 'pending'
    check (status in (
      'pending', 'running', 'awaiting_review', 'shipped', 'failed', 'cancelled'
    )),

  -- Inngest cross-references. Populated when the function picks up the
  -- job (markRunning) so we can correlate DB rows to Inngest dashboards
  -- when debugging. inngest_run_id changes on every retry; event_id is
  -- stable per logical job.
  inngest_event_id text,
  inngest_run_id text,

  -- Execution timestamps. Null until their corresponding transition
  -- runs (started_at on → running, completed_at on → awaiting_review or
  -- → failed, shipped_at on → shipped, failed_at on → failed). CHECK
  -- constraints are null-tolerant so the row can move through states
  -- one at a time.
  started_at timestamptz,
  completed_at timestamptz,
  shipped_at timestamptz,
  failed_at timestamptz,

  -- Retry tracking. Incremented explicitly by the Inngest function
  -- before each fresh attempt (NOT auto-incremented on every →running
  -- transition — the function decides whether a re-run is a retry or
  -- a continuation).
  attempt_count integer not null default 0
    check (attempt_count >= 0),

  -- Pipeline output references. Both populated together when the job
  -- reaches awaiting_review.
  pdf_url text,
  generation_metadata jsonb,

  -- Failure payload. error_message is a human-readable one-liner for
  -- admin dashboards; error_details is the structured blob (stack
  -- trace, pipeline-side ShapeValidationError JSON, costs at point of
  -- failure, etc.) for forensic debugging.
  error_message text,
  error_details jsonb,

  -- Admin review fields. reviewed_by is set when transitioning to
  -- shipped or cancelled by an admin; review_notes is optional context.
  reviewed_by text,
  review_notes text,

  -- Timestamp ordering: each "later" timestamp must come at or after
  -- its predecessor. Null-tolerant so a row in 'running' (started_at
  -- set, completed_at null) doesn't violate.
  constraint pipeline_jobs_completed_after_started check (
    completed_at is null or started_at is null or completed_at >= started_at
  ),
  constraint pipeline_jobs_shipped_after_completed check (
    shipped_at is null or completed_at is null or shipped_at >= completed_at
  ),
  constraint pipeline_jobs_failed_after_started check (
    failed_at is null or started_at is null or failed_at >= started_at
  )
);

-- One job per order in v1. Drop this if/when "regenerate" workflows
-- need multiple attempts as separate rows; until then this enforces
-- the 1:1 model the rest of the code assumes.
create unique index pipeline_jobs_order_id_uniq
  on public.pipeline_jobs (order_id);

-- Queue query: "give me all pending jobs in order". Sorted by
-- created_at so older jobs ship first.
create index pipeline_jobs_status_created_at_idx
  on public.pipeline_jobs (status, created_at);

-- Inngest webhook idempotency / debugging — webhook handlers look up
-- by event id.
create index pipeline_jobs_inngest_event_id_idx
  on public.pipeline_jobs (inngest_event_id)
  where inngest_event_id is not null;

create trigger pipeline_jobs_set_updated_at
  before update on public.pipeline_jobs
  for each row execute function public.set_updated_at();

alter table public.pipeline_jobs enable row level security;

comment on table public.pipeline_jobs is
  'Queue between Stripe-webhook order creation (Phase 2.E) and customer '
  'ship signal (Cycle A.5). One row per order; status lifecycle is '
  'pending → running → awaiting_review → shipped (or → failed / cancelled). '
  'Service-role-only; RLS deferred to Phase 4+.';

comment on column public.pipeline_jobs.status is
  'Lifecycle state. Enforced by CHECK constraint. See pipeline-jobs.ts '
  'for the in-app transition validator.';

comment on column public.pipeline_jobs.attempt_count is
  'Incremented explicitly by the Inngest function before each fresh '
  'attempt — NOT auto-incremented on every →running transition. The '
  'function distinguishes "first run" from "retry" from "continuation".';

comment on column public.pipeline_jobs.generation_metadata is
  'Pipeline-side stats: model versions, costs in cents per stage, '
  'timing per stage, character sheet IDs. Schema-less by design; the '
  'pipeline can record arbitrary keys without DB migrations.';

comment on column public.pipeline_jobs.error_details is
  'Structured error payload. Mirrors the DaBookTing pipeline''s '
  'ShapeValidationError / MaxTokensError / WallCeilingError toJSON() '
  'shapes plus stack trace + cost-at-point-of-failure.';
