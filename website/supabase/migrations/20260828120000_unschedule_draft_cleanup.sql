-- Migration: UNSCHEDULE the legacy `delete_expired_drafts` pg_cron job.
--
-- WHY: that job (20260603120300_schedule_draft_cleanup.sql) deleted expired draft ROWS
-- only. Postgres can't delete a Storage OBJECT (removing a storage.objects row leaves the
-- bytes in S3), so every run ORPHANED the customer's photos — and severed the draft->photo
-- link that on-request erasure needs. The `GET /api/internal/reap` route (Vercel Cron)
-- replaced it: it erases the ROW *and* the Storage bytes, with reference-counting.
--
-- Production already has 0 pg_cron jobs (the job was removed there when the reap route
-- shipped — confirmed in reap-review-artifacts.ts). This migration makes a FRESH or TEST
-- database converge to that same state instead of re-scheduling the orphaning job when the
-- migration history is replayed.
--
-- Idempotent: unschedules only if the job exists. Safe to run anywhere (a no-op on prod).
-- Apply via the guarded migration protocol (idempotent, test-DB then prod) — NOT `db push`
-- (the migration history has drifted; see project notes).

do $$
begin
  if exists (select 1 from cron.job where jobname = 'delete_expired_drafts') then
    perform cron.unschedule('delete_expired_drafts');
  end if;
end $$;
