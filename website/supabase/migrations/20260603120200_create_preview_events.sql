-- Migration: create the preview_events table.
--
-- An append-only audit log of every preview-related event (request,
-- generation, threshold block, admin action). Drives rate-limit checks
-- and abuse-investigation queries. Each preview attempt writes one row.
--
-- Retention: 90+ days. No FK to drafts so drafts can be cleaned up
-- independently; the loose draft_id reference stays for forensic tracing.
--
-- Security: service-role-only (same pattern as drafts/orders).

create table public.preview_events (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),

  -- Identification.
  ip_address inet not null,
  customer_email text,
  -- Loose reference to drafts.id; no FK so draft deletion doesn't break
  -- event history.
  draft_id uuid,

  event_type text not null
    check (event_type in (
      'preview_requested',
      'preview_generated',
      'preview_blocked_threshold',
      'admin_flagged',
      'admin_suspended',
      'admin_cleared'
    )),

  estimated_cost_cents integer
    check (estimated_cost_cents is null or estimated_cost_cents >= 0),

  -- Threshold state at the moment of the event. Denormalized so historical
  -- reads don't need to re-compute windowed counts against a moving target.
  ip_count_24h integer
    check (ip_count_24h is null or ip_count_24h >= 0),
  email_count_24h integer
    check (email_count_24h is null or email_count_24h >= 0),
  email_count_lifetime integer
    check (email_count_lifetime is null or email_count_lifetime >= 0),

  allowed boolean not null,
  flagged boolean not null default false,
  suspension_status text
    check (suspension_status is null or suspension_status in (
      'soft_watch','suspended','cleared'
    ))
);

-- Indexes for rate-limit + abuse-review lookups. Composite (ip, created_at)
-- and (email, created_at) drive 24h-window queries efficiently; partial
-- indexes keep them small.
create index preview_events_ip_address_idx
  on public.preview_events (ip_address);
create index preview_events_customer_email_idx
  on public.preview_events (customer_email)
  where customer_email is not null;
create index preview_events_created_at_idx
  on public.preview_events (created_at desc);
create index preview_events_ip_window_idx
  on public.preview_events (ip_address, created_at desc);
create index preview_events_email_window_idx
  on public.preview_events (customer_email, created_at desc)
  where customer_email is not null;
-- Admin review queue: only flagged events.
create index preview_events_flagged_idx
  on public.preview_events (flagged, created_at desc)
  where flagged = true;

-- No updated_at column / trigger — events are immutable after insert.

alter table public.preview_events enable row level security;

comment on table public.preview_events is
  'Append-only audit log. Drives rate-limit + abuse-detection logic. '
  'Indexed for IP + email 24h-window queries.';
