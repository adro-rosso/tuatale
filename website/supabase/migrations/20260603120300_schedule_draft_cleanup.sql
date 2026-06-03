-- Migration: schedule daily cleanup of expired drafts via pg_cron.
--
-- pg_cron is available on Supabase free tier (it's a Postgres extension
-- listed in the dashboard's Extensions panel). The CREATE EXTENSION here
-- enables it idempotently — running this migration on a project where
-- pg_cron is already enabled is a no-op.
--
-- Schedule: daily at 03:00 UTC. Picked because:
--   - low global traffic (US night, Europe pre-dawn, Australia mid-afternoon)
--   - far enough from the Vercel build window to avoid contention
--   - daily cadence is fine; drafts beyond 30 days aren't accumulating fast
--
-- Job behaviour: deletes drafts whose expires_at has passed EXCEPT
-- converted ones (those stay linked to orders via converted_to_order_id
-- for the forensic trail).
--
-- The do-block + jobname existence check makes the schedule call
-- idempotent — re-running this migration won't duplicate the job.

create extension if not exists pg_cron;

do $$
begin
  if not exists (
    select 1 from cron.job where jobname = 'delete_expired_drafts'
  ) then
    perform cron.schedule(
      'delete_expired_drafts',
      '0 3 * * *',
      $cmd$
        delete from public.drafts
        where expires_at < now() and status != 'converted';
      $cmd$
    );
  end if;
end $$;

-- Verify scheduling worked (visible in cron.job table for ops debugging).
-- Run `select * from cron.job;` in the SQL editor to see scheduled jobs;
-- `select * from cron.job_run_details order by start_time desc limit 10;`
-- shows recent runs (success/failure + runtime).
