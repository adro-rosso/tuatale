-- Migration: reading level (prose difficulty) on drafts + orders.
--
-- Optional enum-ish text: 'simplest' | 'standard' | 'advanced'. Controls PROSE
-- only (sentence length, vocabulary, complexity, repetition). The child's AGE
-- still drives the character VISUAL. NULL is meaningful: the worker adapter
-- passes undefined and generateStory's resolveReadingLevel defaults from the age
-- BAND (3-5->simplest, 5-7->standard, 7-9->advanced). So this is fully
-- backward-compatible for every existing row, AND a parent who never touches the
-- control stores NULL and keeps tracking their child's age band.
--
-- Nullable, NO default (mirrors `background`, not `art_style`): a default would
-- freeze old 3-5 rows to that level instead of band-deriving. No DB CHECK:
-- validated app-side (readingLevelSchema on the way in; the worker's
-- resolveReadingLevel is the hard boundary - unknown values fall back to the
-- band). Mirrored across drafts + orders so the payment-commit snapshot keeps it.

alter table public.drafts add column if not exists reading_level text;
alter table public.orders add column if not exists reading_level text;

comment on column public.drafts.reading_level is
  'Chosen reading level (simplest|standard|advanced); NULL = derive from age band. '
  'Validated app-side (readingLevelSchema; worker resolveReadingLevel is the boundary).';
comment on column public.orders.reading_level is
  'Snapshot of drafts.reading_level at payment commit; NULL = derive from age band.';
