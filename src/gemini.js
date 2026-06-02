// src/gemini.js
// Thin wrapper around the @google/genai SDK. The ONLY file in this project
// that talks directly to Google. All API details — model name, request/
// response shape, error handling — live here so they can be changed in
// one place.

import { GoogleGenAI, Modality, ApiError } from "@google/genai";
import { Agent, setGlobalDispatcher } from "undici";
import { callWithRetry as sharedCallWithRetry } from "./wall-ceiling.js";

// Model verified May 2026 against ai.google.dev/gemini-api/docs/image-generation.
// 'gemini-3.1-flash-image-preview' is Google's recommended image-gen model
// and supports up to 4 character reference images for consistency.
// To swap models (e.g. fall back to the GA 'gemini-2.5-flash-image'),
// change just this constant — no other code in the project knows the name.
export const MODEL = "gemini-3.1-flash-image-preview";

// NOTE: src/index.js MUST `import "dotenv/config"` before importing this file,
// otherwise process.env.GEMINI_API_KEY will be undefined when this line runs.
const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  throw new Error(
    "GEMINI_API_KEY is not set. Make sure src/index.js imports 'dotenv/config' before importing this module."
  );
}

// Configure undici — Node's built-in HTTP client — to wait longer for response
// headers. Default is 300s (5 min). The Gemini image API can take 200s+ on a
// single attempt for image-with-references calls, so we bump headers/body
// timeouts to 10 min. Without this, undici aborts the fetch with
// UND_ERR_HEADERS_TIMEOUT regardless of any SDK-level timeout setting.
//
// Known SDK bug: googleapis/js-genai#1277 — httpOptions.timeout is wired up
// to an AbortController but does not adjust undici's internal headersTimeout.
// setGlobalDispatcher is the standard workaround per undici's docs.
setGlobalDispatcher(
  new Agent({
    headersTimeout: 600_000, // 10 min: how long to wait for response headers
    bodyTimeout: 600_000,    // 10 min: how long to wait for the full body
    connectTimeout: 30_000,  // 30s: keep tight — TCP/TLS issues should fail fast
  })
);

// We deliberately DON'T set httpOptions.retryOptions. That would activate the
// SDK's pRetry layer, which (a) has no per-status filtering — it would retry
// 429s as well as 5xx — and (b) wraps errors as generic Error('Retryable HTTP
// Error: ...'), discarding the status code. Without it, the SDK uses plain
// fetch and surfaces structured ApiError(.status), which our retry helper
// below uses to decide what's retryable.
const ai = new GoogleGenAI({ apiKey });

// Selective retry policy:
//   - Retry on 5xx (500, 502, 503, 504) — transient Google-side failures.
//   - Retry on fast network errors (ECONNRESET, ETIMEDOUT) — quick to discover.
//   - Retry ONCE on slow undici timeouts — they already burned 10 min each;
//     two retries would push worst-case wall time past 30 min per call.
//   - Do NOT retry on 429 — that's our pacing problem and we want it visible.
const RETRYABLE_5XX = [500, 502, 503, 504];
const FAST_NETWORK_CODES = ["ECONNRESET", "ETIMEDOUT"];
const SLOW_TIMEOUT_CODES = ["UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT"];

// Backoff schedules — list length = max retries for that category.
const BACKOFF_CHEAP = [5000, 15000];   // 5xx + fast network: 2 retries
const BACKOFF_AFTER_TIMEOUT = [10000]; // slow timeouts + "fetch failed": 1 retry

/**
 * Classify an error into a retry category. Returns null if not retryable
 * (e.g. 429, 4xx other than 408, validation errors, unknown shapes).
 */
