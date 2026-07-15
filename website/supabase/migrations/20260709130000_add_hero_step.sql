-- Pet-as-hero: add 'hero' as the NEW FIRST wizard step (before 'style').
--
-- The hero step asks "who's the book about — a child or a pet?" and sets
-- drafts.book_type. It must come first because it decides which protagonist step
-- the customer sees (child vs pet). This:
--   1. extends the drafts.current_step CHECK to allow 'hero', and
--   2. makes 'hero' the default landing step for a brand-new draft.
-- Additive + safe for existing drafts: rows mid-flow keep their current_step.

alter table public.drafts
  drop constraint if exists drafts_current_step_check;

alter table public.drafts
  add constraint drafts_current_step_check
  check (current_step in (
    'hero', 'style', 'child', 'secondaries', 'theme', 'preview', 'review', 'payment'
  ));

alter table public.drafts
  alter column current_step set default 'hero';
