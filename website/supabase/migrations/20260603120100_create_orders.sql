-- Migration: create the orders table.
--
-- Orders are permanent post-payment records. Created when Stripe webhook
-- confirms payment success; immutable in terms of customer/child fields
-- thereafter. Pipeline integration (Phase 4) mutates pipeline_status +
-- output URLs as the book is generated.
--
-- Security: service-role-only (same pattern as drafts). All order reads
-- and the Stripe-webhook-driven inserts go through API routes.

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  customer_email text not null,

  -- Snapshot of the draft at payment commit. Permanent — these don't
  -- mutate after creation even if the original draft is later edited
  -- (which shouldn't happen post-conversion, but defence in depth).
  child_name text not null,
  child_age integer not null
    check (child_age between 1 and 12),
  child_gender text not null
    check (child_gender in ('boy','girl','non_binary')),
  child_appearance text not null,
  secondaries jsonb not null default '[]'::jsonb,
  theme text not null,
  theme_template_id text,
  age_range text not null
    check (age_range in ('3-5','5-7','7-9')),

  -- Payment metadata from Stripe.
  stripe_session_id text not null unique,
  stripe_payment_intent_id text,
  amount_paid_cents integer not null
    check (amount_paid_cents > 0),
  currency text not null default 'aud'
    check (currency in ('aud','usd')),
  paid_at timestamptz not null,

  -- Pipeline integration — Phase 4 hooks live here.
  pipeline_status text not null default 'queued'
    check (pipeline_status in (
      'queued','generating','rendering','complete','failed'
    )),
  pipeline_started_at timestamptz,
  pipeline_completed_at timestamptz,
  -- Structured error payload (mirrors DaBookTing pipeline's ShapeValidationError
  -- / MaxTokensError / WallCeilingError toJSON() shapes).
  pipeline_error jsonb,

  -- Output references — Supabase Storage URLs after generation completes.
  story_dir text,
  book_pdf_url text,

  -- Origin reference (no FK so drafts can be cleaned up without affecting
  -- order history).
  converted_from_draft_id uuid
);

create index orders_customer_email_idx
  on public.orders (customer_email);
-- stripe_session_id is already unique, but a btree index speeds webhook
-- lookups (which fire on the high-traffic /api/stripe/webhook path).
create index orders_stripe_session_id_idx
  on public.orders (stripe_session_id);
create index orders_pipeline_status_idx
  on public.orders (pipeline_status);
create index orders_created_at_desc_idx
  on public.orders (created_at desc);

create trigger orders_set_updated_at
  before update on public.orders
  for each row execute function public.set_updated_at();

alter table public.orders enable row level security;

comment on table public.orders is
  'Permanent post-payment records. Retained forever for legal + business '
  'needs. Service-role-only access; RLS deferred to Phase 4+.';
