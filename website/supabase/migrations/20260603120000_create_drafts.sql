-- Migration: create the drafts table + shared updated_at trigger function.
--
-- Drafts hold ephemeral form-in-progress state, identified by an anonymous
-- cookie (no Supabase Auth at launch — guest checkout). They expire 30
-- days after creation; deletion is handled by pg_cron in a later migration.
--
-- Security: service-role-only access for v1 (RLS enabled, no policies →
-- blocks anon + authenticated; service_role bypasses RLS by built-in
-- Supabase behaviour). All draft reads/writes go through API routes that
-- verify cookie_id against the request before any DB call. Phase 4+ will
-- add RLS policies for direct browser access once customer auth lands.

-- Shared updated_at trigger function. Defined here because drafts is the
-- first table to need it; orders + future tables reuse the same function.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table public.drafts (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '30 days'),

  -- Customer identification — anonymous via cookie until payment.
  -- customer_email captured at the preview step (Decision 7).
  cookie_id uuid not null,
  customer_email text,

  -- Form data — all nullable because the customer fills progressively.
  child_name text,
  child_age integer
    check (child_age is null or (child_age between 1 and 12)),
  child_gender text
    check (child_gender is null or child_gender in ('boy','girl','non_binary')),
  child_appearance text,

  -- Secondaries shape validated at the API layer, not the DB. Elements:
  --   { name, subject_type ('human'|'non_human'), gender?,
  --     anchor ('tier1'|'tier2'), appearance_markers, relationship }
  secondaries jsonb not null default '[]'::jsonb,

  theme text,
  theme_template_id text,
  age_range text
    check (age_range is null or age_range in ('3-5','5-7','7-9')),

  -- Multi-step form progress marker. Lets the UI resume mid-flow.
  current_step text not null default 'child'
    check (current_step in (
      'child','secondaries','theme','preview','review','payment'
    )),

  estimated_price_cents integer
    check (estimated_price_cents is null or estimated_price_cents > 0),

  status text not null default 'active'
    check (status in ('active','abandoned','converted','expired')),

  -- Loose link to orders (no FK constraint so draft cleanup can run
  -- independently of order retention).
  converted_to_order_id uuid
);

-- Indexes for common lookup patterns. Partial indexes on optional columns
-- keep the index small without sacrificing query speed.
create index drafts_cookie_id_idx
  on public.drafts (cookie_id);
create index drafts_customer_email_idx
  on public.drafts (customer_email)
  where customer_email is not null;
create index drafts_expires_at_idx
  on public.drafts (expires_at)
  where status = 'active';
create index drafts_status_idx
  on public.drafts (status);

-- Auto-bump updated_at on every UPDATE.
create trigger drafts_set_updated_at
  before update on public.drafts
  for each row execute function public.set_updated_at();

alter table public.drafts enable row level security;

comment on table public.drafts is
  'Ephemeral form-in-progress state. 30-day expiry. Anonymous cookie-based '
  'identification. Service-role-only access at v1; RLS policies for browser '
  'access deferred to Phase 4+.';
