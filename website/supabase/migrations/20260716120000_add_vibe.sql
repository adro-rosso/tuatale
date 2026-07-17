-- Pet-book "vibe" — the story's emotional register (happy / adventure / tribute /
-- memorial). Pet books only; NULL for child books (no vibe directive is injected).
--
-- Nullable, NO default: old rows aren't frozen to a vibe (same rationale as
-- reading_level). No DB CHECK — validated app-side by the PET_VIBES Zod enum
-- (website/lib/validation/schemas.ts) and the worker's buildVibeRulesBlock, which
-- defaults an unknown/absent value to 'happy'.
--
-- NOTE: the migration histories are drifted, so this file is applied by the guarded
-- idempotent script scripts/_apply-vibe-mig.mjs (test then prod), not `supabase db push`.

alter table public.drafts add column if not exists vibe text;
alter table public.orders add column if not exists vibe text;

comment on column public.drafts.vibe is 'Pet-book story vibe (happy/adventure/tribute/memorial); NULL for child books.';
comment on column public.orders.vibe is 'Pet-book story vibe (happy/adventure/tribute/memorial); NULL for child books.';
