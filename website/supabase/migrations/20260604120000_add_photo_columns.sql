-- Migration: add photo-related columns to drafts + orders.
--
-- Forward-compat for the eventual photo upload path (Phase 5+). Phase 2.C
-- doesn't surface these in the UI; they're added now so the schema is
-- stable BEFORE we start writing form data into drafts. Customer-facing
-- copy in Phase 2.C says "Photo upload coming soon" — the columns just
-- sit at their defaults.
--
-- The columns mirror across drafts + orders so the snapshot at payment
-- commit (which copies draft → order) preserves the photo state. Same
-- default + CHECK constraint on both sides for symmetry.

alter table public.drafts
  add column photo_urls jsonb not null default '[]'::jsonb,
  add column photo_consent_at timestamptz,
  add column character_generation_mode text not null default 'text_only'
    check (character_generation_mode in ('text_only', 'photo_assisted'));

alter table public.orders
  add column photo_urls jsonb not null default '[]'::jsonb,
  add column photo_consent_at timestamptz,
  add column character_generation_mode text not null default 'text_only'
    check (character_generation_mode in ('text_only', 'photo_assisted'));

comment on column public.drafts.photo_urls is
  'jsonb array of Supabase Storage URLs for uploaded reference photos. '
  'Empty by default; populated in Phase 5+. Snapshotted into orders.photo_urls.';
comment on column public.drafts.photo_consent_at is
  'Timestamp when the customer confirmed the upload-and-process consent '
  'checkbox. Null until they upload at least one photo.';
comment on column public.drafts.character_generation_mode is
  'Whether the pipeline should use only the text appearance markers '
  '(`text_only`, default) or also condition on uploaded photos '
  '(`photo_assisted`). Phase 2.C always uses text_only.';
