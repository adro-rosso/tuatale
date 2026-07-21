'use server';

/**
 * Whole-character preview server actions (S-C). The website's bridge to the
 * worker's runPreviewJob:
 *   requestPreview  → cache lookup → (hit) return URL | (miss) create row + send
 *                     `preview/requested` event → return previewId
 *   getPreviewStatus → poll the row for the result
 *
 * Cost control wired here: input-hash CACHE (same inputs → no regen). The
 * per-draft free-count CAP is scaffolded (draft_id stored, countPreviewsForDraft
 * helper exists) but NOT enforced — enforcement + UX land in S-E.
 */
import { createHash } from 'node:crypto';
import { inngest } from '@/lib/inngest/client';
import { createServerClient } from '@/lib/supabase';
import { computeInputHash } from '@/lib/preview/hash';
import { draftUploadPrefix } from '@/lib/preview/paths';
import { getDraftCookieFromRequest } from '@/lib/draft-cookie';
import { getDraftByCookieId, updateDraftByCookieId, type DraftUpdate } from '@/db/drafts';
import {
  findCachedPreview,
  createPreviewJob,
  getPreviewJob,
  countPreviewsForDraft,
  countPreviewsForDraftSince,
} from '@/lib/preview/preview-jobs';
import type { RequestPreviewInput, PreviewResult } from '@/lib/preview/types';

const PREVIEW_BUCKET = 'tuatale-previews';

// S-E preview cost-control (~$0.04/gen). Cache hits are free + never counted;
// these bound NEW gens only. Starting values — tune from real usage.
const FREE_PREVIEW_CAP = 10;          // distinct gens per draft (~$0.40 COGS ceiling)
const RATE_BURST_MS = 5_000;          // ≥1 new gen per 5s = throttle (burst debounce)
const RATE_HOUR_MS = 3_600_000;
const RATE_HOURLY_MAX = 40;           // hard per-draft hourly ceiling

// ---- Upload hardening (security fix C + D, 2026-07-17) ---------------------
// These upload actions previously had NO auth, NO ownership check, NO content
// validation, NO size cap and NO rate limit — an unauthenticated caller could push
// arbitrary bytes into Storage in a loop (cost/DoS + content-hosting). Server Actions
// are POST endpoints whose ids ship in the client bundle, so "the UI doesn't call it
// that way" is not a control. requestPreview already required a draft for exactly this
// reason ("an anonymous flood with no draft would dodge both") — that asymmetry WAS
// the bug; the uploads now enforce the same thing.
const MAX_PHOTO_BYTES = 4 * 1024 * 1024;   // 4MB; the client downscales to ~1024px first
const MAX_PHOTOS_PER_DRAFT = 20;           // bounds per-draft storage abuse
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * Resolve the CALLER'S OWN draft from the httpOnly cookie. Never takes a draft id
 * from the client — that would just move the forgery one level out.
 */
async function requireOwnDraft(action: string): Promise<{ id: string }> {
  const cookieId = await getDraftCookieFromRequest();
  if (!cookieId) throw new Error(`${action}: no active session.`);
  const draft = await getDraftByCookieId(cookieId);
  if (!draft) throw new Error(`${action}: no active session.`);
  return { id: draft.id };
}

/**
 * The single hardened upload path shared by both actions: ownership, size cap,
 * magic-byte sniff, per-draft rate limit, namespaced write.
 */
async function storePhotoForDraft(
  formData: FormData,
  action: string,
): Promise<{ photoPath: string; photoHash: string }> {
  const draft = await requireOwnDraft(action);

  const file = formData.get('photo');
  if (!(file instanceof File)) throw new Error(`${action}: no photo file`);

  // Size cap BEFORE buffering further work on it.
  if (file.size > MAX_PHOTO_BYTES) {
    throw new Error(`${action}: photo is too large (max ${MAX_PHOTO_BYTES / 1024 / 1024}MB).`);
  }
  const bytes = Buffer.from(await file.arrayBuffer());
  if (bytes.length > MAX_PHOTO_BYTES) {
    throw new Error(`${action}: photo is too large (max ${MAX_PHOTO_BYTES / 1024 / 1024}MB).`);
  }

  // CONTENT validation by magic bytes. The previous `contentType: 'image/png'` was a
  // LABEL written into Storage metadata, not a check — a ZIP/EXE/PDF would be stored
  // and served as image/png. The browser always converts to PNG before calling, so
  // requiring the PNG signature is exact, not merely heuristic.
  if (bytes.length < PNG_MAGIC.length || !bytes.subarray(0, PNG_MAGIC.length).equals(PNG_MAGIC)) {
    throw new Error(`${action}: unsupported image format (PNG required).`);
  }

  // Per-draft ceiling: bounds how much one session can push into the bucket.
  const client = createServerClient();
  const prefix = draftUploadPrefix(draft.id);
  const { data: existing } = await client.storage.from(PREVIEW_BUCKET).list(prefix, { limit: MAX_PHOTOS_PER_DRAFT + 1 });
  if ((existing?.length ?? 0) >= MAX_PHOTOS_PER_DRAFT) {
    throw new Error(`${action}: too many photos for this book.`);
  }

  // Content hash still names the object (so re-uploading the same photo is idempotent
  // and the preview cache key stays stable) but now WITHIN the draft's prefix, so two
  // customers uploading identical bytes no longer collide and overwrite each other.
  const photoHash = createHash('sha256').update(bytes).digest('hex');
  const photoPath = `${prefix}/${photoHash}.png`;
  const { error } = await client.storage
    .from(PREVIEW_BUCKET)
    .upload(photoPath, bytes, { contentType: 'image/png', upsert: true });
  if (error) throw new Error(`${action} failed: ${error.message}`);
  return { photoPath, photoHash };
}

