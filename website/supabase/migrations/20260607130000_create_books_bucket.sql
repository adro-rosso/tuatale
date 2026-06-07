-- Migration: create the tuatale-books Storage bucket + service-role RLS policies.
--
-- The Track B pipeline worker (DaBookTing/worker/) uploads each generated book
-- PDF here after rendering, then hands a 7-day signed URL back to the customer
-- via the ship-notification email.
--
-- Path convention (enforced in worker/src/storage.js):
--   tuatale-books/orders/{orderId}/book.pdf
-- One PDF per order. A retry/regenerate OVERWRITES the previous attempt's PDF
-- (storage upload uses upsert: true), so the path stays stable across attempts.
--
-- Access model (mirrors drafts/orders): SERVICE-ROLE ONLY. The worker writes
-- with the service role; the admin reviews the PDF through the website (also
-- service role); the customer never touches Storage directly — they only ever
-- receive a time-limited signed URL. No anon/authenticated policies at v1.
--
-- File retention vs URL expiry are SEPARATE decisions (Track B B.2):
--   - URL expiry: signed URLs expire after 7 days (set in code, not here).
--   - File retention: the object itself is kept INDEFINITELY (no lifecycle
--     rule below) so admin can re-sign a fresh URL on demand. Revisit when the
--     child-data legal review lands.
--
-- bucket `public = false`: objects are not world-readable; access requires the
-- service role or a signed URL.

-- ---- Bucket ---------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('tuatale-books', 'tuatale-books', false)
on conflict (id) do nothing;

-- ---- Service-role-only policies on storage.objects ------------------------
-- RLS on storage.objects is enabled by default in Supabase. service_role
-- bypasses RLS by Supabase's built-in behaviour, so these policies are
-- belt-and-suspenders: they make the intended access surface explicit and
-- survive any future tightening of the default bypass. They are scoped to the
-- tuatale-books bucket so they never touch other buckets' objects.
--
-- `drop policy if exists` keeps the migration idempotent on re-run.

drop policy if exists "service_role_insert_books" on storage.objects;
create policy "service_role_insert_books"
  on storage.objects for insert
  to service_role
  with check (bucket_id = 'tuatale-books');

drop policy if exists "service_role_select_books" on storage.objects;
create policy "service_role_select_books"
  on storage.objects for select
  to service_role
  using (bucket_id = 'tuatale-books');

drop policy if exists "service_role_update_books" on storage.objects;
create policy "service_role_update_books"
  on storage.objects for update
  to service_role
  using (bucket_id = 'tuatale-books');

drop policy if exists "service_role_delete_books" on storage.objects;
create policy "service_role_delete_books"
  on storage.objects for delete
  to service_role
  using (bucket_id = 'tuatale-books');
