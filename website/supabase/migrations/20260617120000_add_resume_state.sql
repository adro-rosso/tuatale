-- R3a/R3b: resume-state for pipeline_jobs.
--   checkpoint     — JSONB manifest of the checkpointed run (Storage prefix +
--                    sheet file list); bytes live in Supabase Storage.
--   next_retry_at  — when the resume cron may re-enqueue this job (R3b backoff).
--   status         — two new terminal-adjacent states: 'resumable' (transient
--                    failure, awaiting cron re-enqueue) and 'blocked_on_credits'
--                    (RESOURCE_EXHAUSTED — parked until a health-probe flips it back).
-- attempt_count already exists. Additive + safe for existing rows.

alter table public.pipeline_jobs add column if not exists checkpoint jsonb;
alter table public.pipeline_jobs add column if not exists next_retry_at timestamptz;

alter table public.pipeline_jobs drop constraint if exists pipeline_jobs_status_check;
alter table public.pipeline_jobs add constraint pipeline_jobs_status_check
  check (status in (
    'pending', 'running', 'awaiting_review', 'shipped', 'failed', 'cancelled',
    'resumable', 'blocked_on_credits'
  ));
