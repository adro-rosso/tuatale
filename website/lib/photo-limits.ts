/**
 * Photo-count limits shared by the wizard UI and the upload Server Actions. Lives in a plain
 * module because a 'use server' file may only export async functions.
 */
// Child reference photos per draft (2026-10-20): was a single replace-on-upload photo; now up to
// 5, same as pets — the worker's face-ranking (selectBestPhotos) picks the clear-face ones, so
// more angles = better likeness. The client enforces the cap; the server caps defensively.
export const MAX_CHILD_PHOTOS = 5;

/** A child reference photo as the wizard holds it. `url` is a session-only object URL for a
 * fresh upload's thumbnail; null for a photo restored from the draft (shows "Saved"). */
export type ChildPhoto = { path: string; hash: string; name: string; url: string | null };
