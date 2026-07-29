/**
 * Character-picker Slice 4 — DURABLE COPY at order creation.
 *
 * The customer's chosen option lives in the EPHEMERAL previews bucket (reaped with the
 * draft). A paid book can generate DAYS later, so at order creation we copy each pick to
 * STABLE storage: tuatale-books/orders/<id>/chosen/<subjectId>.png — same bucket + prefix
 * as book.pdf, so GDPR erasure (prefix sweep) covers it and retention (review/-scoped)
 * leaves it intact. The worker's injectChosenSheets reads it back at generation.
 *
 * NON-NEGOTIABLE (B): a copy failure NEVER fails a PAID order. It degrades that pick to a
 * normal mint (marks it degraded → the worker book is made from photos, the operator is
 * flagged) and the order proceeds. IDEMPOTENT on webhook replay (already-durable → no-op;
 * upsert otherwise).
 */
import { createServerClient } from '@/lib/supabase';
import type { ChosenSheet } from '@/lib/preview/types';

const PREVIEWS_BUCKET = 'tuatale-previews';
const BOOKS_BUCKET = 'tuatale-books';

export function durableChosenPath(orderId: string, subjectId: string): string {
  return `orders/${orderId}/chosen/${subjectId}.png`;
}

type SbClient = ReturnType<typeof createServerClient>;

async function copyOne(client: SbClient, orderId: string, subjectId: string, pick: ChosenSheet): Promise<ChosenSheet> {
  const dest = durableChosenPath(orderId, subjectId);
  if (pick.imagePath === dest) return pick; // already durable (replay) → idempotent no-op
  const src = pick.imagePath;
  if (!src || pick.degraded) return { ...pick, imagePath: '', degraded: true, degradedReason: pick.degradedReason ?? 'no_source' };
  try {
    const { data, error } = await client.storage.from(PREVIEWS_BUCKET).download(src);
    if (error || !data) throw new Error(error?.message ?? 'preview download returned null');
    const bytes = Buffer.from(await data.arrayBuffer());
    const { error: upErr } = await client.storage.from(BOOKS_BUCKET).upload(dest, bytes, { contentType: 'image/png', upsert: true });
    if (upErr) throw new Error(upErr.message);
    return { ...pick, imagePath: dest };
  } catch (e) {
    // B: the preview PNG is gone (e.g. checkout after the draft was reaped) → degrade.
    console.error(`[chosen-copy] order ${orderId} subject ${subjectId}: ${(e as Error).message} — degrading to normal mint`);
    return { subjectId, previewId: pick.previewId, imagePath: '', degraded: true, degradedReason: 'copy_failed_at_order' };
  }
}

interface OrderLike {
  id: string;
  // jsonb columns arrive as `Json` from the generated order types (lagging the migration),
  // so accept unknown and narrow internally.
  chosen_sheet?: unknown;
  secondaries?: unknown;
}

/** Copy every pick on the order to durable storage; update the order in place. Best-effort. */
export async function persistChosenSheetsForOrder(order: OrderLike): Promise<void> {
  const client = createServerClient();
  const updates: Record<string, unknown> = {};
  let changed = false;

  const p = order.chosen_sheet as ChosenSheet | null | undefined;
  if (p && (p.imagePath || p.previewId)) {
    updates.chosen_sheet = await copyOne(client, order.id, 'protagonist', p);
    changed = true;
  }

  const secs = Array.isArray(order.secondaries) ? (order.secondaries as Array<Record<string, unknown>>) : [];
  if (secs.some((s) => (s.chosen_sheet as ChosenSheet | undefined)?.imagePath)) {
    updates.secondaries = await Promise.all(
      secs.map(async (s, i) => {
        const c = s.chosen_sheet as ChosenSheet | undefined;
        // Positional companion-{index+1} (form cards have no id) — matches the adapter.
        const id = (s.id || s.secondary_id || `companion-${i + 1}`) as string;
        if (!c?.imagePath) return s;
        return { ...s, chosen_sheet: await copyOne(client, order.id, id, c) };
      }),
    );
    changed = true;
  }

  if (changed) {
    const { error } = await client.from('orders').update(updates as never).eq('id', order.id);
    if (error) console.error(`[chosen-copy] order ${order.id} update failed: ${error.message}`);
  }
}
