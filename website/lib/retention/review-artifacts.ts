/**
 * Delete an order's retained per-page review artifacts at ship time.
 *
 * Written by the WORKER (worker/src/review-artifacts.js) under orders/<id>/review/ while a
 * job is awaiting_review; deleted HERE when the operator ships, so a child's page
 * illustrations + character portraits exist only while review earns their keep.
 *
 * UNCONDITIONAL, NOT flag-gated (deliberate — differs from the worker's write side).
 * Gating the delete on FEATURES_REVIEW_RETENTION would leak: if retention were enabled
 * (artifacts accumulate) then later disabled, ship would stop cleaning up and existing
 * artifacts would outlive their lifecycle silently. An unconditional delete cleans up
 * whatever exists regardless of the current flag, and is a safe no-op when there is
 * nothing there (orders placed before retention existed). "Retain + delete go live as one
 * unit" is satisfied by shipping them in one deploy, not by sharing a flag.
 *
 * SCOPED TO review/ ONLY — never the whole orders/<id>/ prefix, which also holds book.pdf
 * (retained forever). The recursion below starts at orders/<id>/review, so book.pdf is
 * out of range by construction.
 *
 * RECURSIVE + list()-VERIFIED, same discipline as the E4 erasure fix: Supabase list() is
 * not recursive, and the review/ tree is nested (character-sheets/, pages/, front-matter/),
 * so a top-level delete would leave a child's portraits behind at the exact moment we
 * claim exposure ends. Absence is verified via list(), never inferred from the delete's
 * own success.
 */
import { createServerClient } from '@/lib/supabase';

/** Bucket holding book.pdf + retained review artifacts. Mirrors worker/src/storage.js BUCKET. */
export const BOOKS_BUCKET = 'tuatale-books';

/** Storage prefix owning one order's review artifacts. Mirrors worker/src/review-artifacts.js. */
export const reviewPrefix = (orderId: string): string => `orders/${orderId}/review`;

type StorageClient = ReturnType<typeof createServerClient>['storage'];

/** Recursively enumerate every FILE path under a prefix (paginated; list() is not recursive). */
async function listAllUnderPrefix(
  storage: StorageClient,
  bucket: string,
  prefix: string,
): Promise<string[]> {
  const LIMIT = 100;
  const out: string[] = [];
  const walk = async (p: string): Promise<void> => {
    for (let offset = 0; ; offset += LIMIT) {
      const { data, error } = await storage.from(bucket).list(p, { limit: LIMIT, offset });
      if (error) throw new Error(`list("${p}") failed: ${error.message}`);
      const entries = data ?? [];
      for (const o of entries) {
        const full = `${p}/${o.name}`;
        if (o.id === null) await walk(full); // folder → recurse
        else out.push(full); // file
      }
      if (entries.length < LIMIT) break;
    }
  };
  await walk(prefix);
  return out;
}

export interface ClearResult {
  /** Objects found and removed. 0 when there was nothing to delete (a clean no-op). */
  deleted: number;
}

/**
 * Remove every object under orders/<orderId>/review/, then confirm absence via list().
 *
 * Idempotent: an order with no review/ prefix returns { deleted: 0 } without error.
 * THROWS if any object is still listed after the delete — the caller (ship) treats that as
 * an ops-alertable failure rather than silently leaving a child's artifacts in place.
 */
export async function clearReviewArtifacts(
  orderId: string,
  deps: { client?: ReturnType<typeof createServerClient> } = {},
): Promise<ClearResult> {
  const storage = (deps.client ?? createServerClient()).storage;
  const prefix = reviewPrefix(orderId);

  const paths = await listAllUnderPrefix(storage, BOOKS_BUCKET, prefix);
  if (paths.length === 0) return { deleted: 0 };

  const { error } = await storage.from(BOOKS_BUCKET).remove(paths);
  if (error) throw new Error(`review cleanup remove failed for ${prefix}: ${error.message}`);

  // Verify absence against the listing — not the remove()'s own success.
  const remaining = await listAllUnderPrefix(storage, BOOKS_BUCKET, prefix);
  if (remaining.length > 0) {
    throw new Error(
      `review cleanup incomplete for ${prefix}: ${remaining.length} object(s) still listed ` +
        `(${remaining.slice(0, 5).join(', ')}${remaining.length > 5 ? ', …' : ''})`,
    );
  }
  return { deleted: paths.length };
}
