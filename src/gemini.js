// src/gemini.js
// Thin wrapper around the @google/genai SDK. The ONLY file in this project
// that talks directly to Google. All API details — model name, request/
// response shape, error handling — live here so they can be changed in
// one place.

import { GoogleGenAI, Modality, ApiError } from "@google/genai";
import { Agent, setGlobalDispatcher } from "undici";
import { callWithRetry as sharedCallWithRetry } from "./wall-ceiling.js";

// Model verified May 2026 against ai.google.dev/gemini-api/docs/image-generation.
// 'gemini-3.1-flash-image-preview' is Google's recommended image-gen model.
// It accepts MORE than 4 reference images (the old "up to 4" was a legacy
// assumption; 6 validated 2026-07-01 via scripts/_refceiling-probe.mjs — the
// allocator now hands each subject up to 2 refs, so N=3 sends 6 and N=4 sends 8).
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

// Base retry policy (SDK error shapes):
//   - Retry on 5xx (500, 502, 503, 504) — transient Google-side failures.
//   - Retry on fast network errors (ECONNRESET, ETIMEDOUT) — quick to discover.
//   - Retry ONCE on slow undici timeouts.
//   - Do NOT retry 429 RESOURCE_EXHAUSTED — credits/pacing; fail-fast and let it
//     surface (D2 fatal-stop classifies it as blocked-on-credits).
const RETRYABLE_5XX = [500, 502, 503, 504];
const FAST_NETWORK_CODES = ["ECONNRESET", "ETIMEDOUT"];
const SLOW_TIMEOUT_CODES = ["UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT"];
const BACKOFF_CHEAP = [5000, 15000];   // 5xx + fast network: 2 retries
const BACKOFF_AFTER_TIMEOUT = [10000]; // slow timeouts + "fetch failed": 1 retry

function baseClassify(err) {
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
  if (typeof err?.message === "string" && err.message.includes("fetch failed")) {
    return { reason: `network error (${code ?? "fetch failed"})`, backoffs: BACKOFF_AFTER_TIMEOUT };
  }
  return null; // 429 and everything else: not retryable → fail-fast
}

// ---- Fail-fast + retry + hedge (2026-07-07) --------------------------------
// The Gemini image API periodically STALLS: a call hangs with no response until
// the 300s wall ceiling, turning a transient blip into a hard failure. We add a
// PER-ATTEMPT timeout that aborts a hung call fast (via the SDK abortSignal) and
// retries WITHIN the same wall ceiling — so a brief stall recovers instead of
// failing. wall-ceiling.js is untouched: the per-attempt abort lives here in the
// thunk, and its timeout is just another retryable error class.
//
// Parameterized per caller so the BOOK reliability contract is preserved:
//   - BOOK retries stay inside the shared 300s ceiling (no wallCeilingMs override),
//     and timeoutBackoffs is long enough that the CEILING — not backoff exhaustion
//     — terminates a SUSTAINED outage → the bubbled error stays a WallCeilingError
//     (→ D2 fatal-stop + R3 resume, unchanged). Only BRIEF stalls now recover.
//   - 429 is never retried (baseClassify → null); D2 still sees the 429 → fatal.
//   - PREVIEW is aggressive: short attempts, more retries, a lower ceiling, and a
//     2× HEDGE (parallel branches, first success wins). Hedge is PREVIEW-ONLY.
class AttemptTimeoutError extends Error {
  constructor(ms) { super(`attempt exceeded ${Math.round(ms / 1000)}s per-attempt timeout (hang)`); this.name = "AttemptTimeoutError"; this.isAttemptTimeout = true; }
}
class HedgeCancelledError extends Error {
  constructor() { super("hedge branch cancelled (a sibling attempt won)"); this.name = "HedgeCancelledError"; this.isHedgeCancelled = true; }
}

const RETRY_PROFILES = {
  // perAttemptMs: abort one attempt after this long → retry.
  // timeoutBackoffs: retry schedule for per-attempt timeouts (list length = max retries).
  // wallCeilingMs: PREVIEW lowers it (fail-fast interactive path); BOOK omits it → shared 300s.
  // hedge: parallel branches (PREVIEW only; 1 = no hedge).
  preview: { perAttemptMs: 45_000, timeoutBackoffs: [1000, 1000, 1000], wallCeilingMs: 135_000, hedge: 2 },
  book:    { perAttemptMs: 70_000, timeoutBackoffs: [1500, 1500, 1500, 1500, 1500, 1500], hedge: 1 },
};
function profileFor(callKind) {
  return callKind === "preview_mint" ? RETRY_PROFILES.preview : RETRY_PROFILES.book;
}

function isCreditError(err) {
  const status = (err instanceof ApiError ? err.status : null) ?? err?.status ?? err?.last_error?.status ?? null;
  return status === 429 || (typeof err?.message === "string" && err.message.includes("RESOURCE_EXHAUSTED"));
}

