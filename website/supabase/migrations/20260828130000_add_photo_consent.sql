-- Migration: add `photo_consent` (versioned child-photo consent record) to drafts + orders.
--
-- Shape: jsonb { version, text, at } — the version id (e.g. "child-v1"), the EXACT attested
-- text, and the timestamp. Proves precisely WHAT a parent/guardian consented to, not just
-- WHEN (the legacy `photo_consent_at` timestamp stays for back-compat). Nullable + additive,
-- so it can't fail on existing rows.
--
-- Idempotent (add column if not exists). Apply via the guarded protocol (test-DB then prod;
-- see scripts/_apply-consent-migration.mjs), NOT `db push` — the migration history has
-- drifted (project_migration-history-drift). Must land BEFORE the website code that writes
-- order.photo_consent runs against that database (create-order only references the column
-- when a child-photo consent is present, so existing orders are unaffected until then).

alter table public.drafts add column if not exists photo_consent jsonb;
alter table public.orders add column if not exists photo_consent jsonb;
