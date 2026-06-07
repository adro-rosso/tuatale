// worker/src/storage.js — upload the generated book PDF + mint signed URLs.
//
// Bucket: tuatale-books (created by the SQL migration). Path convention:
//   orders/{orderId}/book.pdf   — one PDF per order; retry overwrites (upsert).
//
// URL expiry vs file retention are separate (B.2): we return a 7-DAY signed URL
// for customer access; the file itself is kept indefinitely so a fresh URL can
// be re-signed later (regenerateSignedUrl) without re-running the pipeline.

import { getClient } from "./db.js";

export const BUCKET = "tuatale-books";
const SIGNED_URL_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days

/** Storage path for an order's book PDF. */
export function bookPdfPath(orderId) {
  return `orders/${orderId}/book.pdf`;
}

/**
 * Upload the book PDF bytes and return a 7-day signed URL.
 *
 * @param {object} args
 * @param {string} args.orderId
 * @param {Buffer|Uint8Array} args.pdfBytes
 * @returns {Promise<{ pdfUrl: string, storagePath: string }>}
 */
export async function uploadBookPdf({ orderId, pdfBytes }) {
  const path = bookPdfPath(orderId);

  const { error: uploadError } = await getClient()
    .storage.from(BUCKET)
    .upload(path, pdfBytes, {
      contentType: "application/pdf",
      upsert: true, // overwrite the previous attempt on retry/regenerate
    });
  if (uploadError) {
    throw new Error(`PDF upload failed (${path}): ${uploadError.message}`);
  }

  const { data, error: signError } = await getClient()
    .storage.from(BUCKET)
    .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
  if (signError) {
    throw new Error(`Signed URL generation failed (${path}): ${signError.message}`);
  }

  return { pdfUrl: data.signedUrl, storagePath: path };
}

/**
 * Re-sign an existing book PDF (used when admin needs a fresh link after the
 * 7-day URL expires — the file is retained indefinitely, so this always works
 * as long as the object exists).
 *
 * @param {string} storagePath  e.g. "orders/<id>/book.pdf"
 * @returns {Promise<string>} a new signed URL
 */
export async function regenerateSignedUrl(storagePath) {
  const { data, error } = await getClient()
    .storage.from(BUCKET)
    .createSignedUrl(storagePath, SIGNED_URL_TTL_SECONDS);
  if (error) {
    throw new Error(`Signed URL regeneration failed (${storagePath}): ${error.message}`);
  }
  return data.signedUrl;
}
