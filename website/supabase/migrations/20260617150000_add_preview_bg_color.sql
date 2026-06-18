-- Migration: bg_color on preview_jobs.
--
-- The worker samples the generated preview image's background colour (median of
-- the 4 corners) and stores it here, so the website can set the preview box's
-- background to match — the character then melts into its box with no seam against
-- the page cream. NULL → the client keeps the default box colour. Additive + safe.

alter table public.preview_jobs add column if not exists bg_color text;

comment on column public.preview_jobs.bg_color is
  'Sampled background colour ("#rrggbb") of the generated preview image, for '
  'seamless box-background matching on the website. NULL → client default.';
