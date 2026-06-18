-- Migration: custom dedication message on drafts + orders.
--
-- Optional free-text dedication shown on the book's dedication page (front
-- matter). NULL/blank → the auto-default "For {name}, with love" renders.
-- Mirrored across drafts + orders so the payment-commit snapshot preserves it
-- (same pattern as art_style / child_features). Additive + safe for existing
-- rows. The ~120-char cap is enforced in Zod + the wizard input, not the DB.

alter table public.drafts add column if not exists dedication_message text;
alter table public.orders add column if not exists dedication_message text;

comment on column public.drafts.dedication_message is
  'Optional custom book dedication (front matter). NULL/blank → auto-default '
  '"For {name}, with love". ~120-char cap enforced in Zod, not the DB.';
comment on column public.orders.dedication_message is
  'Snapshot of drafts.dedication_message at payment commit.';
