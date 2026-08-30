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
import { isConsentVersion, buildConsentRecord } from '@/lib/consent/registry';
import { moderateChildPhoto } from '@/lib/moderation/child-photo';
import {
  findCachedPreview,
  createPreviewJob,
  getPreviewJob,
  countPreviewsForDraft,
  countPreviewsForDraftSince,
  getBatchRows,
  countBatchesForDraft,
} from '@/lib/preview/preview-jobs';
import type {
  RequestPreviewInput,
  PreviewResult,
  RequestPreviewBatchInput,
  PreviewBatchResult,
  ChosenSheet,
} from '@/lib/preview/types';

const PREVIEW_BUCKET = 'tuatale-previews';

// S-E preview cost-control (~$0.04/gen). Cache hits are free + never counted;
// these bound NEW gens only. Starting values — tune from real usage.
const FREE_PREVIEW_CAP = 10;          // distinct gens per draft (~$0.40 COGS ceiling)
const RATE_BURST_MS = 5_000;          // ≥1 new gen per 5s = throttle (burst debounce)
const RATE_HOUR_MS = 3_600_000;
const RATE_HOURLY_MAX = 40;           // hard per-draft hourly ceiling

// Character-picker batch (Slice 2). Options per batch is SERVER-CAPPED — never trust a
// client count. A batch of N counts as ONE request against the batch-scoped cap +
// rate-limit (countBatchesForDraft), so firing N options can't self-throttle.
const MAX_BATCH_OPTIONS = 3;

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
 * banked privacy / consent / content-safety / legal workstream lands
 * ([[project_photo-likeness-probe]]), CHILD photos must be impossible to upload, so
 * this refuses before it reads the body or touches Storage.
 *
 * ⚠️ CHILD_PHOTO_ENABLED MUST stay OFF in any PUBLIC environment. Production
 * (tuatale.vercel.app) is publicly URL-reachable, so it must never be set there until
 * that workstream is complete. This is a PRIVATE-TESTING flag: enabled in the SSO-walled
 * Preview only, for the owner's own testing. Opt-in is SERVER-ONLY and default-OFF
 * (deliberately NOT a NEXT_PUBLIC_* var, so it can never be flipped from the browser and
 * is absent → disabled). This is the SAME flag that gates the child photo UI (the child
 * page passes CHILD_PHOTO_ENABLED down as CharacterBuilder's `photoEnabled`).
 */
const CHILD_PHOTO_ENABLED = () => process.env.CHILD_PHOTO_ENABLED === 'on';

/**
 * Result of a child / companion photo upload. A moderation rejection is RETURNED (not thrown)
 * so the client can show specific, kind copy — a THROWN Server Action message is redacted to a
 * generic digest in Preview/Prod builds and never reaches the client. Genuine technical
 * failures (no file, too large, storage error, disabled, no consent) still throw → the client's
 * catch shows the generic "didn't upload" copy. reason: 'unsafe' = content rejection;
 * 'unavailable' = we couldn't complete the check (show "try again", don't accuse the photo).
 */
export type PhotoUploadResult =
  | { ok: true; photoPath: string; photoHash: string }
  | { ok: false; reason: 'unsafe' | 'unavailable' };

export async function uploadPhoto(formData: FormData): Promise<PhotoUploadResult> {
  if (!CHILD_PHOTO_ENABLED()) {
    // Log the attempt: in prod nothing legitimately calls this, so an invocation is
    // either a stale client or someone probing the endpoint.
    console.error('[uploadPhoto] BLOCKED: child-photo upload is disabled (privacy/consent review pending)');
    throw new Error(
      'Photo upload is not available. Child-photo upload is disabled pending our privacy and safety review.',
    );
  }
  // CONSENT (required, fail-closed): the client sends the version id; the SERVER stores the
  // CANONICAL attestation text (tamper-proof). No/invalid consent → refuse BEFORE storing.
  const consentVersion = String(formData.get('consent_version') ?? '');
  if (!isConsentVersion(consentVersion)) {
    console.error('[uploadPhoto] BLOCKED: missing/invalid child-photo consent');
    throw new Error('Please confirm the parent/guardian consent checkbox before adding a photo.');
  }

  // MODERATION (fail-closed): a child photo must pass a suitability check BEFORE it is
  // stored — an unsuitable photo never lands in the bucket. Size-guard first so we never
  // moderate (or buffer) an oversized blob; storePhotoForDraft re-validates + uploads.
  const file = formData.get('photo');
  if (!(file instanceof File)) throw new Error('uploadPhoto: no photo file');
  if (file.size > MAX_PHOTO_BYTES) {
    throw new Error(`uploadPhoto: photo is too large (max ${MAX_PHOTO_BYTES / 1024 / 1024}MB).`);
  }
  const moderation = await moderateChildPhoto(Buffer.from(await file.arrayBuffer()));
  if (!moderation.ok) {
    // RETURN (don't throw): a thrown message is redacted client-side; the client needs the
    // category to choose "safety check" vs "couldn't check — try again" copy.
    console.error(`[uploadPhoto] photo rejected by moderation (mode=${moderation.mode}, ${moderation.category}): ${moderation.reason}`);
    return { ok: false, reason: moderation.category };
  }

  const { photoPath, photoHash } = await storePhotoForDraft(formData, 'uploadPhoto');

  // Track the child photo server-side FROM THE MOMENT it is stored: persist it into
  // draft.photo_urls.child + the versioned consent record. This is what makes the photo
  // reap-able on draft expiry / removable / order-carried — a client-state-only path
  // (the old behaviour) would ORPHAN in the bucket if the customer abandoned the draft.
  // Child is a single reference photo, so this REPLACES any prior one and cleans it up.
  const cookieId = await getDraftCookieFromRequest();
  if (cookieId) {
    const draft = await getDraftByCookieId(cookieId);
    const priorChild = (draft?.photo_urls as { child?: string[] } | null)?.child ?? [];
    const stale = priorChild.filter((p) => p !== photoPath);
    if (stale.length) {
      // Best-effort cleanup of the replaced photo's object (don't fail the new upload on it).
      await createServerClient().storage.from(PREVIEW_BUCKET).remove(stale).catch(() => {});
    }
    await updateDraftByCookieId(cookieId, {
      photo_urls: { child: [photoPath] },
      photo_consent_at: new Date().toISOString(),
      // Versioned consent record — lagging column, cast (generated types trail the migration).
      photo_consent: buildConsentRecord(consentVersion, new Date().toISOString()),
      character_generation_mode: 'photo_assisted',
    } as unknown as DraftUpdate);
  }

  return { ok: true, photoPath, photoHash };
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
 * Make the "you can remove it any time before you order" promise TRUE at full scope,
 * for ANY subject role (child / pet / adult):
 * (a) a UI Remove button calls the role wrapper; (b) it UNLINKS the path from the
 * draft (no dangling reference — the ae04d56c failure mode); (c) it DELETES the stored
 * object, verified absent via list() (a delete that reports success but leaves the
 * object listed is a failed erasure — cf. the E4 erasure tool + the stale-read window
 * note: a signed URL issued before deletion can still serve from cache briefly, but
 * the object IS unlinked and deleted here — "remove" is honest).
 * Order: unlink FIRST, then delete, so a delete failure never orphans the row.
 *
 * Shared by all three roles so child/pet get the SAME real erasure adult already had
 * (previously child + pet "remove" only cleared client state — the object survived).
 */
async function removeOwnPhoto(
  photoPath: string,
  role: 'child' | 'pet' | 'adult',
  action: string,
): Promise<{ ok: true }> {
  const cookieId = await getDraftCookieFromRequest();
  if (!cookieId) throw new Error(`${action}: no active session.`);
  const draft = await getDraftByCookieId(cookieId);
  if (!draft) throw new Error(`${action}: no active session.`);

  // Ownership: only a path under the caller's OWN upload prefix may be removed.
  const ownPrefix = `${draftUploadPrefix(draft.id)}/`;
  if (!photoPath.startsWith(ownPrefix) || photoPath.includes('..')) {
    throw new Error(`${action}: not your photo.`);
  }

  // (b) UNLINK from the draft first. Idempotent — filtering a not-present path is a no-op.
  const current = (draft.photo_urls as Record<string, string[] | undefined> | null)?.[role] ?? [];
  const remaining = current.filter((p) => p !== photoPath);
  const noneLeft = remaining.length === 0;
  await updateDraftByCookieId(cookieId, {
    photo_urls: noneLeft ? {} : { [role]: remaining },
    // Consent + photo-mode belong to the photo set; clear them once the last photo is gone.
    // photo_consent is the versioned record (lagging column, cast); photo_consent_at the legacy ts.
    ...(noneLeft ? { photo_consent_at: null, photo_consent: null, character_generation_mode: 'text_only' } : {}),
  } as unknown as DraftUpdate);

  // (c) DELETE the object, then verify it is gone from the listing.
  const client = createServerClient();
  await client.storage.from(PREVIEW_BUCKET).remove([photoPath]);
  const prefix = photoPath.slice(0, photoPath.lastIndexOf('/'));
  const name = photoPath.slice(photoPath.lastIndexOf('/') + 1);
  const { data } = await client.storage.from(PREVIEW_BUCKET).list(prefix, { search: name });
  if ((data ?? []).some((o) => o.name === name)) {
    console.error(`[${action}] object still listed after delete: ${photoPath}`);
    throw new Error(`${action}: could not remove the photo. Please try again.`);
  }
  return { ok: true };
}

export async function removeAdultPhoto(photoPath: string): Promise<{ ok: true }> {
  return removeOwnPhoto(photoPath, 'adult', 'removeAdultPhoto');
}

/**
 * Real erasure for a CHILD reference photo (was client-only before — the object survived).
 * Honours "remove any time" and feeds the retention model: with the path gone from
 * draft.photo_urls, the E1 draft-expiry reap has nothing to orphan.
 */
export async function removeChildPhoto(photoPath: string): Promise<{ ok: true }> {
  return removeOwnPhoto(photoPath, 'child', 'removeChildPhoto');
}

/** Real erasure for a PET reference photo (was client-only before — the object survived). */
export async function removePetPhoto(photoPath: string): Promise<{ ok: true }> {
  return removeOwnPhoto(photoPath, 'pet', 'removePetPhoto');
}

/**
 * COMPANION photo upload for CHILD books (companion un-gate, slice ④). A child-book
 * companion can itself be a child, so this carries the SAME child-photo safety as the
 * protagonist path: CHILD_PHOTO_ENABLED gate + consent (companion-v1) + fail-closed
 * moderation, BEFORE storing. (Pet-book companions keep uploadPetPhoto — no child gate.)
 * Companion photos live in draft.secondaries (client → submit), not photo_urls, so this
 * only stores + returns the path; the per-card consent record is written at submit.
 */
export async function uploadCompanionPhoto(formData: FormData): Promise<PhotoUploadResult> {
  if (!CHILD_PHOTO_ENABLED()) {
    console.error('[uploadCompanionPhoto] BLOCKED: child-photo path disabled');
    throw new Error(
      'Photo upload is not available. Child-photo upload is disabled pending our privacy and safety review.',
    );
  }
  const consentVersion = String(formData.get('consent_version') ?? '');
  if (!isConsentVersion(consentVersion)) {
    console.error('[uploadCompanionPhoto] BLOCKED: missing/invalid companion consent');
    throw new Error('Please confirm the parent/guardian consent checkbox before adding a photo.');
  }
  const file = formData.get('photo');
  if (!(file instanceof File)) throw new Error('uploadCompanionPhoto: no photo file');
  if (file.size > MAX_PHOTO_BYTES) {
    throw new Error(`uploadCompanionPhoto: photo is too large (max ${MAX_PHOTO_BYTES / 1024 / 1024}MB).`);
  }
  // Companions default to the person-NOT-required safety check: a child-book companion can be
  // a person OR a pet/animal/toy, and the companion-v1 consent already attests guardianship for
  // any child shown — so moderation need not enforce person-ness, only safety (explicit/violent/
  // not-a-genuine-photo). This also removes the "pick a type before uploading" UX trap (a blank
  // subject_type used to fall to the person prompt and reject a pet). The protagonist path
  // (uploadPhoto) keeps the person check — its hero is the child.
  const moderation = await moderateChildPhoto(Buffer.from(await file.arrayBuffer()), { allowNonHuman: true });
  if (!moderation.ok) {
    console.error(`[uploadCompanionPhoto] photo rejected by moderation (mode=${moderation.mode}, ${moderation.category}): ${moderation.reason}`);
    return { ok: false, reason: moderation.category };
  }
  const { photoPath, photoHash } = await storePhotoForDraft(formData, 'uploadCompanionPhoto');
  return { ok: true, photoPath, photoHash };
}

/**
 * Real erasure for a COMPANION photo (was client-only). Companion photos live in the
 * secondaries array (client state), so there is no photo_urls role to unlink — this just
 * deletes + verifies the object under the caller's own prefix.
 */
export async function removeCompanionPhoto(photoPath: string): Promise<{ ok: true }> {
  const cookieId = await getDraftCookieFromRequest();
  if (!cookieId) throw new Error('removeCompanionPhoto: no active session.');
  const draft = await getDraftByCookieId(cookieId);
  if (!draft) throw new Error('removeCompanionPhoto: no active session.');
  const ownPrefix = `${draftUploadPrefix(draft.id)}/`;
  if (!photoPath.startsWith(ownPrefix) || photoPath.includes('..')) {
    throw new Error('removeCompanionPhoto: not your photo.');
  }
  const client = createServerClient();
  await client.storage.from(PREVIEW_BUCKET).remove([photoPath]);
  const prefix = photoPath.slice(0, photoPath.lastIndexOf('/'));
  const name = photoPath.slice(photoPath.lastIndexOf('/') + 1);
  const { data } = await client.storage.from(PREVIEW_BUCKET).list(prefix, { search: name });
  if ((data ?? []).some((o) => o.name === name)) {
    console.error(`[removeCompanionPhoto] object still listed after delete: ${photoPath}`);
    throw new Error('removeCompanionPhoto: could not remove the photo. Please try again.');
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
  // SOFT-FAIL: a missing INNGEST_EVENT_KEY (e.g. an env-scope gap) or any Inngest/DB
  // error must NOT throw an unhandled error at the user — it degrades to a graceful
  // "preview unavailable, keep going" (empty previewId → the client shows a busy/keep-
  // going state and Continue is never blocked). Matters in Production too.
  try {
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
  } catch (err) {
    console.error('[requestPreview] generation dispatch failed — preview unavailable:', err instanceof Error ? err.message : String(err));
    return { previewId: '', status: 'failed', cached: false, blocked: 'unavailable' };
  }
}

export async function getPreviewStatus(previewId: string): Promise<PreviewResult> {
  // SOFT-FAIL: a transient DB error while polling must not throw an unhandled server
  // error — report 'failed' so the client's poll loop degrades gracefully.
  try {
    const job = await getPreviewJob(previewId);
    if (!job) return { previewId, status: 'failed', imageUrl: null, cached: false };
    return { previewId, status: job.status, imageUrl: job.image_url, bgColor: job.bg_color ?? null, cached: false };
  } catch (err) {
    console.error('[getPreviewStatus] poll failed:', err instanceof Error ? err.message : String(err));
    return { previewId, status: 'failed', imageUrl: null, cached: false };
  }
}

// ---- Character-picker: N book-faithful options per subject (Slice 2) -------------------
/**
 * Generate up to MAX_BATCH_OPTIONS book-faithful character options for ONE subject. Each
 * variant is an independent dice roll (distinct cache slot via the variant hash). All
 * cost guards are re-applied SERVER-SIDE and are BATCH-AWARE: a batch counts as one
 * request against the cap + rate-limit, so N parallel options can't self-throttle.
 * Ownership + photoPath confinement come from the caller's OWN cookie draft — never a
 * client-supplied id.
 */
export async function requestPreviewBatch(input: RequestPreviewBatchInput): Promise<PreviewBatchResult> {
  // CHARACTER_PICKER_ENABLED (server-side, fail-closed) — the REAL control. A UI gate alone
  // isn't (a Server Action id ships in the client bundle). OFF → no-op: no spend, no rows,
  // byte-identical to the picker not existing. Never NEXT_PUBLIC.
  if (process.env.CHARACTER_PICKER_ENABLED !== 'on') {
    return { batchId: '', options: [], blocked: 'disabled' };
  }
  const draft = await requireOwnDraft('requestPreviewBatch'); // cookie-derived; never trust the client
  const draftId = draft.id;

  // photoPaths must be the caller's own uploads. No photo → nothing to anchor.
  const ownPrefix = `${draftUploadPrefix(draftId)}/`;
  const photoPaths = (input.photoPaths ?? []).filter((p) => p.startsWith(ownPrefix) && !p.includes('..'));
  if (photoPaths.length === 0) {
    return { batchId: '', options: [], blocked: 'no_photos' };
  }

  // Batch-aware cap + rate-limit — count BATCHES, not images.
  if ((await countBatchesForDraft(draftId)) >= FREE_PREVIEW_CAP) {
    return { batchId: '', options: [], blocked: 'capped' };
  }
  const now = Date.now();
  const [burst, hourly] = await Promise.all([
    countBatchesForDraft(draftId, new Date(now - RATE_BURST_MS).toISOString()),
    countBatchesForDraft(draftId, new Date(now - RATE_HOUR_MS).toISOString()),
  ]);
  if (burst >= 1 || hourly >= RATE_HOURLY_MAX) {
    return { batchId: '', options: [], blocked: 'rate_limited' };
  }

  const count = Math.max(1, Math.min(input.count ?? MAX_BATCH_OPTIONS, MAX_BATCH_OPTIONS)); // server-capped
  const batchId = createHash('sha256').update(`${draftId}:${now}:${Math.random()}`).digest('hex').slice(0, 32);

  const options: PreviewBatchResult['options'] = [];
  for (let i = 0; i < count; i++) {
    // Fresh batchId ⇒ fresh variant hash ⇒ a real new dice roll (never a stale cache hit).
    const inputHash = computeInputHash({
      age: input.inputs.age ?? 0,
      gender: input.inputs.gender,
      features: input.inputs.features,
      freeText: input.inputs.appearance,
      style: input.artStyle,
      isAdult: input.inputs.is_adult,
      variant: `${batchId}:${i}`,
    });
    // SOFT-FAIL per option: a missing INNGEST_EVENT_KEY / Inngest / DB error marks THIS
    // option failed rather than throwing — the picker renders whatever landed and never
    // surfaces an unhandled error. If every option fails, the UI degrades to "try again".
    try {
      const job = await createPreviewJob({
        draftId,
        inputHash,
        inputs: { role: input.role, subject_type: input.inputs.subject_type, style: input.artStyle, hasPhoto: true },
        batchId,
        variantIndex: i,
      });
      await inngest.send({
        name: 'preview/requested',
        data: {
          previewId: job.id,
          mode: 'picker',
          role: input.role,
          inputs: input.inputs,
          artStyle: input.artStyle,
          photo_paths: photoPaths,
        },
      });
      options.push({ variant: i, previewId: job.id, status: 'queued' });
    } catch (err) {
      console.error(`[requestPreviewBatch] option ${i} dispatch failed — unavailable:`, err instanceof Error ? err.message : String(err));
      options.push({ variant: i, previewId: '', status: 'failed' });
    }
  }
  // Every option failed to dispatch → surface a blocked reason so the UI shows a clean
  // "unavailable, try again" rather than polling doomed rows.
  if (options.every((o) => o.status === 'failed')) {
    return { batchId, options, blocked: 'unavailable' };
  }
  return { batchId, options };
}

/**
 * Poll a picker batch. GRACEFUL: returns whatever has landed — done options carry their
 * imageUrl; still-running/failed ones report their status so the UI can render the ones
 * that succeeded and ignore the rest ("some failed → return the ones that landed").
 */
export async function getPreviewBatchStatus(batchId: string): Promise<PreviewBatchResult> {
  // SOFT-FAIL: a transient DB error while polling the batch must not throw an unhandled
  // server error — return an empty option set so the picker degrades gracefully.
  try {
    const rows = await getBatchRows(batchId);
    // Escalation signal (A): the worker records best-photo faceH on each option row; surface
    // the first non-null (same subject across the batch → same value).
    const faceQuality = rows.map((r) => r.face_quality).find((v) => v != null) ?? null;
    return {
      batchId,
      faceQuality,
      options: rows.map((r) => ({
        variant: r.variant_index ?? 0,
        previewId: r.id,
        status: r.status,
        imageUrl: r.image_url,
        bgColor: r.bg_color ?? null,
      })),
    };
  } catch (err) {
    console.error('[getPreviewBatchStatus] poll failed:', err instanceof Error ? err.message : String(err));
    return { batchId, options: [] };
  }
}

// ---- The pick: persist + resume (Slice 3) ----------------------------------------------
// Form secondary cards carry no stable id, so a companion subjectKey encodes its POSITION:
// 'companion-N' ↔ secondaries[N-1] — the SAME scheme the worker adapter synthesises
// (companion-{index+1}). Match by explicit id if present, else by this index. -1 = no match.
function companionIndex(subjectKey: string): number {
  const m = /companion-(\d+)/.exec(subjectKey);
  return m ? parseInt(m[1]!, 10) - 1 : -1;
}
function secondaryMatches(s: Record<string, unknown>, i: number, subjectKey: string): boolean {
  return s.id === subjectKey || s.secondary_id === subjectKey || i === companionIndex(subjectKey);
}

/**
 * Persist the customer's chosen option to draft.chosen_sheet (protagonist) or nest it into
 * the matching secondaries card. Ownership from the caller's OWN cookie draft. The pick is
 * OPTIONAL — it never gates Continue; it just locks the look.
 */
export async function persistChosenSheet(subjectKey: string, chosen: ChosenSheet | null): Promise<{ ok: true }> {
  const cookieId = await getDraftCookieFromRequest();
  if (!cookieId) throw new Error('persistChosenSheet: no active session.');
  const draft = await getDraftByCookieId(cookieId);
  if (!draft) throw new Error('persistChosenSheet: no active session.');

  if (subjectKey === 'protagonist') {
    await updateDraftByCookieId(cookieId, { chosen_sheet: chosen } as unknown as DraftUpdate);
  } else {
    const secondaries = Array.isArray((draft as { secondaries?: unknown }).secondaries)
      ? ((draft as { secondaries: Array<Record<string, unknown>> }).secondaries)
      : [];
    const next = secondaries.map((s, i) => (secondaryMatches(s, i, subjectKey) ? { ...s, chosen_sheet: chosen } : s));
    await updateDraftByCookieId(cookieId, { secondaries: next } as unknown as DraftUpdate);
  }
  return { ok: true };
}

/** Read a persisted pick back on wizard re-entry (resume into the PICKED state). */
export async function getChosenSheet(subjectKey: string): Promise<ChosenSheet | null> {
  const cookieId = await getDraftCookieFromRequest();
  if (!cookieId) return null;
  const draft = await getDraftByCookieId(cookieId);
  if (!draft) return null;
  if (subjectKey === 'protagonist') {
    return ((draft as { chosen_sheet?: ChosenSheet | null }).chosen_sheet) ?? null;
  }
  const secondaries = Array.isArray((draft as { secondaries?: unknown }).secondaries)
    ? ((draft as { secondaries: Array<Record<string, unknown>> }).secondaries)
    : [];
  const card = secondaries.find((s, i) => secondaryMatches(s, i, subjectKey));
  return (card?.chosen_sheet as ChosenSheet | null) ?? null;
}
