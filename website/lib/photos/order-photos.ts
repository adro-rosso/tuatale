/**
 * Reference photos for an order, for the admin review surface.
 *
 * PRIVACY POSTURE. These are photographs of real children and pets. They are:
 *   - fetched ON DEMAND, never copied anywhere durable (no second copy outside the
 *     retention cascade — a copy on an operator laptop would sit outside E1's reap and
 *     E4's erasure, while the retention policy is still undecided),
 *   - served via SHORT-LIVED SIGNED URLs (never public, never permanent),
 *   - only ever rendered behind the /admin Basic-Auth gate (proxy.ts, fail-closed).
 *
 * EXISTENCE IS CHECKED WITH list(), NOT INFERRED FROM A SIGNING FAILURE.
 * A wrong bucket, a bad key, or an expired service role would make createSignedUrl fail
 * for a photo that is present and fine — and if absence were inferred from that failure,
 * a CONFIG ERROR would render identically to a genuinely deleted photo. Those are
 * opposite problems (one is "fix your deploy", the other is "the customer's photo is
 * gone"), so they are distinguished here and in the UI. Same reasoning as verifying a
 * storage deletion via list() rather than trusting the delete call's own success.
 *
 * BUCKET PROBE — list() ALONE IS NOT ENOUGH (measured, 2026-07-22).
 * `storage.from('bucket-that-does-not-exist').list(...)` returns `{ data: [], error: null }`
 * — BYTE-IDENTICAL to a real bucket missing that object. So list() alone cannot tell a
 * misconfigured bucket from a deleted photo, and the whole absent/error distinction would
 * silently collapse into "photo no longer stored" the moment the bucket name was wrong.
 * `getBucket()` DOES distinguish it ("Bucket not found" vs success), so the bucket is
 * probed ONCE per call and a failure marks every photo 'error'. Verified both halves
 * empirically rather than assumed — the first version of this file shipped the wrong
 * assumption and a UI check would not have caught it.
 */
import { createServerClient } from '@/lib/supabase';
import type { Json, Tables } from '@/types/database';

type OrderRow = Tables<'orders'>;

/** Bucket that storePhotoForDraft writes to (child, pet and adult uploads all route there). */
export const PHOTO_BUCKET = 'tuatale-previews';

/** How long an admin's photo URL stays valid. Short: the page re-signs on each render. */
export const SIGNED_URL_TTL_SECONDS = 300;

export type OrderPhotoState =
  /** Present in Storage and signed — `url` is set. */
  | 'ok'
  /** Confirmed ABSENT via list() — erased or reaped. The customer's photo is gone. */
  | 'absent'
  /** Present-or-unknown, but we could not produce a URL. A CONFIG/INFRA problem, not a
   *  data one — must not be presented as a deleted photo. */
  | 'error';

export interface OrderPhoto {
  key: string;
  label: string;
  path: string;
  state: OrderPhotoState;
  url: string | null;
  /** Operator-facing detail for the 'error' state (never shown for 'absent'). */
  detail?: string;
}

/**
 * Pull the storage paths out of `orders.photo_urls`. Shape varies by book type:
 *   child → { child: "uploads/<draftId>/<hash>.png" }
 *   pet   → { pet:   ["uploads/…", …] }   (multi-photo anchor)
 *   adult → { adult: ["uploads/…", …] }   (deliberately a separate key from `child`)
 */
export function extractPhotoPaths(
  photoUrls: Json,
  subjectName: string | null,
): { key: string; label: string; path: string }[] {
  if (!photoUrls || typeof photoUrls !== 'object' || Array.isArray(photoUrls)) return [];
  const who = subjectName?.trim() || 'Subject';
  const out: { key: string; label: string; path: string }[] = [];
  const rec = photoUrls as Record<string, unknown>;

  for (const bucketKey of ['child', 'pet', 'adult'] as const) {
    const v = rec[bucketKey];
    const list = Array.isArray(v) ? v : v ? [v] : [];
    list.forEach((p, i) => {
      if (typeof p !== 'string' || !p) return;
      out.push({
        key: `${bucketKey}-${i}`,
        label: list.length > 1 ? `${who} — photo ${i + 1}` : `${who} — reference photo`,
        path: p,
      });
    });
  }
  return out;
}

/**
 * Resolve an order's reference photos to signed URLs.
 *
 * Never throws: a failure to reach Storage degrades to state 'error' per photo, so the
 * review page still renders (a missing photo must not take down the page an operator
 * uses to decide whether to ship).
 */
export async function getOrderPhotos(order: OrderRow): Promise<OrderPhoto[]> {
  const entries = extractPhotoPaths(order.photo_urls, order.child_name);
  if (entries.length === 0) return [];

  const client = createServerClient();

  // Probe the bucket ONCE. If it is missing/unreachable, every list() below would return
  // an empty array that is indistinguishable from a deleted object — so short-circuit and
  // report a config error for all photos rather than telling the operator the customer's
  // photos are gone.
  try {
    const { error } = await client.storage.getBucket(PHOTO_BUCKET);
    if (error) {
      return entries.map(({ key, label, path }) => ({
        key, label, path, state: 'error' as const, url: null,
        detail: `storage bucket "${PHOTO_BUCKET}" unavailable: ${error.message}`,
      }));
    }
  } catch (err) {
    return entries.map(({ key, label, path }) => ({
      key, label, path, state: 'error' as const, url: null,
      detail: `storage unreachable: ${err instanceof Error ? err.message : String(err)}`,
    }));
  }

  return Promise.all(
    entries.map(async ({ key, label, path }): Promise<OrderPhoto> => {
      const slash = path.lastIndexOf('/');
      const dir = slash === -1 ? '' : path.slice(0, slash);
      const name = slash === -1 ? path : path.slice(slash + 1);

      // 1. AUTHORITATIVE existence check.
      try {
        const { data, error } = await client.storage
          .from(PHOTO_BUCKET)
          .list(dir, { search: name, limit: 100 });
        if (error) {
          return { key, label, path, state: 'error', url: null, detail: `list failed: ${error.message}` };
        }
        if (!(data ?? []).some((o) => o.name === name)) {
          // Genuinely not there — erased (E4) or reaped (E1).
          return { key, label, path, state: 'absent', url: null };
        }
      } catch (err) {
        return {
          key, label, path, state: 'error', url: null,
          detail: `list threw: ${err instanceof Error ? err.message : String(err)}`,
        };
      }

      // 2. It exists — sign it. A failure HERE is infrastructure, not absence.
      try {
        const { data, error } = await client.storage
          .from(PHOTO_BUCKET)
          .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
        if (error || !data?.signedUrl) {
          return {
            key, label, path, state: 'error', url: null,
            detail: `sign failed: ${error?.message ?? 'no URL returned'}`,
          };
        }
        return { key, label, path, state: 'ok', url: data.signedUrl };
      } catch (err) {
        return {
          key, label, path, state: 'error', url: null,
          detail: `sign threw: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    }),
  );
}