/**
 * CHILD-photo upload — HARD-DISABLED IN PRODUCTION (security fix, 2026-07-17).
 *
 * Why a server-side gate and not just an unrendered UI: a Server Action is a POST
 * endpoint whose action id ships in the public client bundle. Not rendering the
 * button does NOT disable the endpoint — anyone could invoke it directly. Until the
 * banked privacy / consent / content-safety workstream lands
 * ([[project_photo-likeness-probe]]), CHILD photos must be impossible to upload, so
 * this refuses before it reads the body or touches Storage.
 *
 * Opt-in is SERVER-ONLY and default-OFF: set CHILD_PHOTO_UPLOAD=on in .env.local for
 * local testing (deliberately NOT a NEXT_PUBLIC_* var, so it can never be flipped
 * from the browser and is absent → disabled in prod).
 */
const CHILD_PHOTO_UPLOAD_ENABLED = () => process.env.CHILD_PHOTO_UPLOAD === 'on';

export async function uploadPhoto(formData: FormData): Promise<{ photoPath: string; photoHash: string }> {
  if (!CHILD_PHOTO_UPLOAD_ENABLED()) {
    // Log the attempt: in prod nothing legitimately calls this, so an invocation is
    // either a stale client or someone probing the endpoint.
    console.error('[uploadPhoto] BLOCKED: child-photo upload is disabled (privacy/consent review pending)');
    throw new Error(
      'Photo upload is not available. Child-photo upload is disabled pending our privacy and safety review.',
    );
  }
  return storePhotoForDraft(formData, 'uploadPhoto');
}

/**
 * Pet-photo upload (pet-as-hero, LAUNCH-OK). Uploads a PNG of the customer's pet to
 * the uploads bucket and returns its Storage path + content-hash. Unlike uploadPhoto
 * (child photos, gated behind the privacy/safety review), a PET photo carries no
 * child-photo legal/safety gate, so this is customer-facing. The browser converts the
 * chosen image to PNG (downscaled) before calling this; the path is later persisted
 * into draft.photo_urls.pet by submitPetStep.
 */
export async function uploadPetPhoto(formData: FormData): Promise<{ photoPath: string; photoHash: string }> {
  return storePhotoForDraft(formData, 'uploadPetPhoto');
}

/**
 * ADULT-photo upload (adult-as-hero live subject preview, Slice 2). Routes through the
 * SAME hardened storePhotoForDraft as pets. Gated by ADULT_PHOTO_ENABLED — a flag
 * DISTINCT from the child-photo gate: an adult photographing themselves (or a gift-
 * giver an adult they know, with attested consent) carries no child-photo legal gate,
 * so this can be on while uploadPhoto (child) stays hard-denied. The flag is
 * server-only and NOT a NEXT_PUBLIC_* var, so it can't be flipped from the browser.
 * FAIL-CLOSED: default OFF, requires ADULT_PHOTO_UPLOAD=on (Slice 2's deploy sets it on Vercel + local).
 */
const ADULT_PHOTO_UPLOAD_ENABLED = () => process.env.ADULT_PHOTO_UPLOAD === 'on';

export async function uploadAdultPhoto(formData: FormData): Promise<{ photoPath: string; photoHash: string }> {
  if (!ADULT_PHOTO_UPLOAD_ENABLED()) {
    console.error('[uploadAdultPhoto] BLOCKED: adult-photo upload is disabled');
    throw new Error('Photo upload is not available right now.');
  }
  return storePhotoForDraft(formData, 'uploadAdultPhoto');
}

/**
 * Make the "you can remove it any time before you order" promise TRUE at full scope:
 * (a) the UI has a Remove button that calls this; (b) it UNLINKS the path from the
 * draft (no dangling reference — the ae04d56c failure mode); (c) it DELETES the stored
 * object, verified absent via list() (a delete that reports success but leaves the
 * object listed is a failed erasure — cf. the E4 erasure tool + the stale-read window
 * note: a signed URL issued before deletion can still serve from cache briefly, but
 * the object IS unlinked and deleted here — "remove" is honest).
 * Order: unlink FIRST, then delete, so a delete failure never orphans the row.
 */
