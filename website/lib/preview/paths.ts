/**
 * Storage path construction for customer uploads.
 *
 * Lives OUTSIDE the 'use server' action module on purpose: every export of a
 * 'use server' file must be an async Server Action, so a plain string helper there
 * fails the build (it type-checks and unit-tests fine — only `next build` catches it).
 */

/**
 * Prefix owning one draft's uploads: `uploads/<draftId>`.
 *
 * Per-draft namespacing replaced a bare `uploads/<contenthash>.png` scheme that had
 * two problems — with `upsert: true`, two customers uploading identical bytes wrote to
 * the same object, and a content-hash path carries no linkage back to whose photo it
 * is, so a reaped draft left an orphan nobody could attribute or erase on request.
 * This prefix is also the unit E1's cascade and E4's erasure delete.
 */
export function draftUploadPrefix(draftId: string): string {
  return `uploads/${draftId}`;
}
