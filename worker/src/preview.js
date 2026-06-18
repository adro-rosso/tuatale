// worker/src/preview.js — whole-character PREVIEW generation on the worker.
//
// Triggered by the `preview/requested` Inngest event (see server.js). Reuses the
// proven engine: ../../src/character-preview.js (composeAppearance / photo view-0
// → ONE generateImage). Uploads the PNG to the tuatale-previews bucket and marks
// the preview_jobs row done/failed. The website polls the row.

import { getClient } from "./db.js";
import { generateCharacterPreview as realGenerateCharacterPreview } from "../../src/character-preview.js";

export const PREVIEW_BUCKET = "tuatale-previews";
const SIGNED_URL_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days

export function previewImagePath(previewId) {
  return `previews/${previewId}.png`;
}

// ---- preview_jobs row transitions -----------------------------------------
export async function getPreviewById(previewId) {
  const { data, error } = await getClient()
    .from("preview_jobs").select("*").eq("id", previewId).single();
  if (error) throw new Error(`getPreviewById(${previewId}) failed: ${error.message}`);
  return data;
}

export async function markPreviewRunning(previewId) {
  // Clear completed_at + error_message: on an Inngest RETRY the row may carry a prior
  // failed attempt's completed_at, and a fresh started_at later than it would violate
  // the completed_at >= started_at check. Re-starting resets the run cleanly.
  const { error } = await getClient().from("preview_jobs")
    .update({ status: "running", started_at: new Date().toISOString(), completed_at: null, error_message: null })
    .eq("id", previewId);
  if (error) throw new Error(`markPreviewRunning(${previewId}) failed: ${error.message}`);
}

export async function markPreviewDone(previewId, { imageUrl }) {
  const { error } = await getClient().from("preview_jobs")
    .update({ status: "done", image_url: imageUrl, completed_at: new Date().toISOString() })
    .eq("id", previewId);
  if (error) throw new Error(`markPreviewDone(${previewId}) failed: ${error.message}`);
}

export async function markPreviewFailed(previewId, { errorMessage }) {
  const { error } = await getClient().from("preview_jobs")
    .update({ status: "failed", error_message: errorMessage, completed_at: new Date().toISOString() })
    .eq("id", previewId);
  if (error) throw new Error(`markPreviewFailed(${previewId}) failed: ${error.message}`);
}

// ---- storage ---------------------------------------------------------------
export async function uploadPreviewImage({ previewId, pngBytes }) {
  const path = previewImagePath(previewId);
  const { error: upErr } = await getClient().storage.from(PREVIEW_BUCKET)
    .upload(path, pngBytes, { contentType: "image/png", upsert: true });
  if (upErr) throw new Error(`preview upload failed (${path}): ${upErr.message}`);
  const { data, error: signErr } = await getClient().storage.from(PREVIEW_BUCKET)
    .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
  if (signErr) throw new Error(`preview signed URL failed (${path}): ${signErr.message}`);
  return data.signedUrl;
}

// Photo mode: the website uploads a PNG to the bucket and passes its path. We
// download the bytes as the view-0 anchor. (Contract: the website uploads PNG.)
export async function downloadPhoto(photoPath) {
  const { data, error } = await getClient().storage.from(PREVIEW_BUCKET).download(photoPath);
  if (error) throw new Error(`photo download failed (${photoPath}): ${error.message}`);
  return Buffer.from(await data.arrayBuffer());
}

/**
 * Orchestrate one preview: mark running → mint → upload → mark done. On any
 * failure marks the row failed and rethrows (so Inngest's onFailure can log).
 * Deps injectable for unit tests.
 */
export async function runPreview(event, deps = {}) {
  const {
    generateCharacterPreview = realGenerateCharacterPreview,
    markRunning = markPreviewRunning,
    markDone = markPreviewDone,
    markFailed = markPreviewFailed,
    upload = uploadPreviewImage,
    getPhoto = downloadPhoto,
  } = deps;
  const { previewId, age, name, features, freeText, background, style, photoPath } = event;
  try {
    await markRunning(previewId);
    const photoBuf = photoPath ? await getPhoto(photoPath) : undefined;
    const png = await generateCharacterPreview(
      { age, name, features, freeText, background, style, photoBuf },
      { callKind: "preview_mint", subjectName: `preview-${previewId}` },
    );
    const imageUrl = await upload({ previewId, pngBytes: png });
    await markDone(previewId, { imageUrl });
    return { previewId, status: "done", imageUrl };
  } catch (err) {
    try { await markFailed(previewId, { errorMessage: err?.message ?? "preview failed" }); }
    catch (markErr) { console.error("[runPreview] markFailed threw", { previewId, markErr }); }
    throw err;
  }
}
