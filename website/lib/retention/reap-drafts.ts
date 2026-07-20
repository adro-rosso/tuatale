/**
 * E1 — CASCADE DELETION on draft reap (retention fix, 2026-07-20).
 *
 * The problem this replaces: a pg_cron job deleted expired `public.drafts` ROWS while
 * nothing ever deleted a Storage OBJECT. Since `preview_jobs.draft_id` is
 * `on delete set null`, reaping a row also severed the last link between a photo and
 * the person it belonged to — every reap manufactured an unattributable orphan we
 * could no longer erase on request. Postgres can't do this itself (deleting a
 * `storage.objects` row leaves the bytes in S3), so the reap moves here, where the
 * service-role Storage API is available.
 *
 * TWO RULES, both learned from a real incident (order ae04d56c, 2026-07-16):
 *
 *   1. DELETE FROM THE ROW'S OWN PATH LIST — NEVER BY SWEEPING THE BUCKET.
 *      A bucket sweep decides what to delete from what it *can't* see a reference to,
 *      so any reference it fails to understand becomes a deleted file. We only ever
 *      delete paths a row we are about to delete explicitly names.
 *
 *   2. REFERENTIAL CHECK BEFORE EVERY DELETE.
 *      Legacy paths are `uploads/<contenthash>.png` — named by CONTENT, so two drafts
 *      holding the same photo share one object. Reaping draft A would then delete
 *      draft B's (or a paid order's) file out from under it, leaving a row pointing at
 *      a file that no longer exists. That is exactly the dangling-reference state we
 *      found on ae04d56c, and it would break a reprint confusingly, long after the
 *      fact. So a path is only deleted once NO surviving row references it.
 *
 * D's per-draft namespacing (`uploads/<draftId>/<hash>.png`) makes rule 2 almost
 * always trivially satisfied going forward — but the legacy objects are still out
 * there, so the check is not optional.
 */
import { createServerClient, type TuataleSupabaseClient } from '@/lib/supabase';

const PREVIEW_BUCKET = 'tuatale-previews';

export type ReapReport = {
  dryRun: boolean;
  draftsReaped: number;
  photosDeleted: string[];
  /** Paths NOT deleted because a surviving row still references them (rule 2). */
  photosRetained: { path: string; reason: string }[];
  errors: string[];
};

/**
 * Pull every Storage path out of a `photo_urls` jsonb value. The shape differs by
 * book type — child books store a bare array, pet books store `{ pet: [...] }` — and
 * more keys may land later, so this walks the structure rather than assuming either.
 * Only `uploads/`-prefixed strings are returned: we must never hand a rendered
 * preview or a book PDF path to a delete call from here.
 */
export function collectPhotoPaths(photoUrls: unknown): string[] {
  const out: string[] = [];
  const walk = (v: unknown): void => {
    if (typeof v === 'string') {
      if (v.startsWith('uploads/')) out.push(v);
      return;
    }
    if (Array.isArray(v)) return void v.forEach(walk);
    if (v && typeof v === 'object') return void Object.values(v).forEach(walk);
  };
  walk(photoUrls);
  return [...new Set(out)];
}

/**
 * Every path referenced by a row that will SURVIVE this reap — live drafts we aren't
 * touching, plus all orders (an order's photos are snapshotted on conversion, outlive
 * its draft, and a paid order needs them for reprints; orders are never reaped here).
 * Built once up front: the check must see the whole surviving world, and re-querying
 * per path would both be slow and risk an inconsistent view mid-run.
 */
async function buildSurvivingReferences(
  reapedDraftIds: Set<string>,
  client: TuataleSupabaseClient,
): Promise<Set<string>> {
  const [{ data: drafts }, { data: orders }] = await Promise.all([
    client.from('drafts').select('id, photo_urls'),
    client.from('orders').select('id, photo_urls'),
  ]);
  const refs = new Set<string>();
  for (const d of drafts ?? []) {
    if (reapedDraftIds.has(d.id)) continue;
    collectPhotoPaths(d.photo_urls).forEach((p) => refs.add(p));
  }
  for (const o of orders ?? []) collectPhotoPaths(o.photo_urls).forEach((p) => refs.add(p));
  return refs;
}

/**
 * Reap expired drafts, cascading their photos. Mirrors the pg_cron predicate it
 * replaces: `expires_at < now() and status != 'converted'` — a converted draft became
 * an order and must not be touched.
 *
 * DRY-RUN BY DEFAULT. The caller must pass `{ dryRun: false }` to delete anything.
 */
export async function reapExpiredDrafts(
  { dryRun = true }: { dryRun?: boolean } = {},
  client: TuataleSupabaseClient = createServerClient(),
): Promise<ReapReport> {
  const report: ReapReport = { dryRun, draftsReaped: 0, photosDeleted: [], photosRetained: [], errors: [] };

  const { data: expired, error } = await client
    .from('drafts')
    .select('id, photo_urls')
    .lt('expires_at', new Date().toISOString())
    .neq('status', 'converted');
  if (error) {
    report.errors.push(`select expired: ${error.message}`);
    return report;
  }
  if (!expired?.length) return report;

  const reapedIds = new Set(expired.map((d) => d.id));
  const surviving = await buildSurvivingReferences(reapedIds, client);

  for (const draft of expired) {
    const paths = collectPhotoPaths(draft.photo_urls);
    const deletable: string[] = [];
    for (const path of paths) {
      if (surviving.has(path)) {
        // Rule 2. Leave it; whichever row still holds it will cascade it later.
        report.photosRetained.push({ path, reason: 'referenced by a surviving draft or order' });
        continue;
      }
      deletable.push(path);
    }

    if (!dryRun && deletable.length) {
      const { error: rmErr } = await client.storage.from(PREVIEW_BUCKET).remove(deletable);
      if (rmErr) {
        // Do NOT delete the row: it is the only remaining record of which objects
        // belong to this person. Losing it turns a retryable failure into a permanent
        // orphan — the precise outcome this whole fix exists to prevent.
        report.errors.push(`storage remove for draft ${draft.id}: ${rmErr.message}`);
        continue;
      }
    }
    report.photosDeleted.push(...deletable);

    if (!dryRun) {
      const { error: delErr } = await client.from('drafts').delete().eq('id', draft.id);
      if (delErr) {
        report.errors.push(`delete draft ${draft.id}: ${delErr.message}`);
        continue;
      }
    }
    report.draftsReaped += 1;
  }

  return report;
}
