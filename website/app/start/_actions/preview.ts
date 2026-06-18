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

/**
 * Photo mode (TEST-WIRING ONLY). Uploads a PNG to the previews bucket and returns
 * its path + content-hash (so identical photos cache). The browser converts the
 * chosen image to PNG before calling this.
 *
 * ⚠️ NOT launch-ready. Real CHILD-photo upload is gated behind the banked
 * privacy / consent / content-safety workstream ([[project_photo-likeness-probe]]).
 * This exists so Adro can test the photo path with his own photo — it must not be
 * exposed to real customers without that review.
 */
export async function uploadPhoto(formData: FormData): Promise<{ photoPath: string; photoHash: string }> {
  const file = formData.get('photo');
  if (!(file instanceof File)) throw new Error('uploadPhoto: no photo file');
  const bytes = Buffer.from(await file.arrayBuffer());
  const photoHash = createHash('sha256').update(bytes).digest('hex');
  const photoPath = `uploads/${photoHash}.png`;
  const { error } = await createServerClient().storage
    .from(PREVIEW_BUCKET)
    .upload(photoPath, bytes, { contentType: 'image/png', upsert: true });
  if (error) throw new Error(`uploadPhoto failed: ${error.message}`);
  return { photoPath, photoHash };
}

export async function requestPreview(input: RequestPreviewInput): Promise<PreviewResult> {
  const inputHash = computeInputHash(input);

  // Cache: an identical-input preview was already minted → reuse it, no spend.
  const cached = await findCachedPreview(inputHash);
  if (cached) {
    return { previewId: cached.id, status: 'done', imageUrl: cached.image_url, cached: true };
  }

  // ---- S-E cost-control: a NEW gen (cache miss) is about to spend ~$0.04. -----
  // Every preview must be attributable to a draft so the cap/rate-limit have a
  // key (an anonymous flood with no draft would dodge both).
  const draftId = input.draftId;
  if (!draftId) {
    return { previewId: '', status: 'failed', cached: false, blocked: 'capped' };
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
    },
  });

  return { previewId: job.id, status: 'queued', cached: false };
}

export async function getPreviewStatus(previewId: string): Promise<PreviewResult> {
  const job = await getPreviewJob(previewId);
  if (!job) return { previewId, status: 'failed', imageUrl: null, cached: false };
  return { previewId, status: job.status, imageUrl: job.image_url, cached: false };
}