function classifyError(err) {
  const status = err instanceof ApiError ? err.status : null;
  if (status !== null && RETRYABLE_5XX.includes(status)) {
    return { reason: `${status} from Google`, backoffs: BACKOFF_CHEAP };
  }
  const code = err?.cause?.code;
  if (code && FAST_NETWORK_CODES.includes(code)) {
    return { reason: `network error (${code})`, backoffs: BACKOFF_CHEAP };
  }
  if (code && SLOW_TIMEOUT_CODES.includes(code)) {
    return { reason: `network error (${code})`, backoffs: BACKOFF_AFTER_TIMEOUT };
  }
  // Catch-all for any other "fetch failed" — treat as a slow timeout because
  // we can't tell how much wall time it already burned.
  if (typeof err?.message === "string" && err.message.includes("fetch failed")) {
    return {
      reason: `network error (${code ?? "fetch failed"})`,
      backoffs: BACKOFF_AFTER_TIMEOUT,
    };
  }
  return null;
}

// Thin adapter that binds Gemini's classifyError to the shared wall-ceiling
// runner. Kept as a local function so existing call sites (generateImage)
// don't need to know about classifyError plumbing.
function callWithRetry(fn, callContext = {}) {
  return sharedCallWithRetry(fn, callContext, classifyError);
}

/**
 * Generate a single image with Gemini.
 *
 * @param {string} prompt - The text prompt describing what to draw.
 * @param {Buffer[]} [referenceImages=[]] - Optional PNG buffers passed as
 *   visual references. For character consistency, pass the character-sheet
 *   images here. The model accepts up to 4 character reference images.
 * @param {object} [options={}]
 * @param {string} [options.aspectRatio] - Optional Gemini aspectRatio hint.
 *   Supported by @google/genai v1.52+: "1:1" | "2:3" | "3:2" | "3:4" |
 *   "4:3" | "9:16" | "16:9" | "21:9". Omitted = let Gemini choose (the
 *   historical behavior — observed to vary between 1408×768 and 1168×912
 *   on the same prompt). Pinning is the clean fix when a template's
 *   on-page geometry depends on the painted-vignette landing in a
 *   specific frame proportion (see prompt-7-iter-1).
 * @param {object} [callContext={}] - Optional wall-ceiling + status context.
 *   Pass { callKind: "sheet_mint"|"page_render", subjectName?, view?,
 *   pageNumber?, onSlowCall? } to make the call's failure mode legible
 *   (structured WallCeilingError after 5min) and to wire status.json
 *   slow_call + retry events. Omitted = ceiling still enforced, but the
 *   structured error has minimal context and no status events fire.
 * @returns {Promise<Buffer>} The generated PNG as raw bytes, ready to be
 *   written to disk with fs.writeFileSync(path, buffer).
 */
export async function generateImage(prompt, referenceImages = [], options = {}, callContext = {}) {
  // Build the multimodal `contents` array. Each entry is a "Part" — either
  // a text part or an inlineData part wrapping a base64-encoded image.
  // We put the text first, then any reference images.
  const parts = [
    { text: prompt },
    ...referenceImages.map((buf) => ({
      inlineData: {
        data: buf.toString("base64"),
        mimeType: "image/png",
      },
    })),
  ];

  const requestConfig = {
    // Image-capable models can return text OR images. Without this line,
    // the model sometimes returns a description of what it would have drawn
    // instead of the image itself.
    responseModalities: [Modality.IMAGE],
  };
  if (options.aspectRatio) {
    requestConfig.imageConfig = { aspectRatio: options.aspectRatio };
  }

  const response = await callWithRetry(
    () => ai.models.generateContent({
      model: MODEL,
      contents: parts,
      config: requestConfig,
    }),
    callContext,
  );

  // Pull the image out of the response. Shape:
  //   response.candidates[0].content.parts[] -> mix of { text } and { inlineData }
  // We want the first inlineData part (the PNG).
  const responseParts = response?.candidates?.[0]?.content?.parts ?? [];
  const imagePart = responseParts.find((p) => p.inlineData?.data);

  if (!imagePart) {
    // Surface diagnostics without leaking the prompt or any secret.
    const blockReason = response?.promptFeedback?.blockReason;
    throw new Error(
      `No image returned from Gemini.${blockReason ? ` Prompt was blocked: ${blockReason}.` : ""} ` +
      `Response parts received: ${
        responseParts.map((p) => Object.keys(p).join("|")).join(", ") || "none"
      }.`
    );
  }

  // Decode the base64 payload to a Node Buffer.
  return Buffer.from(imagePart.inlineData.data, "base64");
}