function buildRequest(prompt, referenceImages, options) {
  const parts = [
    { text: prompt },
    ...referenceImages.map((buf) => ({ inlineData: { data: buf.toString("base64"), mimeType: "image/png" } })),
  ];
  const config = { responseModalities: [Modality.IMAGE] };
  if (options.aspectRatio) config.imageConfig = { aspectRatio: options.aspectRatio };
  return { parts, config };
}

function extractImage(response) {
  const responseParts = response?.candidates?.[0]?.content?.parts ?? [];
  const imagePart = responseParts.find((p) => p.inlineData?.data);
  if (!imagePart) {
    const blockReason = response?.promptFeedback?.blockReason;
    throw new Error(
      `No image returned from Gemini.${blockReason ? ` Prompt was blocked: ${blockReason}.` : ""} ` +
      `Response parts received: ${responseParts.map((p) => Object.keys(p).join("|")).join(", ") || "none"}.`
    );
  }
  return Buffer.from(imagePart.inlineData.data, "base64");
}

// One generation branch: per-attempt fail-fast + retry inside the wall ceiling.
// externalSignal (hedge) aborts this branch when a sibling wins → non-retryable.
async function generateBranch(prompt, referenceImages, options, callContext, deps, externalSignal) {
  const { parts, config } = buildRequest(prompt, referenceImages, options);
  const profile = profileFor(callContext.callKind);
  const perAttemptMs = callContext.perAttemptTimeoutMs ?? profile.perAttemptMs;
  const genContent = deps.generateContent ?? ((args) => ai.models.generateContent(args));

  const thunk = () => {
    const ac = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; ac.abort(); }, perAttemptMs);
    const onExternal = () => ac.abort();
    if (externalSignal) {
      if (externalSignal.aborted) ac.abort();
      else externalSignal.addEventListener("abort", onExternal, { once: true });
    }
    return genContent({ model: MODEL, contents: parts, config: { ...config, abortSignal: ac.signal } })
      .catch((err) => {
        if (timedOut) throw new AttemptTimeoutError(perAttemptMs);
        if (externalSignal?.aborted) throw new HedgeCancelledError();
        throw err;
      })
      .finally(() => {
        clearTimeout(timer);
        if (externalSignal) externalSignal.removeEventListener("abort", onExternal);
      });
  };

  const classify = (err) => {
    if (err?.isHedgeCancelled) return null;                                       // cancelled loser: stop
    if (err?.isAttemptTimeout) return { reason: "per-attempt timeout (hang)", backoffs: profile.timeoutBackoffs };
    return baseClassify(err);                                                     // 429 → null (fail-fast)
  };

  const ctx = { ...callContext, wallCeilingMs: callContext.wallCeilingMs ?? profile.wallCeilingMs };
  const response = await sharedCallWithRetry(thunk, ctx, classify);
  return extractImage(response);
}

/**
 * Generate a single image with Gemini.
 *
 * @param {string} prompt - The text prompt describing what to draw.
 * @param {Buffer[]} [referenceImages=[]] - Optional PNG buffers passed as
 *   visual references. For character consistency, pass the character-sheet
 *   images here. The model accepts more than 4 reference images (see MODEL note).
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
 * @param {object} [deps] - Test seam: { generateContent } overrides the SDK
 *   call so retry/hedge behaviour can be exercised without hitting Google.
 * @returns {Promise<Buffer>} The generated PNG as raw bytes, ready to be
 *   written to disk with fs.writeFileSync(path, buffer).
 */
export async function generateImage(prompt, referenceImages = [], options = {}, callContext = {}, deps = {}) {
  const profile = profileFor(callContext.callKind);

  // PREVIEW: hedge — N parallel branches, first success wins, cancel the losers.
  // Never used for book pages (book profile hedge = 1).
  if (profile.hedge > 1) {
    const controllers = Array.from({ length: profile.hedge }, () => new AbortController());
    const branches = controllers.map((ac) =>
      generateBranch(prompt, referenceImages, options, callContext, deps, ac.signal));
    branches.forEach((p) => p.catch(() => {})); // swallow post-win loser rejections (no unhandledRejection)
    try {
      const winner = await Promise.any(branches);
      controllers.forEach((ac) => ac.abort()); // cancel the losing branches
      return winner;
    } catch (agg) {
      const errs = agg?.errors ?? [agg];
      const credit = errs.find(isCreditError);            // fail-fast on credits: surface "top up"
      if (credit) throw credit;
      const real = errs.find((e) => !(e instanceof HedgeCancelledError));
      throw real ?? errs[0];
    }
  }

  // BOOK / default: a single fail-fast+retry branch inside the 300s ceiling.
  return generateBranch(prompt, referenceImages, options, callContext, deps, null);
}