export async function removeAdultPhoto(photoPath: string): Promise<{ ok: true }> {
  const cookieId = await getDraftCookieFromRequest();
  if (!cookieId) throw new Error('removeAdultPhoto: no active session.');
  const draft = await getDraftByCookieId(cookieId);
  if (!draft) throw new Error('removeAdultPhoto: no active session.');

  // Ownership: only a path under the caller's OWN upload prefix may be removed.
  const ownPrefix = `${draftUploadPrefix(draft.id)}/`;
  if (!photoPath.startsWith(ownPrefix) || photoPath.includes('..')) {
    throw new Error('removeAdultPhoto: not your photo.');
  }

  // (b) UNLINK from the draft first. Idempotent — filtering a not-present path is a no-op.
  const current = (draft.photo_urls as { adult?: string[] } | null)?.adult ?? [];
  const remaining = current.filter((p) => p !== photoPath);
  const noneLeft = remaining.length === 0;
  await updateDraftByCookieId(cookieId, {
    photo_urls: noneLeft ? {} : { adult: remaining },
    ...(noneLeft ? { photo_consent_at: null, character_generation_mode: 'text_only' } : {}),
  } as unknown as DraftUpdate);

  // (c) DELETE the object, then verify it is gone from the listing.
  const client = createServerClient();
  await client.storage.from(PREVIEW_BUCKET).remove([photoPath]);
  const prefix = photoPath.slice(0, photoPath.lastIndexOf('/'));
  const name = photoPath.slice(photoPath.lastIndexOf('/') + 1);
  const { data } = await client.storage.from(PREVIEW_BUCKET).list(prefix, { search: name });
  if ((data ?? []).some((o) => o.name === name)) {
    console.error(`[removeAdultPhoto] object still listed after delete: ${photoPath}`);
    throw new Error('removeAdultPhoto: could not remove the photo. Please try again.');
  }
  return { ok: true };
}

export async function requestPreview(input: RequestPreviewInput): Promise<PreviewResult> {
  const inputHash = computeInputHash(input);

  // Cache: an identical-input preview was already minted → reuse it, no spend.
  const cached = await findCachedPreview(inputHash);
  if (cached) {
    return { previewId: cached.id, status: 'done', imageUrl: cached.image_url, bgColor: cached.bg_color ?? null, cached: true };
  }

  // ---- S-E cost-control: a NEW gen (cache miss) is about to spend ~$0.04. -----
  // Every preview must be attributable to a draft so the cap/rate-limit have a
  // key (an anonymous flood with no draft would dodge both).
  const draftId = input.draftId;
  if (!draftId) {
    return { previewId: '', status: 'failed', cached: false, blocked: 'capped' };
  }
  // photoPath OWNERSHIP (security fix D, 2026-07-17). photoPath arrives from the
  // client and was previously forwarded verbatim into the Inngest event, where the
  // worker's downloadPhoto(photoPath) fetches it by raw key — a cross-prefix read
  // primitive: a caller could name `previews/<uuid>.png` (or any other object) and
  // have someone else's image pulled into THEIR generation. Confine it to the
  // caller's own upload prefix.
  if (input.photoPath) {
    const ownPrefix = `${draftUploadPrefix(draftId)}/`;
    if (!input.photoPath.startsWith(ownPrefix) || input.photoPath.includes('..')) {
      console.error(`[requestPreview] BLOCKED foreign photoPath for draft ${draftId}: ${input.photoPath}`);
      return { previewId: '', status: 'failed', cached: false, blocked: 'capped' };
    }
  }
  // Free-preview cap: bound total distinct gens per draft.
  if ((await countPreviewsForDraft(draftId)) >= FREE_PREVIEW_CAP) {
    return { previewId: '', status: 'failed', cached: false, blocked: 'capped' };
  }
  // Rate-limit: burst (≥1 in 5s) + hourly ceiling. Reuses preview_jobs.created_at.
  const now = Date.now();
  const [burst, hourly] = await Promise.all([
    countPreviewsForDraftSince(draftId, new Date(now - RATE_BURST_MS).toISOString()),
    countPreviewsForDraftSince(draftId, new Date(now - RATE_HOUR_MS).toISOString()),
  ]);
  if (burst >= 1 || hourly >= RATE_HOURLY_MAX) {
    return { previewId: '', status: 'failed', cached: false, blocked: 'rate_limited' };
  }

  // Miss + within budget: create the queued row + dispatch the worker.
  const job = await createPreviewJob({
    draftId: input.draftId ?? null,
    inputHash,
    inputs: {
      age: input.age,
      gender: input.gender,
      features: input.features,
      freeText: input.freeText,
      background: input.background,
      style: input.style,
      hasPhoto: Boolean(input.photoPath),
    },
  });

  await inngest.send({
    name: 'preview/requested',
    data: {
      previewId: job.id,
      age: input.age,
      name: input.name,
      features: input.features,
      freeText: input.freeText,
      background: input.background,
      style: input.style,
      photoPath: input.photoPath,
      isAdult: input.isAdult ?? false,
    },
  });

  return { previewId: job.id, status: 'queued', cached: false };
}

export async function getPreviewStatus(previewId: string): Promise<PreviewResult> {
  const job = await getPreviewJob(previewId);
  if (!job) return { previewId, status: 'failed', imageUrl: null, cached: false };
  return { previewId, status: job.status, imageUrl: job.image_url, bgColor: job.bg_color ?? null, cached: false };
}
