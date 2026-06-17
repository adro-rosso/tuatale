-- W-F: add 'style' as the FIRST wizard step.
--
-- The whole-character previews on /start/child render in the chosen art style,
-- so the customer must pick a style before the character step. This:
--   1. extends the drafts.current_step CHECK to allow 'style', and
--   2. makes 'style' the default landing step for a brand-new draft (so the
--      /start resume route sends first-time visitors to /start/style).
--
-- Additive + safe for existing drafts: rows mid-flow keep their current_step
-- (child/secondaries/…); only NEW drafts default to 'style'.

alter table public.drafts
  drop constraint if exists drafts_current_step_check;

alter table public.drafts
  add constraint drafts_current_step_check
  check (current_step in (
    'style', 'child', 'secondaries', 'theme', 'preview', 'review', 'payment'
  ));

alter table public.drafts
  alter column current_step set default 'style';
