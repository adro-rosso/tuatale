-- Migration: structured character features (Spec: structured inputs, 2026-06-11).
--
-- Adds a single nullable jsonb blob carrying the parent's preset/dropdown
-- character selections (hair colour/style, skin tone, eye colour, glasses,
-- build, outfit colours, marks). Mirrored across drafts + orders so the
-- payment-commit snapshot preserves it. Validation lives in the app layer
-- (Zod on the way in; the worker adapter's validateChildFeatures is the hard
-- boundary before the pipeline) — no DB CHECK on the jsonb shape.
--
-- Also relaxes orders.child_appearance from NOT NULL: structured-complete
-- orders may carry no free-text appearance at all. (drafts.child_appearance is
-- already nullable.) The "appearance OR structured-complete" requirement is
-- enforced in Zod + the create-order guard, not the DB.

alter table public.drafts
  add column child_features jsonb;

alter table public.orders
  add column child_features jsonb;

alter table public.orders
  alter column child_appearance drop not null;

comment on column public.drafts.child_features is
  'jsonb blob of structured character presets (hair/skin/eye/glasses/build, '
  'outfit colours, marks[]). Nullable — null = free-text-appearance path. '
  'Mirrors the contract in src/character-features.js. Snapshotted into orders.';
comment on column public.orders.child_features is
  'Snapshot of drafts.child_features at payment commit. The worker adapter '
  'validates it (validateChildFeatures) before it reaches the pipeline.';
comment on column public.orders.child_appearance is
  'Free-text appearance. Now NULLABLE: structured-complete orders may omit it. '
  'Requirement (appearance >= 50 chars OR structured-complete) is enforced in '
  'Zod + create-order, not the DB.';
