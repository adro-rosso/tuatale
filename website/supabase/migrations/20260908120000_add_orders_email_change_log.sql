-- Migration: add orders.email_change_log for self-serve post-order email correction (Batch 4b).
--
-- An append-only audit trail of customer_email changes: [{from,to,at,source}, …]. Also the
-- source of truth for the self-serve rate limit (count + last timestamp), so no extra columns
-- or infra are needed. Additive + backward-compatible: existing orders default to [] and the
-- correction code omits nothing on read (missing/[] → no prior changes).
alter table public.orders
  add column if not exists email_change_log jsonb not null default '[]'::jsonb;
