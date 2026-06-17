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
import { findCachedPreview, createPreviewJob, getPreviewJob } from '@/lib/preview/preview-jobs';
import type { RequestPreviewInput, PreviewResult } from '@/lib/preview/types';

const PREVIEW_BUCKET = 'tuatale-previews';

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

  // Miss: create the queued row + dispatch the worker.
  const job = await createPreviewJob({
    draftId: input.draftId ?? null,
    inputHash,
    inputs: {
      age: input.age,
      gender: input.gender,
      features: input.features,
      freeText: input.freeText,
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
