/**
 * Reaper for a SHIPPED order's SOURCE reference photos — "exposure ends 30 days after
 * fulfilment" made TRUE rather than aspirational.
 *
 * The draft-expiry reap (E1, reap-drafts.ts) never touches a CONVERTED draft (it's kept
 * for the forensic trail via converted_to_order_id), and the order copies photo_urls at
 * checkout — so a shipped order's uploaded child/pet/adult photos would otherwise live in
 * `tuatale-previews/uploads/<draftId>/…` INDEFINITELY. This sweeps them after a TTL.
 *
 * TTL = 30 DAYS from `pipeline_jobs.shipped_at` (Adro's call): an N-day window, NOT at-ship,
 * so reprints and support in the weeks after delivery still have the source photos. The
 * rendered book PDF (orders.book_pdf_url — a different field/bucket) is NOT touched.
 *
 * Only `uploads/`-prefixed paths are deleted (collectPhotoPaths filters to those) — never a
 * rendered preview or a book PDF. After deleting the objects we CLEAR the references on the
 * order (and its converted draft) so getOrderPhotos reports "absent" cleanly and nothing
 * dangles — the erasure is provable, not just best-effort.
 *
 * DRY-RUN BY DEFAULT (mirrors reapExpiredDrafts / reapReviewArtifacts): the caller passes
 * { dryRun: false } to delete. Errors are collected, not thrown — one bad order must not
 * stop the sweep, and an order whose Storage delete failed keeps its references so the next
 * run retries it. Idempotent: an already-erased order has no `uploads/` paths → a no-op.
 */
import { createServerClient, type TuataleSupabaseClient } from '@/lib/supabase';
import { collectPhotoPaths } from '@/lib/retention/reap-drafts';

const PREVIEW_BUCKET = 'tuatale-previews';
const TTL_DAYS = 30;

export type OrderPhotoReapReport = {
  dryRun: boolean;
  ttlDays: number;
  /** Shipped orders past TTL that still held source photos (the candidates). */
  scanned: number;
  /** Orders whose source photos were erased (apply) or would be (dry-run). */
  ordersErased: number;
  /** Object paths deleted (apply) or that would be (dry-run). */
  photosDeleted: string[];
  errors: string[];
};

export async function reapShippedOrderPhotos(
  { dryRun = true }: { dryRun?: boolean } = {},
  client: TuataleSupabaseClient = createServerClient(),
): Promise<OrderPhotoReapReport> {
  const report: OrderPhotoReapReport = {
    dryRun,
    ttlDays: TTL_DAYS,
    scanned: 0,
    ordersErased: 0,
    photosDeleted: [],
    errors: [],
  };

  const cutoff = new Date(Date.now() - TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();
  // Orders shipped > TTL ago. The ship time lives on the pipeline job (set by markShipped).
  const { data: jobs, error } = await client
    .from('pipeline_jobs')
    .select('order_id, shipped_at')
    .eq('status', 'shipped')
    .lt('shipped_at', cutoff);
  if (error) {
    report.errors.push(`select shipped jobs: ${error.message}`);
    return report;
  }
  if (!jobs?.length) return report;

  const orderIds = [...new Set(jobs.map((j) => j.order_id).filter((v): v is string => Boolean(v)))];

  for (const orderId of orderIds) {
    const { data: order, error: oErr } = await client
      .from('orders')
      .select('id, photo_urls, converted_from_draft_id')
      .eq('id', orderId)
      .single();
    if (oErr || !order) {
      report.errors.push(`load order ${orderId}: ${oErr?.message ?? 'not found'}`);
      continue;
    }

    const paths = collectPhotoPaths(order.photo_urls);
    if (!paths.length) continue; // already erased / never had source photos
    report.scanned += 1;

    if (!dryRun) {
      const { error: rmErr } = await client.storage.from(PREVIEW_BUCKET).remove(paths);
      if (rmErr) {
        // Keep the references so the next run retries — do NOT report success on a failed delete.
        report.errors.push(`storage remove order ${orderId}: ${rmErr.message}`);
        continue;
      }
      // Clear the references so getOrderPhotos reports absent and nothing dangles. Clear the
      // order first (the operative reference), then the converted draft (same photos).
      const { error: upErr } = await client.from('orders').update({ photo_urls: {} }).eq('id', orderId);
      if (upErr) {
        report.errors.push(`clear order.photo_urls ${orderId}: ${upErr.message}`);
        continue;
      }
      if (order.converted_from_draft_id) {
        const { error: dErr } = await client
          .from('drafts')
          .update({ photo_urls: {}, photo_consent_at: null })
          .eq('id', order.converted_from_draft_id);
        // Non-fatal: the object is gone and the order reference is cleared; a lingering
        // draft reference points at nothing. Log, don't fail the erasure.
        if (dErr) report.errors.push(`clear draft.photo_urls ${order.converted_from_draft_id}: ${dErr.message}`);
      }
    }

    report.photosDeleted.push(...paths);
    report.ordersErased += 1;
  }

  return report;
}
