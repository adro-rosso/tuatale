-- Migration: child background / heritage on drafts + orders.
--
-- Optional free-text, the parent's OWN words for the child's background or
-- heritage (e.g. "Nigerian", "mixed Korean and Irish", "Aboriginal Australian").
-- Threaded into composeAppearance (background-led clause) so the gen renders the
-- heritage faithfully; the system-prompt HERITAGE frame governs dignity / no
-- caricature. NULL/blank → no background clause. Mirrored across drafts + orders
-- so the payment-commit snapshot preserves it. Additive + safe for existing rows.
-- The ~120-char cap is enforced in Zod, not the DB.

alter table public.drafts add column if not exists background text;
alter table public.orders add column if not exists background text;

comment on column public.drafts.background is
  'Optional parent-stated child background/heritage, free text in the parent''s '
  'own words. Threaded into composeAppearance; ~120-char cap enforced in Zod.';
comment on column public.orders.background is
  'Snapshot of drafts.background at payment commit.';
