-- Add book_type + animal_kind for the pet-as-hero branch (2026-07-09).
--   book_type   : 'child' (default — the existing child-hero product) | 'pet' (pet-as-hero).
--   animal_kind : pet species/breed as free text (e.g. "dog"); NULL for child books.
-- Additive + idempotent; existing child books are unaffected (default 'child').
-- Validation of the enum lives at the app layer (Zod), mirroring art_style (plain text col).

alter table public.drafts add column if not exists book_type text not null default 'child';
alter table public.drafts add column if not exists animal_kind text;

alter table public.orders add column if not exists book_type text not null default 'child';
alter table public.orders add column if not exists animal_kind text;

-- A pet protagonist has no gender. Relax child_gender to nullable (existing child
-- orders already carry a gender; child books still require it at the app layer).
alter table public.orders alter column child_gender drop not null;
