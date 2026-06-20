-- Migration: create the waitlist table.
--
-- Pre-launch "be the first to know" email capture from the landing page.
-- One row per signup; the email is unique so a repeat signup is idempotent
-- (the server action upserts on conflict and reports success either way).
--
-- No PII beyond the email + an optional source tag. Retention is indefinite
-- (this is the launch-announcement list) — distinct from drafts, which are
-- cleaned up on a cron.
--
-- Security: service-role-only (same posture as drafts/orders/preview_events).
-- RLS is enabled with NO policies, so the anon key cannot read or write it;
-- only the server action (service role) touches it.

create table public.waitlist (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),

  -- Lower-cased, trimmed in the server action before insert so the unique
  -- constraint catches case/whitespace variants of the same address.
  email text not null unique,

  -- Where the signup came from (e.g. 'landing_hero'). Free-form; lets us
  -- tell launch-list signups apart from any future capture points.
  source text
);

create index waitlist_created_at_idx on public.waitlist (created_at desc);

alter table public.waitlist enable row level security;

comment on table public.waitlist is
  'Pre-launch email capture (landing page "be the first to know"). '
  'Service-role-only; email is unique so signups are idempotent.';
