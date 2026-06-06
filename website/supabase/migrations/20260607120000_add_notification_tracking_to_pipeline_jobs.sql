-- Migration: track ship-notification email outcome on pipeline_jobs.
--
-- Cycle A.5 wires the shipJobAction to send a customer-facing email
-- via Resend after markShipped succeeds. The three columns added
-- here record the outcome so admin can answer "did the customer get
-- the email?" without grepping Sentry:
--
--   notification_sent_at      timestamptz    success time
--   notification_message_id   text           Resend's message id
--   notification_error        text           best-effort error string
--
-- All three are nullable + default null. Mutually-exclusive in
-- practice (a success run sets sent_at + message_id with error=null;
-- a failure sets error with the other two null), but we don't
-- enforce that with a CHECK because a future "retry" workflow may
-- want to record both the prior failure AND a fresh send.
--
-- Email send happens AFTER markShipped, and is best-effort: if the
-- email fails, the job stays at status='shipped' but
-- notification_error is set. The admin UI surfaces this; Cycle A.6+
-- may add an explicit Resend button.

alter table public.pipeline_jobs
  add column notification_sent_at timestamptz,
  add column notification_message_id text,
  add column notification_error text;

comment on column public.pipeline_jobs.notification_sent_at is
  'Wall-clock time the customer ship-notification email was sent. '
  'Null when the send is pending, failed, or skipped (e.g. stub PDF).';

comment on column public.pipeline_jobs.notification_message_id is
  'Resend message id for the ship-notification email. Useful for '
  'cross-referencing with the Resend dashboard when debugging.';

comment on column public.pipeline_jobs.notification_error is
  'Diagnostic string from the failed email send. Null on success or '
  'when no send has been attempted. Sentry has the full payload; '
  'this column is for at-a-glance admin queries.';
