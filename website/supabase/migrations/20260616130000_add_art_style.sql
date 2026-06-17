-- Migration: chosen art style on drafts + orders (W-C).
--
-- Adds a single nullable text column carrying the parent's chosen illustration
-- style (one of the 6 committed: watercolour, coloured_pencil, painterly,
-- ink_wash, flat_modern, cutpaper — the contract lives in src/art-styles.js).
-- Mirrored across drafts + orders so the payment-commit snapshot preserves it
-- (same pattern as child_features).
--
-- DEFAULT 'watercolour' so existing rows + any order created before the wizard
-- picker (W-F) render the validated default — ZERO behaviour change until a
-- non-default style is actually chosen. No DB CHECK on the value: validation
-- lives in the app layer (Zod on the way in; the worker adapter's
-- validateArtStyle is the hard boundary before the pipeline), mirroring how
-- child_features is validated.

alter table public.drafts
  add column if not exists art_style text not null default 'watercolour';

alter table public.orders
  add column if not exists art_style text not null default 'watercolour';

comment on column public.drafts.art_style is
  'Chosen illustration style (contract: src/art-styles.js STYLE_VALUES). '
  'Defaults to watercolour; validated app-side (adapter validateArtStyle).';
comment on column public.orders.art_style is
  'Chosen illustration style, snapshotted from the draft at order creation. '
  'The worker adapter maps it to the pipeline input.style.';
