// src/anthropic.js
// Thin wrapper around the @anthropic-ai/sdk. The ONLY file in this project
// that talks directly to Anthropic. All API details — model name, request/
// response shape, retry policy, error handling, system prompt, brand-style
// constants — live here so they can be changed in one place. Mirror of
// src/gemini.js for the Anthropic path.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";
import { composeAppearance, composeMarkClause } from "./character-features.js";
import { resolveStyle, COMPOSITION_RULES, NEGATIVE_PROMPT } from "./art-styles.js";
import { loadTemplateRegistry, buildTemplateMetadataForPrompt } from "./template-registry.js";
import { callWithRetry as sharedCallWithRetry } from "./wall-ceiling.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FAILED_DIR = path.join(__dirname, "..", "output", "stories", "_failed");

/**
 * Structured error thrown when Sonnet's response is truncated by max_tokens.
 * Carries the captured diagnostic path so callers can finalize status.json
 * with a specific failure reason and the website can show a specific message.
 *
 * Item 2 (2026-06-01). Mirrors the WallCeilingError pattern from Item 1b.
 */
export class MaxTokensError extends Error {
  constructor({ maxTokensConfigured, tokensUsed, inputSummary, capturedToPath, stopReason }) {
    const usedStr = tokensUsed != null ? String(tokensUsed) : "unknown";
    super(
      `Sonnet response truncated by max_tokens (${maxTokensConfigured}). ` +
      `Output tokens used: ${usedStr}. ` +
      `Diagnostic captured to: ${capturedToPath}.`
    );
    this.name = "MaxTokensError";
    this.kind = "max_tokens_truncation";
    this.max_tokens_configured = maxTokensConfigured;
    this.tokens_used = tokensUsed ?? null;
    this.input_summary = inputSummary;
    this.captured_to = capturedToPath;
    this.stop_reason = stopReason;
  }
  toJSON() {
    return {
      kind: this.kind,
      message: this.message,
      max_tokens_configured: this.max_tokens_configured,
      tokens_used: this.tokens_used,
      input_summary: this.input_summary,
      captured_to: this.captured_to,
      stop_reason: this.stop_reason,
    };
  }
}

/**
 * Structured error thrown when Sonnet refuses to generate a response (safety
 * filter triggered, system-prompt conflict, etc). Mirrors MaxTokensError so
 * the script's finalize path routes it via the duck-typed err.toJSON() flow.
 *
 * Item 5 F3 (2026-06-01). The pre-Item-5 refusal branch threw a generic Error
 * with just the safety category — customer couldn't see what triggered it
 * and had no diagnostic to fix the input.
 */
export class RefusalError extends Error {
  constructor({ safetyCategory, tokensUsed, inputSummary, capturedToPath }) {
    super(
      `Sonnet refused the request (safety category: ${safetyCategory ?? "unspecified"}). ` +
      `Diagnostic captured to: ${capturedToPath}.`
    );
    this.name = "RefusalError";
    this.kind = "refusal";
    this.safety_category = safetyCategory ?? "unspecified";
    this.tokens_used = tokensUsed ?? null;
    this.input_summary = inputSummary;
    this.captured_to = capturedToPath;
  }
  toJSON() {
    return {
      kind: this.kind,
      message: this.message,
      safety_category: this.safety_category,
      tokens_used: this.tokens_used,
      input_summary: this.input_summary,
      captured_to: this.captured_to,
    };
  }
}

/**
 * Capture a Sonnet refusal to disk. Includes the SENT system prompt + user
 * message (essential for the customer to know what to change) plus the raw
 * response, safety category, and usage.
 *
 * @param {object} opts
 * @param {object} opts.rawResponse Full Sonnet response.
 * @param {string} opts.systemPrompt The system prompt that was sent.
 * @param {string} opts.userMessage The user message that was sent.
 * @param {string} opts.safetyCategory Refusal category from stop_details.
 * @param {object} opts.inputSummary
 * @param {string} [opts.failureDir] Override for tests.
 * @returns {string} Absolute path of the captured diagnostic file.
 */
export function captureRefusalFailure({ rawResponse, systemPrompt, userMessage, safetyCategory, inputSummary, failureDir = FAILED_DIR }) {
  fs.mkdirSync(failureDir, { recursive: true });
  const tsForName = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = `${tsForName}-refusal.json`;
  const filePath = path.join(failureDir, filename);
  const payload = {
    kind: "refusal",
    timestamp: new Date().toISOString(),
    safety_category: safetyCategory ?? null,
    tokens_used: rawResponse?.usage?.output_tokens ?? null,
    input_tokens: rawResponse?.usage?.input_tokens ?? null,
    system_prompt: systemPrompt,
    user_message: userMessage,
    raw_response: rawResponse,
    input_summary: inputSummary,
    captured_to: filePath,
  };
  const tmpPath = `${filePath}.tmp`;
  const content = JSON.stringify(payload, null, 2);
  const fd = fs.openSync(tmpPath, "w");
  try {
    fs.writeSync(fd, content);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmpPath, filePath);
  return filePath;
}

/**
 * Atomic write of a max_tokens truncation diagnostic to disk. Uses the same
 * .tmp + fsync + rename pattern as src/status-writer.js so a crash mid-write
 * doesn't leave a partial file.
 *
 * @param {object} opts
 * @param {object} opts.rawResponse Full Sonnet response (including partial content blocks).
 * @param {object} opts.inputSummary { protagonist, subjects_count, scenes_requested, theme }
 * @param {number} opts.maxTokensConfigured The MAX_TOKENS value at the time of the call.
 * @param {string} [opts.failureDir] Override target directory (defaults to FAILED_DIR).
 *   Used by tests to redirect into a tmp dir.
 * @returns {string} The absolute path of the captured diagnostic file.
 */
export function captureMaxTokensFailure({ rawResponse, inputSummary, maxTokensConfigured, failureDir = FAILED_DIR }) {
  fs.mkdirSync(failureDir, { recursive: true });
  const tsForName = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = `${tsForName}-max-tokens-truncation.json`;
  const filePath = path.join(failureDir, filename);
  const payload = {
    kind: "max_tokens_truncation",
    timestamp: new Date().toISOString(),
    max_tokens_configured: maxTokensConfigured,
    tokens_used: rawResponse?.usage?.output_tokens ?? null,
    input_tokens: rawResponse?.usage?.input_tokens ?? null,
    raw_response: rawResponse,
    input_summary: inputSummary,
    stop_reason: rawResponse?.stop_reason ?? null,
    captured_to: filePath,
  };
  const tmpPath = `${filePath}.tmp`;
  const content = JSON.stringify(payload, null, 2);
  const fd = fs.openSync(tmpPath, "w");
  try {
    fs.writeSync(fd, content);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmpPath, filePath);
  return filePath;
}

// ---- Model -----------------------------------------------------------------
// Locked 2026-05-15 for MVP Week 1. Verified via /v1/models/claude-sonnet-4-6
// on the same day. Bare alias — Anthropic explicitly warns against appending
// date suffixes (the alias auto-points to the latest version).
export const MODEL = "claude-sonnet-4-6";

// ---- Auth ------------------------------------------------------------------
// NOTE: the script entry point MUST `import "dotenv/config"` before importing
// this file, otherwise process.env.ANTHROPIC_API_KEY will be undefined here.
const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) {
  throw new Error(
    "ANTHROPIC_API_KEY is not set. Make sure the script entry point imports 'dotenv/config' before importing this module."
  );
}

// ---- SDK client ------------------------------------------------------------
// maxRetries: 0 — disable the SDK's built-in retry (default 2). We layer our
// own selective retry below, so we have control over which statuses bounce.
// Specifically: we never retry 429 (rate-limit) — pacing problems should be
// visible, not silently smoothed.
const client = new Anthropic({
  apiKey,
  maxRetries: 0,
  // 5 min per request — bumped from 180_000 (2026-05-28) after the
  // robustness batch saw adaptive-thinking generations (and high-
  // concurrency queueing) push past 3 min, hard-failing with no retry.
  // Paired with the classifyError widening below, SDK timeouts now also
  // retry once instead of propagating to the user.
  timeout: 300_000,
});

// ---- Retry policy ----------------------------------------------------------
// Mirror of src/gemini.js. 5xx + network errors retry; 429 never does.
// 529 is Anthropic's "overloaded" status (per their error-code reference) —
// included in the retryable 5xx set.
const RETRYABLE_5XX = [500, 502, 503, 504, 529];
const FAST_NETWORK_CODES = ["ECONNRESET", "ETIMEDOUT"];
const SLOW_TIMEOUT_CODES = ["UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT"];

// Backoff schedules — list length = max retries for that category.
const BACKOFF_CHEAP = [5000, 15000];   // 5xx + fast network: 2 retries
const BACKOFF_AFTER_TIMEOUT = [10000]; // slow timeouts + generic "fetch failed": 1 retry

/**
 * Classify an error into a retry category. Returns null if not retryable
 * (e.g. 429, 401, 400, validation errors, unknown shapes).
 *
 * The Anthropic SDK throws Anthropic.APIError subclasses (RateLimitError,
 * APIConnectionError, etc.) with .status populated for HTTP errors and
 * .cause?.code populated for raw network errors. We inspect both.
 */
function classifyError(err) {
  const status = err?.status ?? null;
  if (status !== null && RETRYABLE_5XX.includes(status)) {
    return { reason: `${status} from Anthropic`, backoffs: BACKOFF_CHEAP };
  }
  // SDK client-side timeout / connection failures. The SDK's own `timeout`
  // (set on the client) throws APIConnectionTimeoutError, which extends
  // APIConnectionError — detected here by ERROR CLASS, not by fragile string
  // matching (string matching is exactly what MISSED this and hard-failed
  // Søren + Tobias in the 2026-05-25 robustness batch). APIUserAbortError
  // does NOT extend APIConnectionError, so deliberate aborts stay non-retryable.
  // These get the single-retry-after-timeout schedule (they may already have
  // burned the full timeout window).
  if (err instanceof Anthropic.APIConnectionError) {
    const name = err?.constructor?.name ?? "APIConnectionError";
    return { reason: `${name} (SDK timeout/connection)`, backoffs: BACKOFF_AFTER_TIMEOUT };
  }
  const code = err?.cause?.code;
  if (code && FAST_NETWORK_CODES.includes(code)) {
    return { reason: `network error (${code})`, backoffs: BACKOFF_CHEAP };
  }
  if (code && SLOW_TIMEOUT_CODES.includes(code)) {
    return { reason: `network error (${code})`, backoffs: BACKOFF_AFTER_TIMEOUT };
  }
  if (typeof err?.message === "string" && err.message.includes("fetch failed")) {
    return {
      reason: `network error (${code ?? "fetch failed"})`,
      backoffs: BACKOFF_AFTER_TIMEOUT,
    };
  }
  return null;
}

// Thin adapter that binds Anthropic's classifyError to the shared wall-ceiling
// runner (src/wall-ceiling.js). The default callKind is "story_gen" so a
// caller that omits callContext.callKind still gets a sensible structured
// error. The shared implementation handles Promise.race ceiling enforcement
// + parallel slow-warn timer (Item 1b refactor, 2026-06-01).
function callWithRetry(fn, callContext = {}) {
  return sharedCallWithRetry(fn, { callKind: "story_gen", ...callContext }, classifyError);
}

// ---- Shape-validation retry + diagnostic capture --------------------------
// Sonnet's `output_config.format` enforces field types and additional-
// Properties:false, but NOT array length (Anthropic strips minItems/maxItems
// per the schema comment below). Empirically Sonnet drifts to 13 scenes on
// ~2/3 of generateStory() calls with the 3-template registry (observed
// 2026-05-21). We layer a bounded one-retry on top: shape-validation
// failures (count, page numbering, missing character) retry once; all
// other errors re-throw immediately. Every shape failure captures the
// raw response to output/stories/_failed/ BEFORE throwing — so a successful-
// retry run still leaves its attempt-1 failure artifact on disk for
// diagnostic inspection.
const SHAPE_ERR_MARKER = Symbol.for("daboo.shapeValidationError");

// shapeError helper removed in Item 5 D1 — replaced by ShapeValidationError
// class above, which sets SHAPE_ERR_MARKER in its constructor so the retry
// loop's existing marker check still works.

function captureShapeFailure({ rawText, errorMessage, attempt, stopReason, usage }) {
  // Item 5 D1: return the captured filepath (or null on write failure) so
  // ShapeValidationError can carry it in its structured payload. Pre-Item-5
  // this was return-less and the path was lost.
  try {
    fs.mkdirSync(FAILED_DIR, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const filepath = path.join(FAILED_DIR, `${ts}-attempt${attempt}-raw.json`);
    fs.writeFileSync(filepath, JSON.stringify({
      captured_at: new Date().toISOString(),
      attempt,
      error: errorMessage,
      model: MODEL,
      stop_reason: stopReason ?? null,
      usage: usage ? {
        input_tokens: usage.input_tokens ?? null,
        output_tokens: usage.output_tokens ?? null,
      } : null,
      raw_text: rawText,
    }, null, 2));
    console.log(`  ⚠ Captured failed response: output/stories/_failed/${path.basename(filepath)}`);
    return filepath;
  } catch (writeErr) {
    // Capture-write failures must never break the retry path. Losing
    // diagnostics is acceptable; corrupting a paid call's retry isn't.
    console.warn(`  Failed to capture shape-failure response: ${writeErr.message}`);
    return null;
  }
}

/**
 * Structured error thrown when story-gen exhausts shape-validation retries.
 * Replaces the pre-Item-5 plain `Error` with the SHAPE_ERR_MARKER symbol so
 * the script's finalize path can route it via duck-typed err.toJSON() and
 * include the captured_to path that points at the failed-response artifact.
 *
 * Item 5 D1 (2026-06-01).
 */
export class ShapeValidationError extends Error {
  constructor({ validationError, attempt, capturedToPath, inputSummary, tokensUsed }) {
    super(
      `Shape-validation failure (attempt ${attempt}): ${validationError}. ` +
      `Diagnostic captured to: ${capturedToPath ?? "(capture failed)"}.`
    );
    this.name = "ShapeValidationError";
    this.kind = "shape_validation_failed";
    this[SHAPE_ERR_MARKER] = true;  // preserve existing retry-loop marker semantics
    this.validation_error = validationError;
    this.attempt = attempt;
    this.captured_to = capturedToPath ?? null;
    this.input_summary = inputSummary ?? null;
    this.tokens_used = tokensUsed ?? null;
  }
  toJSON() {
    return {
      kind: this.kind,
      message: this.message,
      validation_error: this.validation_error,
      attempt: this.attempt,
      captured_to: this.captured_to,
      input_summary: this.input_summary,
      tokens_used: this.tokens_used,
    };
  }
}

// ---- Brand-style constants -------------------------------------------------
// Sourced from Phase 1's test-script.json — the input that produced the
// winning Gemini Run 3 spike. Reused as the MVP baseline so visual brand is
// consistent across books. The Week 2 image pipeline consumes these via the
// `story` object returned by generateStory(). Multi-style (W-B): the style string
// now comes from the chosen art_style via resolveStyle(input.style) — defaulting to
// watercolour, so this remains byte-identical for the default path. The style
// constants moved to the shared src/art-styles.js source of truth (imported at top).

// ---- Call parameters (single source of truth for scripts) -----------------
// Exporting these means scripts can display the actual values in their
// confirmation gates rather than hardcoding them (which already drifted once
// — see MAX_TOKENS history below).

// MAX_TOKENS bump history — doubling cadence scales with prompt's growing job:
//   - 4096 (initial) — based on a rough ~1200-token estimate (character
//     ~100 + 12 scenes × ~80 narrative + structure overhead). Sample 1
//     (Mateo / kite) used 3128 and passed; Sample 2 (Sage / preschool
//     nerves) hit the cap on 2026-05-16.
//   - 8192 (2026-05-16) — raised for v1 prompt to give ~5x headroom over
//     the original estimate without enabling runaway generation. Held
//     through v1's run; all Week-2 books fit comfortably.
//   - 16384 (2026-05-19) — raised for v2 prompt. v2 adds ~500 input tokens
//     (TEMPLATE SELECTION section + Available Templates description) and
//     ~600-1200 output tokens (layout_intent.rationale per scene × 12),
//     plus adaptive-thinking overhead. First v2 run (Iris stargazing) hit
//     the 8192 cap. The doubling matches the prior bump pattern. Sonnet
//     4.6 supports up to 128K — 16384 is still conservative.
//   - 32768 (2026-05-30) — raised for the Step 2.5 gender-fix prompt.
//     Successive prompt layers (title field; cover_concept + cover_subjects;
//     companions block; gender pronoun guidance) plus more cross-field
//     invariants compound adaptive-thinking spend. Step 1 (Søren+Theo, no
//     gender) used 7356 output tokens — half the 16K cap. The first Step 2.5
//     regen attempt with the new pronoun guidance hit 16384 cleanly, burning
//     ~$0.26 with no story written. Doubling matches the prior bumps. Per-
//     call cost only scales with what Sonnet actually emits, so the ceiling
//     bump itself doesn't raise typical-case spend; it only widens the
//     worst-case envelope (~$0.50 at 32K of output, vs $0.24 at 16K).
//
// Banked for later: max_tokens-truncation failures should capture the raw
// truncated response to output/stories/_failed/ before throwing — same
// pattern as shape-validation failures. The 2026-05-30 truncation gave us
// nothing to inspect.
export const MAX_TOKENS = 32768;

// Sonnet 4.6 silently defaults to "high" effort; we set "medium" explicitly
// because story-gen is one-shot creative work, not multi-step agentic.
// Ratchet up to "high" if outputs feel under-baked.
export const EFFORT = "medium";

// Adaptive thinking — Claude decides when/whether to think. "disabled" would
// be cheaper; "adaptive" is worth the variance for creative work.
export const THINKING_TYPE = "adaptive";

// ---- Output schema (for output_config.format) ------------------------------
// What Claude generates. Wrapper merges these two fields with the brand
// constants above to produce the final 5-field `story` object.
//
// NB: Anthropic's structured-output schema validation supports basic types,
// `enum`, `const`, `additionalProperties: false`, and JSON-Schema string
// formats — but NOT numerical constraints (minimum/maximum), string-length
// constraints, or array-length constraints (minItems/maxItems). We enforce
// scenes.length === 12 (and sequential page numbering) in code below.
//
// The `template_id` enum is populated at runtime from the on-disk template
// registry — see buildStorySchema(). This means Anthropic's server-side
// validation rejects unknown template IDs without us needing to post-parse.
// Exported so tests can verify the enum contents.
export function buildStorySchema(registry, readingLevel = "standard") {
  const templateIds = registry.map((t) => t.id);
  // The per-page prose length in the narrative_text description is reading-level
  // conditioned (single source of truth: READING_LEVELS). Unknown → standard.
  const narrativeLengthDesc = (READING_LEVELS[readingLevel] ?? READING_LEVELS.standard).schemaDesc;
  return {
    type: "object",
    required: ["title", "character", "companion_characters", "scenes", "cover_concept", "cover_subjects"],
    additionalProperties: false,
    properties: {
      title: {
        type: "string",
        description: "A warm, evocative picture-book title for this story (e.g. \"Iris and the Tall Oak Tree\"). Concise — aim for roughly 40 characters or fewer. Title Case. No subtitle, no author name, no surrounding quotation marks.",
      },
      character: {
        type: "string",
        description: "Single paragraph (3-5 sentences) describing the protagonist. Lead with name and age. Visually specific enough for an illustrator to render consistently across 12 pages.",
      },
      companion_characters: {
        type: "array",
        description: "Character descriptions for each companion listed in the input. EMPTY array if no companions were listed. Each entry mirrors the protagonist's character description: visually specific, warm, no editorializing. Lead with name and age; keep the input's identity markers as defining features.",
        items: {
          type: "object",
          required: ["name", "character_description"],
          additionalProperties: false,
          properties: {
            name: {
              type: "string",
              description: "The companion's name, EXACTLY as given in the input's Companions list.",
            },
            character_description: {
              type: "string",
              description: "Single paragraph (3-5 sentences) describing this companion. Lead with name and age. Keep the input's identity markers as defining features so the illustrator can render them consistently.",
            },
          },
        },
      },
      scenes: {
        type: "array",
        description: "Exactly twelve scenes telling one arced story.",
        items: {
          type: "object",
          required: ["page", "action", "narrative_text", "subjects_present", "layout_intent"],
          additionalProperties: false,
          properties: {
            page: {
              type: "integer",
              description: "Page number, 1 through 12, in story order.",
            },
            action: {
              type: "string",
              description: "Visually concrete moment an illustrator could draw without inventing details. Always show the protagonist.",
            },
            narrative_text: {
              type: "string",
              description: `${narrativeLengthDesc}. Do not use em dashes (—) or en dashes (–) in this text; use a comma, or a separate sentence, instead. You MAY optionally use the sparing emphasis markup ([[em:word]], [[sfx:word]], [[line:sentence]]) defined in the system prompt — but most pages should have none, and the per-book budgets there are strict.`,
            },
            subjects_present: {
              type: "array",
              description: "Names of REF-ANCHORED characters PRESENT in this scene's illustration. The protagonist's name MUST appear in every scene. [REF-ANCHORED] companions appear only when they belong in that moment (not every scene needs every character — solo protagonist moments are good). Every name MUST match either the protagonist's name (as given in the input) or one of the companion_characters[].name values you wrote above. NO other names allowed: no hallucinated characters, AND no [TEXT-ANCHORED] entities (those live in the action prose, not in subjects_present).",
              items: { type: "string" },
            },
            layout_intent: {
              type: "object",
              required: ["template_id", "rationale"],
              additionalProperties: false,
              properties: {
                template_id: {
                  type: "string",
                  enum: templateIds,
                  description: "ID of the chosen template (must be one of the available templates listed in the system prompt).",
                },
                rationale: {
                  type: "string",
                  description: "1-2 sentences explaining the template choice for this scene (narrative length fit + aesthetic match).",
                },
              },
            },
          },
        },
      },
      cover_concept: {
        type: "string",
        description: "A vivid 2-4 sentence art-direction note describing the IDEAL FRONT-COVER image for THIS specific story — its signature action/moment, key visual motif, and emotional mood. HARD CONSTRAINTS: the protagonist's face and the main action MUST sit in the upper half/centre of the frame; the lower ~40% MUST stay calm and open (no faces, action, or key objects there — it is reserved for the title panel). Show the protagonist DOING the signature action (not posing), with a sense of camera distance/angle that fits the moment.",
      },
      cover_subjects: {
        type: "array",
        description: "Subjects anchored on the cover. At product launch this MUST be exactly a one-element array containing the protagonist's name — `[<protagonist_name>]` — even if your cover_concept narrative mentions a companion as part of the scene's atmosphere. Companions are not anchored on the cover at launch.",
        items: { type: "string" },
      },
    },
  };
}

// ---- System prompt ---------------------------------------------------------
// System prompt v2 (locked 2026-05-19). Adds TEMPLATE SELECTION section for
// multi-template orchestration (Stream 3). v1 (locked 2026-05-15) preserved
// in git history; revert via `git log src/anthropic.js`.
//
// Locks creative posture (voice, arc, the action/narrative split, content
// safety, quality bar). The output format itself is enforced server-side by
// output_config.format — the prompt covers craft, not format.
//
// The {{TEMPLATE_REGISTRY_DESCRIPTION}} placeholder is substituted at
// generateStory() call time from the on-disk template registry.
export const SYSTEM_PROMPT_TEMPLATE = `You are a children's picture-book author writing personalised bedtime stories for parents to read aloud to their {{AUDIENCE}}.

Your job is to produce ONE complete 12-page story per request. You generate: a title; a character description for the protagonist; companion-character descriptions (one paragraph each) for any companions listed in the input (empty array if none); 12 numbered scenes (each declaring which subjects are present); a cover concept; and the cover subjects list. The book's visual style, composition rules, and image-safety constraints are set elsewhere — focus entirely on title, character(s), story, and cover.

VOICE AND AUDIENCE

Write for {{AUDIENCE}} in third-person, present-tense narration. Match vocabulary and sentence complexity to the story's reading level (defined under READING LEVEL below) — concrete nouns and active verbs throughout, but never condescending. "She looked up at the moon" beats "Sarah observed the lunar orb." Warmth in tone: like a kind narrator who likes the protagonist. Avoid talking down. Avoid quirky-adult-narrator self-awareness ("little did she know...", "but that's a story for another day...").

PUNCTUATION: do NOT use em dashes (—) or en dashes (–) in narrative_text or the title. Where you would reach for a dash, use a comma, or end the sentence and begin a new one. The em dash reads as machine-written and breaks the read-aloud cadence of picture-book prose.

{{READING_LEVEL_RULES}}

STORY ARC

The 12 scenes must tell ONE story with a clear shape:
- Setup — establish the protagonist and their everyday world
- Inciting moment — something changes; the story begins
- Rising tension — challenges, choices, discoveries that build
- Climax — the highest-stakes moment
- Resolution — the change resolves
- Closing — return to calm, often with the protagonist transformed

Do NOT pre-assign beats to specific page numbers — pacing is your creative call. But it MUST arc. A book of 12 disconnected mood-pieces is a failure; a book where pages 1, 6, and 12 visibly belong to the same shape is the goal.

THE TWO FIELDS PER SCENE

Each scene has an \`action\` and a \`narrative_text\`. They serve different jobs and should be written differently:

- \`action\` is for the illustrator. It must be VISUALLY CONCRETE — a specific moment an illustrator can draw without inventing details. "Lila kneels in the tall grass cupping a firefly in her hands" is drawable. "Lila feels wonder" is not. Pick the most picture-able moment in each scene. Always show the protagonist in the action.

- \`narrative_text\` is what the parent reads aloud. {{PROSE_LENGTH}} (per the READING LEVEL rules above). Write it for rhythm, not just information. Read it aloud in your head — if it's a mouthful or thuds, rewrite it. Children's-book prose has cadence: short next to long, soft consonants where they count, occasional repetition for emphasis ("step, step, step"). Don't merely describe what the action shows — the narrative continues the story, gives the protagonist's interior, sets up the next moment.

EMPHASIS MARKUP (use VERY sparingly — seasoning, not decoration)

You may mark up a FEW moments in narrative_text with three optional inline tags. They are the ONLY markup allowed, and MOST PAGES SHOULD HAVE NONE. Overused, they cheapen the effect and clutter the page. The budgets below are per-BOOK totals, not per-page:

- \`[[em:word]]\` — emphasis. Wrap a SINGLE genuinely-emphatic word (occasionally two) at a real emotional peak: the word a parent's voice would lean on reading aloud. Budget: 1 to 3 in the WHOLE book, and never more than one per page. If nothing truly peaks on a page, use none.
- \`[[sfx:word]]\` — a sound word (onomatopoeia: thunk, crash, whoosh, splash, creak). Wrap ONLY a word that is genuinely a sound, and ONLY where one naturally occurs. Budget: 0 to 3 in the whole book. Never invent a sound word to fill the budget.
- \`[[line:A whole sentence.]]\` — ONE short, standalone emotional sentence, given its own line for weight. Reserve it for the single biggest heart-beat of the book (usually near the end). Wrap exactly one complete sentence. Budget: 0 or 1 in the whole book.

Markup rules:
- AT MOST ONE markup treatment (em / sfx / line) per page. Never combine two on the same page (e.g. an \`[[em:]]\` and a \`[[line:]]\` together) — one page, one treatment at most, and most pages none. The drop cap is separate and automatic; it does not count.
- Wrap PLAIN words/sentences only. Do NOT nest tags, do NOT wrap surrounding punctuation, and do NOT put any markup in \`action\` (illustrator text) or the title.
- Use the exact bracket form: \`[[em:...]]\`, \`[[sfx:...]]\`, \`[[line:...]]\`. The brackets are invisible in the printed book and do NOT count toward the narrative's character length for template selection.
- The opening page's large decorative initial (drop cap) is added automatically by the renderer. Do NOT add any markup for it.
- When in doubt, leave it out. A book with one perfect \`[[em:]]\` and one \`[[line:]]\` reads far better than one peppered with emphasis. Zero markup is an acceptable, often correct, choice.

TEMPLATE SELECTION

In addition to action and narrative_text, each scene must include a layout_intent — your choice of visual template for the page. Different templates handle different narrative lengths and aesthetic moods.

{{TEMPLATE_REGISTRY_DESCRIPTION}}

Selection rules:
1. Check the narrative_text length for this scene. Filter to templates whose max_narrative_chars is "any length" or >= the scene's narrative_text character count.
2. From the remaining templates, pick the one whose aesthetic_intent tags best match the scene's mood (the mood is your call, based on the narrative you've just written).
3. If multiple templates fit equally well, prefer the template tagged "default".
4. Prefer varying the template on adjacent pages for visual rhythm — avoid using the same template on two consecutive pages where possible. When two adjacent scenes would both best-fit the same template, use the second-best-fitting template for one of them to break the run. This adjacent-page variety is a SOFT preference, overridden by two HARD constraints:
   - Rule 1 (max_narrative_chars) always wins. Never move a scene to a template whose character limit its narrative exceeds, even to break a run — a too-long narrative must stay on a template that can hold it.
   - Never use the climactic full-bleed template (prompt-6-iter-1) to break up a run. It stays reserved for the single genuine story climax. Adjacent-page variety comes from the workhorse templates, not from deploying the climactic template more often.
5. CROWDED-SCENE LAYOUT: for scenes where THREE OR MORE ref-anchored characters (subjects_present) appear together, do NOT use a split-column / text-beside-image layout (a template whose summary describes a dedicated side text column, e.g. prompt-2-iter-2). Those reserve a third of the width for text, which crops wide group compositions and pushes one character off-frame. Instead pick a FULL-WIDTH layout (the illustration spans the whole page with text below or overlaid). To make one qualify, keep the scene's narrative_text short enough to fit that template's max_narrative_chars. This is a HARD constraint for 3+ character scenes, above the rule-4 variety preference (but still under rule 1).
6. READING-LEVEL LAYOUT: if this story's reading level is SIMPLEST (see the READING LEVEL section above), the short-text FILL template (prompt-7-iter-1) is your DEFAULT workhorse for most pages. It is purpose-built for 1 to 2 short sentences: a large illustration with big, warm text on a compact cream strip, so a brief page fills the page instead of reading sparse, which is exactly what happens when a 40-to-140-character SIMPLEST page lands on the 300-character workhorses (prompt-2-iter-2, prompt-3-iter-2, prompt-8-iter-1). At the SIMPLEST level, choose prompt-7-iter-1 for the majority of pages and keep each narrative within its 150-character cap. You may still vary to another template for a genuinely different beat, and the full-bleed climax template (prompt-6-iter-1) stays reserved for the one true climax. This preference applies ONLY at the SIMPLEST reading level; at STANDARD and ADVANCED, ignore it and select normally. It sits under rule 1 (never exceed a template's char cap) and does not override the rule-5 crowded-scene constraint.

For each scene, populate layout_intent with:
- template_id: one of the IDs listed above
- rationale: 1-2 sentences giving the REAL reason for the choice — narrative length fit, aesthetic match, and/or (per rule 4) adjacent-page variety.

Rationale honesty: state the reason you actually used. If you picked a template to break an adjacent-page run rather than for best length or aesthetic fit, say so plainly (e.g. "chosen for adjacent-page variety, to avoid repeating the previous page's template"). Do NOT invent a character-count or aesthetic justification you do not mean — an honest variety rationale is fully acceptable and is preferred over a fabricated one.

Examples:
- A quiet scene with 250 chars of contemplative narrative → prompt-3-iter-2 (intimate aesthetic; fits within 300-char limit)
- An action scene with 500 chars of expansive narrative → prompt-2-iter-2 (only template that holds 500 chars)
- An establishing scene with 200 chars of expansive narrative → prompt-2-iter-2 (cinematic aesthetic match, even though prompt-3-iter-2 could also hold it character-wise)
- A tender 260-char scene that best-fits prompt-3-iter-2, but the previous page already uses prompt-3-iter-2 → prompt-2-iter-2 (chosen for adjacent-page variety; prompt-2-iter-2 is the second-best fit and holds the length — stated honestly, not dressed up as a length or mood reason)

Note: you control both the narrative_text length AND the layout_intent. If you want a scene to feel intimate and use prompt-3-iter-2, write the narrative shorter (under 300 chars) so it qualifies. The layout choice and the prose pacing are linked.

PAGE RHYTHM: most pages are "banded" layouts where the illustration occupies one region and the story text sits on cream paper beside or below it (prompt-2-iter-2, prompt-3-iter-2, prompt-8-iter-1). This is the calm default reading rhythm; vary between them page to page. prompt-6-iter-1 is the ONLY full-bleed, edge-to-edge layout, and its immersive impact comes from being the single such page in the book, so reserve it for the one true emotional climax (never to add variety). As a soft arc, an expansive establishing opening (prompt-2-iter-2), intimate middle pages (prompt-3-iter-2), the full-bleed climax (prompt-6-iter-1), and an intimate close (prompt-3-iter-2) make a strong shape, but this is guidance, not a rule: let the story's pacing lead.

TITLE

Give the book a warm, evocative picture-book title — the kind you'd see on the cover of a real children's book. Lean on the protagonist and the heart of the story (e.g. "Iris and the Tall Oak Tree", "The Night Bo Couldn't Sleep", "Mia's Blue Cardigan"). Title Case. Keep it concise — aim for roughly 40 characters or fewer so it sits well on a cover; shorter is often stronger. This is a soft target, not a hard limit: a slightly longer title that genuinely sings beats a clipped one that doesn't. No subtitle, no author name, no surrounding quotation marks. The title should feel like it belongs to THIS story, not a generic template.

CHARACTER DESCRIPTION

One paragraph (3-5 sentences) describing the protagonist as the parent gave you. Lead with name and age. Describe the protagonist the way a children's book illustrator describes a character to themselves before drawing: visually specific, warm, no editorializing. Their hair, their eyes, their clothes, the way they hold themselves — concrete details that help an illustrator render them consistently across 12 pages. Do not editorialize about identity, family structure, or background — the parent provides what they want included; you render it without commentary.

PHYSICALLY CONCRETE, SHEET-NEUTRAL: the character_description must contain ONLY observable, drawable physical facts — hair length, shape and colour; build; face shape; skin tone; specific named garments and their colours. It must NOT contain interpretive, personality, attitude, or archetype adjectives that an image renderer will draw literally and that fight the character's reference sheet. Banned examples (and anything like them): "tousled", "windswept", "messy", "scrappy" (hair the renderer will then muss); "lean", "wiry", "gangly" (build it will then slim); "cheeky", "mischievous", "impish", "bright-eyed", "spirited" (which summon a generic freckled-urchin archetype and override the real face). Describe WHAT THE CHARACTER LOOKS LIKE, not WHO THEY ARE. Personality, mood, energy and attitude belong in each scene's \`action\` and \`narrative_text\` — never in the appearance description. Prefer plain physical wording: "straight brown hair in a blunt fringe" not "tousled brown hair"; "a sturdy, solidly-built frame" not "a scrappy little build"; "a round face with a friendly smile" not "a cheeky grin". This applies equally to the protagonist and to every companion_characters[] entry.

Persistent appearance is symmetric and intrinsic only. Describe the features that are the same on both sides and travel with the protagonist on every page: hair, eyes, skin, build, and bilateral clothing. Do NOT write asymmetric or single-sided items into the character description (a pencil behind one ear, a flower tucked on one side, a bag over one shoulder, an object held in one hand, a patch on one knee). Rendered from a reference sheet on all twelve pages, a one-sided item duplicates onto both sides or drifts from side to side between pages, the same failure mode as a single-cheek mole. If such an item matters to a particular moment, put it in that scene's \`action\` as a per-scene prop, where the illustrator paints it fresh for that page alone.

Structured selections are authoritative. The Appearance input may contain a structured marker spine (the parent's preset choices) optionally followed by \`also:\` and free-text notes. Where the structured spine and the free-text notes conflict on any concrete attribute (hair, skin, eyes, build, outfit), render the STRUCTURED value — the free text is additive detail, not an override. Keep every structured marker exactly as given.

HERITAGE AND BACKGROUND. The Appearance may begin with the child's background in the parent's own words — a nationality, ethnicity, culture, or a mix — written as "a child of <…> background". Render it FAITHFULLY and with DIGNITY. Describe natural, specific, real features true to that heritage (hair texture and colour, skin tone, eye and facial features) the way you would lovingly and accurately describe any real child of that background. Keep the parent's words exactly; never soften, generalise, or substitute them. Do NOT stereotype, caricature, or exaggerate: no exaggerated or caricatured features, no costume, props, flags, or "traditional dress" standing in for the child, no clichéd cultural backdrop unless the parent explicitly asked for it, and never reduce the child to a single trait. The child is an individual first; their heritage is one true part of who they are, rendered with the same realism and care as every other feature. For a mixed background, let the blend show naturally rather than choosing one side.

Pronouns: refer to the protagonist throughout the character description and the narrative with the pronouns matching the \`Gender\` field in the input — he/him for boy, she/her for girl, they/them for non_binary. Do not infer gender from the name; honor the field as given.

Gender-coded styling (driven by the same \`Gender\` field): the character description's STYLING VOCABULARY must reflect the gender, not just the pronouns. When gender is \`boy\` or \`girl\`, weave gender-coded styling cues directly into the appearance prose — WITHOUT changing or contradicting any customer-provided marker. Every color, length, item, and texture the customer specified stays exactly as given; you only inflect the gender coding AROUND those markers:
- Hairstyle phrasing reflects gender (e.g. "a boy's haircut", "boyish cut", "a girl's hairstyle", "girlish styling") wrapping the customer's stated length/color/texture — never contradicting them.
- Build and proportions read gendered where natural ("boyish build", "girlish frame").
- Clothing reads gendered when the items allow ("a boy's red t-shirt", "a girl's overalls", "boy's striped tee").
Keep every specific marker the customer provided; only inflect the gender coding around them. This is LOAD-BEARING: the downstream illustrator reads your appearance prose as the primary signal for the subject's gender presentation. Pronouns alone are too weak — confirmed twice (Stage B, and the 2026-05-30 Theo female-presenting failure where masculine pronouns + an abstract "boyish" marker still lost to a feminine-coded styling cue inside the appearance prose).

When gender is \`non_binary\`, write neutral styling — no "boy's" / "girl's" / "boyish" / "girlish" framing; describe the customer's markers without gendered styling vocabulary.

{{PROTAGONIST_KIND_OVERRIDE}}COMPANIONS

When the input lists Companions (one or more under "Companions:"), they appear in the story alongside the protagonist. The PROTAGONIST remains the EMOTIONAL CENTER of every story — their name is on the cover, they are who the customer bought the book for, their arc is the story's spine. Companions PARTICIPATE — they have presence, voice, and meaningful interaction — but they are NEVER co-protagonists. The protagonist drives, decides, and grows; companions support, react, and accompany.

Not every scene must include every character. Some pages will be the protagonist alone — that is GOOD; solo moments give the protagonist's interiority room. Other pages bring companions in for shared moments. Decide per scene who is present based on what the moment is actually about.

THE PROTAGONIST MUST APPEAR IN EVERY SCENE. Companions appear when they belong there.

REF-ANCHORED vs TEXT-ANCHORED companions: each companion entry in the input is tagged either \`[REF-ANCHORED]\` or \`[TEXT-ANCHORED]\`. These two tiers are handled DIFFERENTLY in your output — read carefully.

[REF-ANCHORED] companions (the default; required for all humans):
- DO write a \`companion_characters[]\` entry for them.
- DO include their name in the \`subjects_present\` list of every scene where they appear.
- The illustrator will render them from a reference sheet, anchored by your character_description.

[TEXT-ANCHORED] companions (non-human only — pets, toys; soft-anchored via prose, no reference sheet):
- DO NOT write a \`companion_characters[]\` entry for them.
- DO NOT include their name in any scene's \`subjects_present\` list.
- INSTEAD: weave the entity's appearance markers DIRECTLY into the \`action\` description of every scene where it appears, the way you'd describe a vivid prop or signature object that the illustrator paints from prose alone. The customer's stated markers (color, shape, distinctive features) MUST appear in the action prose every time the entity is on the page — not just once — because the illustrator has no reference sheet to fall back on. Example: a [TEXT-ANCHORED] pet with markers "shaggy tan-and-white fur, floppy ears, stubby tail" must have those features described in each scene's action, e.g. "Bramble the shaggy tan-and-white terrier-mix sits beside Søren, his floppy ears drooping forward and stubby tail giving a single hopeful wag." This consistency-via-prose is load-bearing: it's what keeps the entity recognizable as the SAME pet across scenes.

For each [REF-ANCHORED] companion listed in the input, write a paragraph in \`companion_characters[]\` describing them the same way you describe the protagonist (visually specific, warm, no editorializing). Lead with name and age. Keep the identity markers given in the input as DEFINING FEATURES so the illustrator can render them consistently across pages. The \`name\` field of each \`companion_characters[]\` entry MUST match EXACTLY the name given in the input — no nicknames, no spelling variants.

The persistent-appearance rule from CHARACTER DESCRIPTION applies to companions too: keep asymmetric or single-sided accessories and held objects out of each companion's character_description. If such an item matters to a moment, place it in that scene's \`action\` as a per-scene prop.

Pronouns: each human companion's input entry carries a \`gender\` tag (e.g. "gender boy"). Refer to that companion with matching pronouns — he/him for boy, she/her for girl, they/them for non_binary — throughout their character description AND throughout the narrative scenes. Do not infer gender from the companion's name; honor the tag as given. Non-human companions (pets, toys) have no gender tag — pick whatever pronouns or gendered language fits the story for them.

Gender-coded styling for companions: same rule as the protagonist's CHARACTER DESCRIPTION section. When a human companion's \`gender\` tag is \`boy\` or \`girl\`, weave gender-coded styling cues directly into their character_description's appearance prose — WITHOUT changing or contradicting any customer-provided identity marker. Use the same vocabulary patterns:
- Hairstyle phrasing reflects gender ("a boy's haircut", "a girl's hairstyle") wrapping the customer's stated length/color/texture exactly as given.
- Build and proportions read gendered where natural ("boyish build", "girlish frame").
- Clothing reads gendered when the items allow ("a boy's striped tee", "a girl's corduroy overalls").
The customer's identity markers stay exact; you only inflect the gender coding AROUND them. This applies because the sheet-mint pipeline name-masks the companion description and feeds it directly to the illustrator — gendered prose in your companion description IS the signal that reaches the image model. Non-human companions: no gender styling.

For each scene, populate \`subjects_present\`: a non-empty array listing the names of REF-ANCHORED characters present in that scene. Use the same names you used (the protagonist's name and any [REF-ANCHORED] companion names from \`companion_characters[]\`). The protagonist's name MUST be in every scene's \`subjects_present\`. NO other names — no characters who weren't in the input as [REF-ANCHORED], and NEVER include [TEXT-ANCHORED] entities here (they live in the action prose, not in subjects_present).

If NO companions are listed in the input (no "Companions:" block), output \`companion_characters\` as an empty array \`[]\`, and every scene's \`subjects_present\` contains only the protagonist's name. If the input ONLY has [TEXT-ANCHORED] companions (no [REF-ANCHORED] ones), \`companion_characters\` is still \`[]\` and \`subjects_present\` still contains only the protagonist — the text-anchored entities live in the action prose.

{{MULTICHAR_RULES}}

CONTENT SAFETY

Do not include: scary content (genuine threat, jumpscares, lurking menace), violence, death, or peril unresolved by the closing scene. Mild stakes are good — a lost toy, a wrong turn, a moment of self-doubt — as long as they resolve within the arc. Friendly monsters are fine; menacing ones are not. No grown-up content of any kind.

Emotional difficulty is welcome and important. A protagonist who feels lonely, scared of the dark, anxious about a new sibling, sad about a move, frustrated by something they can't yet do — these are real children's-book themes and the best stories include them. The ban is on PHYSICAL peril and threat, not on the full range of children's emotional experience. A child who feels lonely on page 3 and finds a friend by page 9 is a good story. A child stalked by a shadow figure is not.

QUALITY BAR

The parent will read this to their child tonight. A story that ticks every box but feels generic is a failure. Every book must have AT LEAST ONE memorable moment — a specific, vivid, slightly unexpected beat the child remembers afterward. The dragon who turns out to be lonely. The snowflake that lands on a sleeping bear's nose. The moment the protagonist chooses to be brave for someone else. Memorable means specific, not whimsy-for-whimsy's-sake. Generic books die unread; specific moments survive bedtime.

COVER CONCEPT

After you've written the whole story, describe the IDEAL FRONT-COVER IMAGE for THIS specific story — the single image that best captures it. NOT a generic theme illustration: name the signature action or moment, the key visual motif, and the emotional mood that make THIS story recognisable at a glance. Show the protagonist DOING the signature action (alive and mid-moment, not stiffly posing), and vary the camera DISTANCE to fit the moment — intimate close-up wonder, a mid-action beat, or a small child in a big world. Aim for compositional variety across stories; let the moment dictate the framing.

The cover has a translucent title panel across the bottom, so the concept MUST stay compatible with it (these are hard constraints, not suggestions):
- The protagonist's FACE must read RIGHT-SIDE-UP and be clearly legible — shown front-on, three-quarter, or in profile. NEVER inverted or upside-down; NEVER an extreme overhead angle looking straight down on a child lying on their back; NEVER so tilted or foreshortened that the face distorts. Camera DISTANCE may vary freely (close, mid, or wide) and the ACTION may be anything — it is only the face's orientation and readability that is fixed. (If the signature moment is the child lying down looking up, frame it from the side or at a gentle three-quarter so the face still reads upright — do not place the camera directly above an on-their-back child.)
- The protagonist's face and the main action MUST sit in the UPPER HALF / CENTRE of the frame.
- Do NOT put any key detail — faces, the main action, important objects — in the lower portion. The bottom ~40% of the frame must stay CALM and OPEN (it is reserved for the title panel). You may describe quiet low foreground there (open ground, calm water, soft grass, gentle glow) but nothing critical.
- One full-bleed image. Specify WHAT is depicted and the framing energy; do not fight the calm-lower-zone rule.

Keep it to 2-4 sentences: vivid and specific, an art-direction note an illustrator could paint from.

Also output \`cover_subjects\`: at this product launch, this MUST be EXACTLY a single-element array containing the protagonist's name — \`[<protagonist_name>]\`. The protagonist is the cover's anchored subject. Even if your \`cover_concept\` narrative mentions a companion as part of the scene's atmosphere, \`cover_subjects\` only ever contains the protagonist at launch. Do not include companions in \`cover_subjects\`.`;

// Pet-hero override (FEATURES_PET_HERO, 2026-07-09). Substituted into the
// {{PROTAGONIST_KIND_OVERRIDE}} slot (right before COMPANIONS) ONLY for pet-hero
// books; "" otherwise (human books are byte-identical). It flips the three
// human-specific protagonist sections above — CHARACTER DESCRIPTION, Pronouns,
// and Gender-coded styling — for a non-human protagonist, and leaves everything
// else (arc, template selection, companions, cover) untouched. Ends with a blank
// line so COMPANIONS stays separated after substitution.
export const PET_PROTAGONIST_OVERRIDE = `PROTAGONIST IS A PET (this book)

The protagonist of THIS story is a real ANIMAL — a pet — not a child. This section OVERRIDES the CHARACTER DESCRIPTION, Pronouns, and Gender-coded styling rules above FOR THE PROTAGONIST ONLY (human companions still follow them):
- CHARACTER DESCRIPTION for the pet: describe it the way an illustrator would before drawing it — species and breed; body size and build; coat colour and texture; distinctive markings; ear and tail shape; muzzle; and eye colour. Lead with the pet's name. Keep to physically-concrete, drawable, symmetric-and-intrinsic features that travel on every page (the PHYSICALLY CONCRETE and persistent-appearance rules above still apply — no interpretive/personality adjectives, no single-sided items). A pet wears NO clothing unless the input explicitly gives it a persistent accessory such as a collar; do not invent outfits. No heritage clause; no human gender-coded styling.
- PRONOUNS: the pet has no Gender field. Ignore the protagonist pronoun and gender-styling rules above; refer to the pet with natural pronouns that fit the story ("it" or "they", or "he"/"she" if the input's wording implies one) and keep that choice CONSISTENT across the description and all twelve scenes.
- Everything else is unchanged: the pet is the EMOTIONAL CENTER and appears in EVERY scene; the owner and any other characters are COMPANIONS handled exactly per the rules below (a human owner is [REF-ANCHORED]).

`;

// ---- Multi-character discipline rules (2026-05-31, generalized 2026-06-01) -
// Two separate rules with different activation gates, both injected via the
// {{MULTICHAR_RULES}} placeholder in the COMPANIONS section:
//
//   SUBSET_DISTRIBUTION_RULES_BY_N — fires at N>=2 with N-scaled target bands.
//     Closes the N=2 fort-theme watch-item (Step 1 produced 1 solo / 11
//     together on group-coded themes; soft "not every scene needs everyone"
//     guidance proved insufficient). Replaces a hardcoded "Just like at N=2"
//     rhetorical hook with actual quantified N=2 / N=3 / N=4 targets.
//
//   N4_COMPOSITION_SHAPES_RULE — fires at N=4 only (3 ref-anchored secondaries).
//     The Scene-C-shape (foreground action + background watchers → marker
//     cross-contamination) and Scene-D-shape (all four in dynamic motion →
//     fine-detail drift) failures from the 2026-05-31 N=4 throwaway probe.
//     These are reference-budget-ceiling defenses specific to 1+1+1+1
//     allocator budget; they do not apply at N<=3.
//
// At N=1 both rules are silent (empty substitution) — no behavioral change
// from the legacy single-protagonist pipeline.

const SUBSET_DISTRIBUTION_RULES_BY_N = {
  2: `
SUBSET DISTRIBUTION

When 2 ref-anchored subjects are present (protagonist + 1 ref-anchored companion), distribute focus across the cast: aim for 6-8 of the 12 scenes to feature both subjects, 2-4 scenes to feature the protagonist alone, and 1-2 scenes may feature a companion-with-protagonist intimate moment. The protagonist must appear in every scene.`,
  3: `
SUBSET DISTRIBUTION

When 3 ref-anchored subjects are present (protagonist + 2 ref-anchored companions), distribute focus across the cast: aim for 3-5 of the 12 scenes to feature all three subjects, 4-6 scenes to feature subsets of 2 (the protagonist plus one companion), and 2-4 scenes to feature the protagonist alone. The protagonist must appear in every scene.`,
  4: `
SUBSET DISTRIBUTION

When 4 ref-anchored subjects are present (protagonist + 3 ref-anchored companions), distribute focus across the cast: aim for 4-6 of the 12 scenes to feature all four subjects, 4-6 scenes to feature subsets of 2-3, and 1-3 scenes to feature the protagonist alone. The protagonist must appear in every scene.`,
};

/**
 * Return the SUBSET DISTRIBUTION rule text for a given total ref-anchored
 * subject count N. Returns "" at N=1 (vacuous — no subsets) or for any N
 * outside the {2, 3, 4} band (current product ceiling is N=4).
 *
 * Exported so scripts/test-prompt-scope.js can assert per-N rule wording
 * without having to call generateStory.
 */
export function buildSubsetDistributionRule(n) {
  return SUBSET_DISTRIBUTION_RULES_BY_N[n] ?? "";
}

/**
 * Build the full {{MULTICHAR_RULES}} substitution from a list of secondary
 * entries. Returns "" when no ref-anchored secondaries are present (N=1).
 *
 * Activation:
 *   - SUBSET_DISTRIBUTION fires at N>=2 (>=1 tier2 secondary)
 *   - N4_COMPOSITION_SHAPES fires only at N=4 (>=3 tier2 secondaries)
 *
 * This is the single source of truth for what gets injected into the system
 * prompt, used by both generateStory and the test-prompt-scope test suite.
 *
 * @param {Array<{ anchor?: string }>} secondaries  the input.secondaries
 *   array (or undefined). Only entries with anchor === "tier2" count toward N.
 * @returns {string}  the assembled block (may be empty)
 */
export function buildMulticharRulesBlock(secondaries) {
  const tier2Count = (secondaries ?? []).filter((s) => s.anchor === "tier2").length;
  const totalN = 1 + tier2Count;
  const subsetRule = tier2Count >= 1 ? buildSubsetDistributionRule(totalN) : "";
  const shapesRule = tier2Count >= 3 ? N4_COMPOSITION_SHAPES_RULE : "";
  return subsetRule + shapesRule;
}

export const N4_COMPOSITION_SHAPES_RULE = `
N=4 COMPOSITION DISCIPLINE

When all four ref-anchored subjects ARE in a scene together, do not compose with:
- Foreground pair (or single subject) doing one thing while background pair (or singles) watches or does something else. This is multi-focal-distance composition and breaks marker fidelity at our render layer.
- All four subjects in dynamic motion at once (e.g. all four running together, all four jumping, all four mid-action). This is fine at smaller cast sizes but causes fine-detail drift on individual subjects at N=4.

PREFERRED COMPOSITION SHAPES at N=4 (all-four scenes):
- Static unified group: all four sitting together, standing together, looking at something together, gathered around an object
- Close-cluster activity: all four hands-on with one shared focus (one treasure box between them, one map they're all reading, one task they're all doing in the same close space)
- Row/line compositions: all four in the same plane and lighting

These rules ensure the engine's reference-budget ceiling is respected. They do not apply when only 2-3 subjects are in a scene (subset scenes can use any composition).`;

// ---- Reading level (prose difficulty; 2026-07-02) --------------------------
// Reading level controls the PROSE ONLY — sentence count, vocabulary, sentence
// structure, repetition. The child's AGE still drives every character/visual
// reference (character age in the description, appearance). Three levels; the
// age BAND supplies the default, an explicit reading_level overrides. Mirrors
// the buildMulticharRulesBlock pattern: pure, exported, the single source of
// truth for BOTH the injected {{READING_LEVEL_RULES}} block AND the de-hard-
// coded {{AUDIENCE}} / {{PROSE_LENGTH}} phrases AND the schema narrative_text
// description (so the three can never drift out of agreement).
//
// Char bands are reconciled with the template caps: the largest page template
// holds 300 chars, so ADVANCED targets 200-300 (never 360, which would overflow
// every template). SIMPLEST's ~150 upper end pairs with the short-text template.
export const READING_LEVELS = {
  simplest: {
    audience: "very young children just being read to",
    proseLength: "1 to 2 short sentences",
    schemaDesc: "1 to 2 short sentences (about 40 to 140 characters) of read-aloud prose for this page",
    rules: `READING LEVEL — SIMPLEST (read-aloud for the very young)

Write every page's narrative_text at the simplest level:
- LENGTH: 1 to 2 short sentences per page (about 40 to 140 characters). Never more than 2 sentences. Each page is at least one COMPLETE sentence, never a bare fragment.
- VOCABULARY: high-frequency, concrete words only — things a young child can see, touch, or do. No abstract or stretch words.
- SENTENCES: single-clause subject-verb-object only. No subordinate clauses, no similes, no metaphors.
- REFRAIN: choose ONE short, memorable refrain (a repeated line or phrase) and repeat it 3 to 5 times across the twelve pages at natural beats. Introduce it near the opening and bring it back on the final page, so the book bookends on the refrain. The refrain is the book's spine.
- Favour the short-text template (about 150-char cap) for these pages so a short page does not read sparse.`,
  },
  standard: {
    audience: "young children",
    proseLength: "3 to 4 sentences",
    schemaDesc: "3 to 4 sentences (about 140 to 260 characters) of read-aloud prose for this page",
    rules: `READING LEVEL — STANDARD (confident early reader)

Write every page's narrative_text at a standard picture-book level:
- LENGTH: 3 to 4 sentences per page (about 140 to 260 characters).
- VOCABULARY: mostly concrete words, with a few stretch words whose meaning is made clear by the surrounding sentence.
- SENTENCES: mostly simple sentences, with an occasional compound sentence (joined with "and", "but", "so"). Keep clause-nesting light.
- REPETITION: light and optional — a gentle echo is welcome but not required; no mandatory refrain.`,
  },
  advanced: {
    audience: "older picture-book readers",
    proseLength: "4 to 5 sentences",
    schemaDesc: "4 to 5 sentences (about 200 to 300 characters) of read-aloud prose for this page",
    rules: `READING LEVEL — ADVANCED (fluent reader)

Write every page's narrative_text at an advanced picture-book level:
- LENGTH: 4 to 5 sentences per page (about 200 to 300 characters). Keep every page at or under 300 characters so it fits the page templates.
- VOCABULARY: richer and more varied, with occasional figurative language (a simile or image) and roughly one new or stretch word per page, used so its meaning is clear from context.
- SENTENCES: compound and complex sentences with embedded clauses are welcome; you may build mild suspense across sentences.
- REPETITION: minimal — rely on narrative momentum rather than a refrain.`,
  },
};

// Age band ("3-5" / "5-7" / "7-9", the wizard's AGE_RANGES enum) → default level.
const BAND_TO_LEVEL = { "3-5": "simplest", "5-7": "standard", "7-9": "advanced" };

/**
 * Resolve the reading level for a story. Precedence:
 *   1. explicit reading_level (validated against READING_LEVELS)
 *   2. the real age BAND (input.ageRange) — preferred, lossless
 *   3. lossy age-int fallback (direct/legacy callers with no band; the bands
 *      overlap at 5 and 7, so this is only a best-effort last resort)
 * Always returns a valid READING_LEVELS key.
 */
export function resolveReadingLevel({ reading_level, ageRange, age } = {}) {
  if (reading_level && READING_LEVELS[reading_level]) return reading_level;
  if (ageRange && BAND_TO_LEVEL[ageRange]) return BAND_TO_LEVEL[ageRange];
  if (Number.isFinite(age)) return age <= 4 ? "simplest" : age <= 6 ? "standard" : "advanced";
  return "standard";
}

/**
 * The {{READING_LEVEL_RULES}} substitution — the rules block for the resolved
 * level. Mirrors buildMulticharRulesBlock: pure + single source of truth, used
 * by both generateStory and the prompt-scope test. Unknown level → standard.
 */
export function buildReadingLevelRulesBlock(level) {
  return (READING_LEVELS[level] ?? READING_LEVELS.standard).rules;
}

// Story "vibe" — the emotional register (pet books; wizard PET_VIBES enum). Mirrors
// website lib/pet-vibes.ts. The {{VIBE_RULES}} block steers tone; 'memorial' is for a
// pet who has passed and is handled with dignity (leans on the CONTENT SAFETY section,
// which permits gentle emotional weight). Default 'happy'.
export const VIBES = {
  happy: {
    rules: `STORY MOOD — HAPPY MOMENTS (joyful and celebratory)
Write a bright, warm, present-day story of everyday delight: play, cuddles, a small celebration, a perfect ordinary day. Earn the joy through specific small moments (the thump of a tail, ears flying, a happy sigh), not generic cheerfulness. Light comedy is welcome. End on warmth and belonging.`,
  },
  adventure: {
    rules: `STORY MOOD — A FUN ADVENTURE (playful and imaginative)
Write an imaginative, high-energy romp where the pet is the brave hero: an ordinary place (a backyard, a park) becomes an exciting world through play. Real stakes are pretend; nothing genuinely dangerous or frightening happens, and every "peril" resolves safely and cheerfully. Keep it exciting, funny, and warm.`,
  },
  tribute: {
    rules: `STORY MOOD — A TRIBUTE (a warm love letter)
Write a grateful love letter to this specific pet, a celebration of exactly what makes them THEM. Catalogue their real, specific details (the way they greet you, a favourite spot, a habit) as the vehicle for tenderness. The pet is alive and well; there is NO grief or loss undertone. Warm, a little misty, but happy throughout.`,
  },
  memorial: {
    rules: `STORY MOOD — IN MEMORY (a gentle keepsake for a pet who has passed)
This book is for a family, possibly a child, whose pet has died. Handle it with real care and dignity.
- Be honest and gentle: it is okay to say, simply and softly, that the pet has died and is not coming back. Do not hide it, and do not dwell on the manner of death.
- Comfort through CONCRETE, sensory memory: specific places, games, sounds, and habits the pet left behind, so love reads as ONGOING and carried forward, not erased.
- Validate big feelings (missing them is big because the love was big) without instructing the reader how they must feel.
- Warm and comforting, never saccharine, never falsely cheerful, and never bleak. Aim for the register of the very best children's books about loss.
- Do NOT use afterlife, heaven, religious, or "rainbow bridge" imagery. Keep it grounded in memory and in love that stays.
- Refer to the pet in the PAST where the story is set after they are gone; present tense is fine inside remembered moments.
Resolve on comfort: the love, and the small traces the pet left behind, remain.`,
  },
};

/**
 * The {{VIBE_RULES}} substitution — the tone directive for the chosen vibe. Pure +
 * single source of truth (mirrors buildReadingLevelRulesBlock). Unknown/absent → happy.
 */
export function buildVibeRulesBlock(vibe) {
  return (VIBES[vibe] ?? VIBES.happy).rules;
}

// ---- Public API ------------------------------------------------------------

/**
 * Strip em dashes (—) and en dashes (–) from a PRINTED-text field (narrative_text
 * and title), replacing each with a comma + single space and tidying the spacing
 * around it. The em dash is a strong "machine-written" tell and breaks read-aloud
 * cadence; the system prompt already asks Sonnet to avoid it, and this is the
 * deterministic guarantee layered on top (prompt rules are not 100%).
 *
 * Single hyphens (well-loved, tip-toe) are NEVER touched — only em dashes, en
 * dashes, and the typed double-hyphen "--". A dash with a DIGIT on BOTH sides is
 * left intact (a number range like "3–5" stays a range, not "3, 5"). Pure +
 * idempotent. Applied to narrative_text + title ONLY, not to `action`/
 * `cover_concept` (those are image-prompt text for Gemini, never printed in the
 * book). Exported for the unit test (scripts/test-narrative-sanitizer.js).
 *
 * Markup-safe: this only ever touches dashes, whitespace, and commas — never
 * the [[em:]]/[[sfx:]]/[[line:]] typography markup's `[ ] :` delimiters — so it
 * runs harmlessly over narrative_text that already carries markup (and cleans
 * any dash a parent wrote inside a [[line:...]]). Covered by the sanitizer test.
 */
export function stripNarrativeDashes(text) {
  if (typeof text !== "string" || text.length === 0) return text;
  return text
    // em/en/typed dash (+ neighbours) → ", ". The optional digit captures guard
    // number ranges: when a digit sits on BOTH sides (a && b) the original match
    // is kept verbatim; otherwise the dash collapses to a comma.
    .replace(/(\d?)\s*(?:[—–]|--)\s*(\d?)/g, (m, a, b) => (a && b ? m : `${a}, ${b}`))
    .replace(/\s+/g, " ")                  // collapse whitespace runs
    .replace(/\s+([,.;:!?])/g, "$1")       // drop space before punctuation
    .replace(/,\s*,/g, ",")                // dash beside a comma → a single comma
    .replace(/,(\s*[.;:!?])/g, "$1")       // comma immediately before end punctuation → drop it
    .replace(/^,\s*/, "")                  // no leading comma (dash at the very start)
    .trim();
}

/**
 * Generate a structured 12-page story for a child.
 *
 * @param {object} input
 * @param {{ name: string, age: number, appearance?: string }} input.child
 *   The protagonist. `name` and `age` required; `appearance` optional but
 *   strongly recommended (it's the main personalisation lever).
 * @param {string} input.theme
 *   What the story is about. E.g. "exploring an enchanted forest",
 *   "the night the moon went missing".
 * @returns {Promise<{ story: object, usage: { input_tokens: number, output_tokens: number } }>}
 *   `story` matches the test-script.json shape (character, style,
 *   composition_rules, negative_prompt, scenes[]). Character and scenes come
 *   from Claude; style/composition_rules/negative_prompt are brand constants.
 *   `usage` is Anthropic's raw token counts for cost tracking.
 */
export async function generateStory(input, options = {}) {
  const userMessage = formatUserMessage(input);
  // Optional status emitter for slow_call + retry events. Threaded down to
  // callWithRetry via callContext. Wall-ceiling enforcement is always-on; the
  // emitter is opt-in for status.json integration (see src/status-writer.js).
  const onSlowCall = typeof options.onSlowCall === "function" ? options.onSlowCall : null;

  // Load on-disk template registry. The registry determines which template
  // IDs Sonnet may choose from; we inject the descriptive list into the
  // system prompt (so Sonnet knows the options + their constraints) AND
  // build the schema with template_id enum (so Anthropic's server-side
  // validation rejects unknown IDs without us needing to post-parse).
  const registry = await loadTemplateRegistry();
  const templateRegistryDescription = buildTemplateMetadataForPrompt(registry);
  // Multi-character discipline rules — two separate gates injected through a
  // single {{MULTICHAR_RULES}} placeholder:
  //   - subset-distribution rule: fires at N>=2 with N-scaled targets
  //   - N=4 composition shapes rule: fires only at N=4 (3 ref-anchored
  //     secondaries) as a ref-budget-ceiling defense
  // At N=1 both are empty and the placeholder collapses to "" — no behavioral
  // change from the single-protagonist pipeline.
  const multicharRules = buildMulticharRulesBlock(input.secondaries);
  // Reading level (prose difficulty). Optional input.reading_level overrides;
  // otherwise defaults from the real age BAND (input.ageRange), falling back to
  // the integer age. Controls prose ONLY — the character/visual age is untouched.
  const readingLevel = resolveReadingLevel({
    reading_level: input.reading_level,
    ageRange: input.ageRange,
    age: input.child?.age,
  });
  const levelDef = READING_LEVELS[readingLevel];
  // Pet-hero (FEATURES_PET_HERO, default off): a non-human protagonist swaps the
  // human CHARACTER DESCRIPTION / gender sections for the pet override. Same gating
  // as book-pipeline.js; flag off → override collapses to "" (byte-identical).
  const petHero = process.env.FEATURES_PET_HERO === "on" && input.child?.subject_type === "non_human";
  const systemPrompt = SYSTEM_PROMPT_TEMPLATE
    .replace(/\{\{TEMPLATE_REGISTRY_DESCRIPTION\}\}/g, templateRegistryDescription)
    .replace(/\{\{MULTICHAR_RULES\}\}/g, multicharRules)
    // Vibe tone directive (pet books) is APPENDED to the reading-level block only when
    // a vibe is set — so for child books (vibe empty) the prompt is BYTE-IDENTICAL to
    // before this change (no stray placeholder / blank line).
    .replace(
      /\{\{READING_LEVEL_RULES\}\}/g,
      buildReadingLevelRulesBlock(readingLevel) + (input.vibe ? `\n\n${buildVibeRulesBlock(input.vibe)}` : ''),
    )
    .replace(/\{\{PROTAGONIST_KIND_OVERRIDE\}\}/g, petHero ? PET_PROTAGONIST_OVERRIDE : "")
    .replace(/\{\{AUDIENCE\}\}/g, levelDef.audience)
    .replace(/\{\{PROSE_LENGTH\}\}/g, levelDef.proseLength);
  const schema = buildStorySchema(registry, readingLevel);

  // Compact input summary surfaced in MaxTokensError + ShapeValidationError
  // diagnostics + status.json when the response is truncated/malformed. Theme
  // is included so a triage reader can identify the failed call without
  // opening the raw response.
  //
  // subjects_count includes BOTH tier-1 and tier-2 secondaries (diagnostic
  // metadata, not validation — useful for triage to know the cast shape).
  // Tier-1 / tier-2 distinction for validation lives in validateStoryShape.
  const inputSummary = {
    protagonist: input.child.name,
    subjects_count: 1 + (input.secondaries ?? []).length,
    scenes_requested: 12,
    theme: input.theme,
    reading_level: readingLevel,
  };

  // Bounded one-retry on shape-validation failure. See SHAPE_ERR_MARKER
  // comment above for rationale.
  let claudeOutput;
  let usage;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const result = await attemptStoryGeneration({
        systemPrompt,
        userMessage,
        schema,
        attempt,
        validationInput: input,
        inputSummary,
        onSlowCall,
      });
      claudeOutput = result.claudeOutput;
      usage = result.usage;
      break;
    } catch (err) {
      if (!err[SHAPE_ERR_MARKER]) throw err;  // non-retryable
      if (attempt < 2) {
        console.log(
          `  ⚠ shape-validation failure on attempt ${attempt} (${err.message}) — retrying once.`
        );
        continue;
      }
      throw err;  // retry exhausted
    }
  }

  // Merge Claude's output with the brand constants to produce the final
  // test-script.json-shaped story object. The style string comes from the chosen
  // art_style (input.style); undefined/legacy → watercolour (byte-identical to the
  // old behaviour). composition_rules + negative_prompt are shared brand constants.
  const story = {
    // Item 1 (book-polish): strip em/en dashes from the PRINTED fields only.
    // title + each scene's narrative_text are rendered into the book; action /
    // cover_concept stay untouched (image-prompt text, never printed).
    title: stripNarrativeDashes(claudeOutput.title),
    character: claudeOutput.character,
    companion_characters: claudeOutput.companion_characters,
    style: resolveStyle(input.style).style,
    // page-render vocab (W-D): the chosen style's `page` string, replacing the
    // per-template styleOverride. watercolour → the rich Sophie-Blackall string.
    pageStyle: resolveStyle(input.style).page,
    // W-E: per-style MEDIUM-token fills for the template compositions (the
    // watercolour-baked medium phrases are now {{MEDIUM:key}} tokens). Absent on
    // legacy stories → the render defaults per-key to watercolour (byte-identical).
    styleMedium: resolveStyle(input.style).medium,
    composition_rules: COMPOSITION_RULES,
    negative_prompt: NEGATIVE_PROMPT,
    scenes: claudeOutput.scenes.map((s) => ({ ...s, narrative_text: stripNarrativeDashes(s.narrative_text) })),
    cover_concept: claudeOutput.cover_concept,
    cover_subjects: claudeOutput.cover_subjects,
  };

  return {
    story,
    usage: {
      input_tokens: usage?.input_tokens ?? null,
      output_tokens: usage?.output_tokens ?? null,
    },
  };
}

// Single attempt: API call → stop-reason gates → text-block extraction →
// JSON parse → shape validation. Shape failures capture raw response to
// disk via captureShapeFailure() then throw ShapeValidationError so the
// outer retry loop knows to try again. All other failures re-throw
// immediately.
//
// Item 9 (2026-06-01): validationInput is the original input object passed
// to generateStory. Used by validateStoryShape to derive protagonist name +
// the TIER-2-only expected companion set. Replaces the pre-derived
// protagonistName + expectedCompanionNames params (single source of truth
// for tier-1/tier-2 logic now lives inside validateStoryShape).
async function attemptStoryGeneration({ systemPrompt, userMessage, schema, attempt, validationInput, inputSummary, onSlowCall }) {
  const response = await callWithRetry(
    () => client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: systemPrompt,
      thinking: { type: THINKING_TYPE },
      output_config: {
        effort: EFFORT,
        format: { type: "json_schema", schema },
      },
      messages: [{ role: "user", content: userMessage }],
    }),
    { callKind: "story_gen", subjectName: validationInput?.child?.name, onSlowCall },
  );

  // Surface stop reasons that mean the response is unusable.
  if (response.stop_reason === "refusal") {
    const category = response.stop_details?.category ?? "unspecified";
    // Item 5 F3: capture full refusal context to disk (sent prompt + raw
    // response) so the customer knows what to change.
    let capturedToPath;
    try {
      capturedToPath = captureRefusalFailure({
        rawResponse: response,
        systemPrompt,
        userMessage,
        safetyCategory: category,
        inputSummary,
      });
      console.warn(`  ⚠ Sonnet refusal (${category}) — diagnostic captured to ${path.relative(path.join(__dirname, ".."), capturedToPath).replace(/\\/g, "/")}`);
    } catch (writeErr) {
      capturedToPath = `(capture write failed: ${writeErr.message})`;
      console.warn(`  ⚠ Sonnet refusal (${category}) — diagnostic capture FAILED: ${writeErr.message}`);
    }
    throw new RefusalError({
      safetyCategory: category,
      tokensUsed: response?.usage?.output_tokens ?? null,
      inputSummary,
      capturedToPath,
    });
  }
  if (response.stop_reason === "max_tokens") {
    // Item 2 (2026-06-01): capture the truncated response to disk before
    // throwing so a triage reader can see what Sonnet was burning tokens on.
    // Previously the raw response was discarded — the customer paid for the
    // call (~$0.26 lost on the 2026-05-30 Step-2.5 truncation) and we had
    // nothing to analyze.
    let capturedToPath;
    try {
      capturedToPath = captureMaxTokensFailure({
        rawResponse: response,
        inputSummary,
        maxTokensConfigured: MAX_TOKENS,
      });
      console.warn(`  ⚠ max_tokens truncation — diagnostic captured to ${path.relative(path.join(__dirname, ".."), capturedToPath).replace(/\\/g, "/")}`);
    } catch (writeErr) {
      // Capture-write failures must never mask the underlying error.
      capturedToPath = `(capture write failed: ${writeErr.message})`;
      console.warn(`  ⚠ max_tokens truncation — diagnostic capture FAILED: ${writeErr.message}`);
    }
    throw new MaxTokensError({
      maxTokensConfigured: MAX_TOKENS,
      tokensUsed: response?.usage?.output_tokens ?? null,
      inputSummary,
      capturedToPath,
      stopReason: response.stop_reason,
    });
  }

  // Extract the JSON text block. With output_config.format the response is a
  // single text content block whose body is the structured JSON string.
  // Thinking blocks (from adaptive thinking) may precede it — we skip them.
  const textBlock = response.content.find((c) => c.type === "text");
  if (!textBlock) {
    const types = response.content.map((c) => c.type).join(", ") || "(empty)";
    throw new Error(
      `No text block in Anthropic response. stop_reason: ${response.stop_reason}. ` +
      `Content block types received: ${types}.`
    );
  }

  // Parse the JSON. With server-side schema enforcement this should not fail,
  // but defense in depth.
  let claudeOutput;
  try {
    claudeOutput = JSON.parse(textBlock.text);
  } catch (err) {
    throw new Error(
      `Failed to parse JSON from Anthropic response. Error: ${err.message}. ` +
      `First 200 chars of response: ${textBlock.text.slice(0, 200)}`
    );
  }

  // ---- Cheap-repair: trailing extras when leading 12 are valid --------
  // Sonnet's scene-count drift fires ~100% on recent 3-template story-
  // gens. Drift modes observed (all share "valid leading 12 + trailing
  // extras"): byte-identical p12 duplicate (2026-05-21), sentinel-marked
  // duplicate ("THIS IS A DUPLICATE — DISCARD" 13th, 2026-05-23), and
  // 3× full repeat (37 scenes — leading 12 valid, then page-12 again,
  // then a full repeat of pages 1-12 ×2, 2026-05-23). Detect-and-truncate
  // here, BEFORE the shape validations + retry path — zero API cost.
  // Gate: scenes.length > 12 AND scenes[0..11] have page === i+1 in
  // order (the leading 12 form a structurally valid story). If the
  // leading 12 is broken, fall through to the existing retry path for
  // uncharacterized failures — principle preserved (never truncate a
  // broken response into a false success). Capture is still written
  // (with "cheap-repair (Option B)" in the error field) so cheap-repair
  // frequency and drift-mode evolution stay measurable: grep
  // "cheap-repair" in _failed/ counts self-repaired runs, grep -v
  // counts genuine retry-path failures.
  if (Array.isArray(claudeOutput.scenes)
      && claudeOutput.scenes.length > 12
      && claudeOutput.scenes.slice(0, 12).every((s, i) => s.page === i + 1)) {
    const originalLength = claudeOutput.scenes.length;
    const droppedCount = originalLength - 12;
    console.log(`  ✓ cheap-repair: truncated ${originalLength} scenes to valid leading 12 (dropped ${droppedCount} trailing).`);
    claudeOutput.scenes = claudeOutput.scenes.slice(0, 12);
    captureShapeFailure({
      rawText: textBlock.text,
      errorMessage: `cheap-repair (Option B): truncated ${originalLength} scenes to valid leading 12 (dropped ${droppedCount} trailing extras)`,
      attempt,
      stopReason: response.stop_reason,
      usage: response.usage,
    });
  }

  // Shape validations — RETRYABLE. Capture raw response BEFORE throwing
  // (so attempt-1 failures stay on disk even when attempt 2 succeeds).
  // Server-side schema enforces field types + additionalProperties:false
  // but minItems/maxItems are stripped (Anthropic doesn't support them),
  // so count/numbering + cross-field invariants are enforced by the
  // exported validateStoryShape helper below.
  //
  // Item 5 D1: unified shape-failure handler. Captures the raw response to
  // disk and throws a ShapeValidationError carrying the captured_to path so
  // the script's finalize path routes the structured error via toJSON().
  // The throw is still recognized by the retry loop via SHAPE_ERR_MARKER.
  //
  // Item 9 (2026-06-01): the multi-character invariants block extracted into
  // validateStoryShape() for unit-testability. The post-Item-9 fix lives
  // inside the helper — expectedCompanionNames now filters to tier-2 only,
  // matching the system prompt's directive that tier-1 entities live in
  // action prose and do NOT appear in companion_characters[].
  const shapeFail = (errMsg) => {
    const capturedToPath = captureShapeFailure({
      rawText: textBlock.text,
      errorMessage: errMsg,
      attempt,
      stopReason: response.stop_reason,
      usage: response.usage,
    });
    throw new ShapeValidationError({
      validationError: errMsg,
      attempt,
      capturedToPath,
      inputSummary,
      tokensUsed: response?.usage?.output_tokens ?? null,
    });
  };

  try {
    validateStoryShape(claudeOutput, { input: validationInput });
  } catch (err) {
    shapeFail(err.message);
  }

  return { claudeOutput, usage: response.usage };
}

/**
 * Pure cross-field validation of a parsed Anthropic story response against
 * the input that drove its generation. Throws Error(message) on the FIRST
 * failure — caller is responsible for capturing the raw response + wrapping
 * the throw into a ShapeValidationError if it needs the structured-error
 * machinery (attemptStoryGeneration does this via the shapeFail closure).
 *
 * Extracted from attemptStoryGeneration (2026-06-01, Item 9) so:
 *   - the tier-1 / tier-2 filter on companion_characters is unit-testable
 *     against synthetic claudeOutput values without hitting the Anthropic API
 *   - future cross-field invariants (cover-concept name-mention checks,
 *     scene-narrative length bounds, etc.) have one place to live
 *
 * Architectural intent (mirrors the system prompt in SYSTEM_PROMPT_TEMPLATE):
 *   - companion_characters[].name set EQUALS the input's TIER-2 secondaries
 *     only. Tier-1 (text-anchored) secondaries are absent from this list
 *     and absent from subjects_present — they live in scene action prose.
 *   - cover_subjects is EXACTLY [protagonistName] (deterministic at launch).
 *   - every scene.subjects_present is non-empty AND includes the protagonist
 *     AND only references protagonist or generated companion names.
 *
 * @param {object} claudeOutput  parsed JSON from Sonnet's response
 * @param {{ input: object }} ctx  the input passed to generateStory (with
 *   child.name and secondaries[] including their anchor field)
 * @throws {Error} on the first validation failure with a human-readable message
 */
export function validateStoryShape(claudeOutput, { input }) {
  const protagonistName = input?.child?.name;
  // Item 9 fix: only tier-2 (ref-anchored) secondaries appear in
  // companion_characters per the system prompt. Tier-1 are text-only and
  // live in action prose.
  const expectedCompanionNames = (input?.secondaries ?? [])
    .filter((s) => s.anchor === "tier2")
    .map((s) => s.name);

  // Top-level field presence (the schema enforces types; this catches
  // truthiness + non-string flips).
  if (!claudeOutput.title || typeof claudeOutput.title !== "string") {
    throw new Error(`Anthropic response missing 'title' field or wrong type.`);
  }
  if (!claudeOutput.character || typeof claudeOutput.character !== "string") {
    throw new Error(`Anthropic response missing 'character' field or wrong type.`);
  }
  if (!claudeOutput.cover_concept || typeof claudeOutput.cover_concept !== "string") {
    throw new Error(`Anthropic response missing 'cover_concept' field or wrong type.`);
  }
  if (!Array.isArray(claudeOutput.scenes) || claudeOutput.scenes.length !== 12) {
    throw new Error(
      `Anthropic response 'scenes' is not an array of exactly 12 ` +
      `(got ${Array.isArray(claudeOutput.scenes) ? claudeOutput.scenes.length : "non-array"}).`,
    );
  }
  for (let i = 0; i < claudeOutput.scenes.length; i++) {
    if (claudeOutput.scenes[i].page !== i + 1) {
      throw new Error(
        `Anthropic response 'scenes' has wrong page numbering at index ${i}: ` +
        `expected page ${i + 1}, got ${claudeOutput.scenes[i].page}.`,
      );
    }
  }

  // (1) companion_characters names match input's TIER-2 set (Item 9 fix)
  if (!Array.isArray(claudeOutput.companion_characters)) {
    throw new Error(`Anthropic response 'companion_characters' is not an array.`);
  }
  const generatedCompanionNames = claudeOutput.companion_characters.map((c) => c?.name);
  const expectedSet = new Set(expectedCompanionNames);
  const generatedSet = new Set(generatedCompanionNames);
  if (expectedSet.size !== generatedSet.size || [...expectedSet].some((n) => !generatedSet.has(n))) {
    throw new Error(
      `Anthropic response 'companion_characters' names do not match input. ` +
      `Expected: [${[...expectedSet].join(", ") || "(none)"}]. Got: [${[...generatedSet].join(", ") || "(none)"}].`
    );
  }

  // (2) cover_subjects is exactly [protagonistName]
  if (!Array.isArray(claudeOutput.cover_subjects)
      || claudeOutput.cover_subjects.length !== 1
      || claudeOutput.cover_subjects[0] !== protagonistName) {
    throw new Error(
      `Anthropic response 'cover_subjects' must equal exactly ["${protagonistName}"]; ` +
      `got ${JSON.stringify(claudeOutput.cover_subjects)}.`
    );
  }

  // (3) per-scene subjects_present
  const validSubjects = new Set([protagonistName, ...generatedCompanionNames]);
  for (let i = 0; i < claudeOutput.scenes.length; i++) {
    const sp = claudeOutput.scenes[i].subjects_present;
    if (!Array.isArray(sp) || sp.length === 0) {
      throw new Error(`Scene ${i + 1} 'subjects_present' must be a non-empty array; got ${JSON.stringify(sp)}.`);
    }
    if (!sp.includes(protagonistName)) {
      throw new Error(
        `Scene ${i + 1} 'subjects_present' must include the protagonist "${protagonistName}"; ` +
        `got [${sp.join(", ")}].`
      );
    }
    for (const name of sp) {
      if (!validSubjects.has(name)) {
        throw new Error(
          `Scene ${i + 1} 'subjects_present' contains unknown name "${name}". ` +
          `Valid names: [${[...validSubjects].join(", ")}].`
        );
      }
    }
  }
}

/**
 * Format the structured input into the user-message string Claude sees.
 * Kept here (not in pipeline) so the wrapper's contract is "give me structured
 * input, get a story" — the pipeline doesn't need to know Anthropic's message
 * shape.
 */
// Gender enum kept in sync with scripts/generate-story.js GENDERS set.
// Required on every human subject (protagonist + human secondaries); MUST be
// absent on non_human. Added 2026-05-30 after a human secondary came back
// female-presenting from Gemini despite "boy" in the input — text adjectives
// alone don't override visual cues; the structured gender field carries the
// signal both for Sonnet's pronoun choice and for the Gemini-side marker (0).
const VALID_GENDERS = new Set(["boy", "girl", "non_binary"]);

// Anchor enum kept in sync with scripts/generate-story.js ANCHORS set.
// Required on every secondary; controls whether the secondary occupies a
// reference-image slot at render time (the 4-ref Gemini ceiling lives in
// src/allocator.js).
//   tier1 — text-only / soft-anchored. Non-humans only (Stage B + Step 2.5
//           evidence: human faces don't survive text-only anchoring). The
//           entity is woven into scene action prose by story-gen, doesn't
//           appear in subjects_present, doesn't consume a ref slot, doesn't
//           get a companion_characters[] entry. Validated as same-pet across
//           scenes via the Bramble/Pip probes (2026-05-31).
//   tier2 — ref-anchored. Sheet minted, ref slot consumed, declared as a
//           numbered subject in the page-render prompt. Pre-Step-2.5 default
//           behavior for all secondaries. Required for humans.
const VALID_ANCHORS = new Set(["tier1", "tier2"]);

// Build the story-gen seed appearance line. The parent's stated background
// (heritage) ALWAYS flows when present — it is the parent's own words and is not
// gated by FEATURES_COMPOSE. Without structured features (or compose off) the seed
// is background + free-text appearance. When compose is on: the descriptive
// features spine (background-led) merged with free text + the bare mark clause.
// Outfit is intentionally excluded (deterministic post-Sonnet injection).
function composeStorySeedAppearance(child) {
  const background = child.background ?? null;
  if (process.env.FEATURES_COMPOSE !== "on" || !child.features) {
    // No structured features: background + free text only (composeAppearance with
    // null features → "a child of <bg> background; also: <free text>", or just one).
    return composeAppearance(null, child.appearance, background);
  }
  const spine = composeAppearance(child.features, child.appearance, background);
  const mark = composeMarkClause(child.features.marks);
  if (spine && mark) return `${spine}, with ${mark}`;
  return spine || mark || "";
}

export function formatUserMessage(input) {
  const { child, theme } = input ?? {};
  const secondaries = input?.secondaries ?? [];
  if (!child || typeof child.name !== "string" || typeof child.age !== "number") {
    throw new Error(
      `Invalid input: 'child' must have 'name' (string) and 'age' (number). ` +
      `Received: ${JSON.stringify(child)}`
    );
  }
  // Pet-hero (FEATURES_PET_HERO, default off): a non-human protagonist has no gender.
  // Same gating as book-pipeline.js — flag off ⇒ the gender requirement still applies
  // (byte-identical to the human path).
  const petHero = process.env.FEATURES_PET_HERO === "on" && child.subject_type === "non_human";
  if (!petHero && (typeof child.gender !== "string" || !VALID_GENDERS.has(child.gender))) {
    throw new Error(
      `Invalid input: 'child.gender' is required and must be one of: ${[...VALID_GENDERS].join(", ")}. ` +
      `Got: ${JSON.stringify(child.gender)}.`
    );
  }
  if (typeof theme !== "string" || theme.trim() === "") {
    throw new Error(`Invalid input: 'theme' must be a non-empty string.`);
  }
  // Secondaries — architecturally 0-4, UI exposes 1 at launch.
  if (!Array.isArray(secondaries)) {
    throw new Error(`Invalid input: 'secondaries' must be an array (or omitted).`);
  }
  if (secondaries.length > 4) {
    throw new Error(
      `Invalid input: 'secondaries' length must be 0-4 (got ${secondaries.length}). ` +
      `Architecture supports up to 4; UI exposes 1 at launch.`
    );
  }
  let tier2Count = 0;
  for (let i = 0; i < secondaries.length; i++) {
    const s = secondaries[i];
    if (!s || typeof s.name !== "string" || typeof s.age !== "number") {
      throw new Error(`Invalid secondary[${i}]: must have 'name' (string) and 'age' (number).`);
    }
    if (typeof s.appearance_markers !== "string" || !s.appearance_markers.trim()) {
      throw new Error(`Invalid secondary "${s.name}": 'appearance_markers' is required (2-3 specific features spanning hair / face / clothes).`);
    }
    const subjType = s.subject_type ?? "human";
    // Anchor: required explicit choice (no silent default at this layer; the
    // generate-book.js read-path applies a "tier2" backward-compat default
    // for pre-2026-05-31 meta.json files only).
    if (typeof s.anchor !== "string" || !VALID_ANCHORS.has(s.anchor)) {
      throw new Error(
        `Invalid secondary "${s.name}": 'anchor' is required and must be one of: ` +
        `${[...VALID_ANCHORS].join(", ")}. Got: ${JSON.stringify(s.anchor)}.`
      );
    }
    if (s.anchor === "tier1" && subjType !== "non_human") {
      throw new Error(
        `Invalid secondary "${s.name}": anchor "tier1" requires subject_type "non_human" ` +
        `(text-only anchoring doesn't survive for human faces — Stage B + Step 2.5 evidence). Got subject_type "${subjType}".`
      );
    }
    if (s.anchor === "tier2") tier2Count += 1;
    if (subjType === "human") {
      if (typeof s.gender !== "string" || !VALID_GENDERS.has(s.gender)) {
        throw new Error(
          `Invalid secondary "${s.name}": 'gender' is required for human subjects and must be one of: ` +
          `${[...VALID_GENDERS].join(", ")}. Got: ${JSON.stringify(s.gender)}.`
        );
      }
    } else {
      if (s.gender !== undefined) {
        throw new Error(
          `Invalid secondary "${s.name}": 'gender' must NOT be present when subject_type is "non_human" ` +
          `(gender does not apply to pet/toy subjects).`
        );
      }
    }
  }
  // Tier-2 ceiling: protagonist + up to 3 tier-2 secondaries = 4 ref-anchored
  // subjects max (matches the allocator's 4-ref ceiling). Tier-1 entities
  // are unlimited from a ref-budget perspective.
  if (tier2Count > 3) {
    throw new Error(
      `Invalid input: at most 3 tier-2 secondaries allowed (protagonist + 3 tier-2 = 4 ref-anchored ` +
      `subjects, matching the Gemini 4-ref ceiling). Got ${tier2Count} tier-2 secondaries. Tier-1 ` +
      `(text-only) entities are unlimited.`
    );
  }

  const lines = petHero
    ? [
        `Pet (the protagonist — a real animal, not a child):`,
        `  Name: ${child.name}`,
        ...(child.animal_kind ? [`  Kind: ${child.animal_kind}`] : []),
      ]
    : [
        `Child:`,
        `  Name: ${child.name}`,
        `  Age: ${child.age}`,
        `  Gender: ${child.gender}`,
      ];
  // If appearance is omitted, Sonnet invents visual details from name/age
  // alone. Acceptable for MVP but worth knowing — appearance is the main
  // personalisation lever.
  //
  // Structured-inputs (FEATURES_COMPOSE, default off): compose the seed from the
  // descriptive features spine + free text + the bare mark clause, so the prose
  // reflects the parent's presets even when free-text appearance is empty. Mirrors
  // the markers wiring in book-pipeline.js (both compose from the same raw
  // features+appearance → identical spine, no double-compose). Outfit is NOT seeded
  // here — it's injected deterministically post-Sonnet (injectOutfit).
  // Pet: the appearance is the pet's raw coat/markings text as given (no human
  // heritage/features compose). Human: unchanged composed seed.
  const seedAppearance = petHero ? (child.appearance ?? "") : composeStorySeedAppearance(child);
  if (seedAppearance) {
    lines.push(`  Appearance: ${seedAppearance}`);
  }
  lines.push(``);
  // Companions block — only emitted when secondaries are present, so the
  // single-protagonist path produces an identical user message to before
  // (modulo the new Child Gender line above, which is required anyway).
  // Each entry is tagged [REF-ANCHORED] (tier2) or [TEXT-ANCHORED] (tier1)
  // so Sonnet can route them per the COMPANIONS system-prompt guidance:
  //   - [REF-ANCHORED] gets a companion_characters[] entry + appears in
  //     subjects_present.
  //   - [TEXT-ANCHORED] does NOT get a companion_characters[] entry, does
  //     NOT appear in subjects_present; instead the entity's appearance
  //     markers must be woven into the action descriptions of the scenes
  //     where it appears.
  if (secondaries.length > 0) {
    lines.push(`Companions:`);
    for (const s of secondaries) {
      const rel = s.relationship ?? "companion";
      const type = s.subject_type ?? "human";
      const anchorTag = s.anchor === "tier1" ? "[TEXT-ANCHORED]" : "[REF-ANCHORED]";
      const genderTag = s.gender ? `, gender ${s.gender}` : "";
      lines.push(`  - ${anchorTag} ${s.name}, age ${s.age}, ${rel} (${type})${genderTag}: ${s.appearance_markers}`);
    }
    lines.push(``);
  }
  lines.push(`Theme: ${theme}`);
  lines.push(``);
  lines.push(
    `Write a 12-page bedtime story for this ${petHero ? "pet" : "child"} based on the theme. ` +
    `Generate the character description${secondaries.length > 0 ? "s (protagonist + companions)" : ""}, the twelve scenes (each declaring subjects_present), the cover concept, and the cover_subjects list per the system prompt.`
  );

  return lines.join("\n");
}

// ---- Single-page narrative rewrite (review station, 2026-07-02) ------------
// Rewrites ONE page's read-aloud narrative_text from an optional operator note
// ("shorter", "more playful", "less repetitive") without touching the image.
// Used by the review station's "Regenerate text" mode: the new text is laid
// over the EXISTING page image ($0 Puppeteer re-lay, no Gemini). This is a
// small, self-contained Sonnet call — plain text out, no story schema.
//
// Honours the same constraints the story schema enforces: age-appropriate
// read-aloud prose, a hard character cap (the target template's
// max_narrative_chars; null = no cap), and the no-em/en-dash house rule. Retries
// ONCE with a stricter instruction if the first draft overruns the cap; returns
// { text, usage, overflow } (overflow=true means even the retry was over — the
// caller decides whether to accept or warn).
export async function rewriteNarrative({ currentText, note = "", age, maxChars = null, onSlowCall } = {}) {
  if (typeof currentText !== "string" || !currentText.trim()) {
    throw new Error("rewriteNarrative: currentText is required.");
  }
  const ageLine = Number.isFinite(age)
    ? `The reader is about ${age} years old — match vocabulary and sentence length to that age.`
    : `Keep vocabulary and sentence length appropriate for a young child.`;
  const capLine = Number.isFinite(maxChars)
    ? `HARD LIMIT: the rewritten text MUST be ${maxChars} characters or fewer (it is laid into a fixed text area). Count characters, not words.`
    : `Keep it to a natural single paragraph (roughly 3–5 sentences).`;
  const noteLine = note && note.trim()
    ? `Editor's direction for this rewrite: ${note.trim()}`
    : `Improve the flow and freshness while preserving the same events and meaning.`;

  const system =
    `You are a children's picture-book editor. You rewrite the read-aloud narrative ` +
    `for ONE page. Preserve the page's events, characters, and meaning — do not invent ` +
    `new plot. ${ageLine} ${capLine} Do NOT use em dashes (—) or en dashes (–); use a comma ` +
    `or a separate sentence. Return ONLY the rewritten narrative text: no quotation marks, ` +
    `no preamble, no title, no explanation.`;

  const ask = (extra = "") =>
    `${noteLine}\n\nCurrent page narrative:\n${currentText.trim()}\n\nRewrite it now.${extra}`;

  const callOnce = (userMessage) => callWithRetry(
    () => client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system,
      messages: [{ role: "user", content: userMessage }],
    }),
    { callKind: "story_gen", onSlowCall },
  );

  const extract = (response) => {
    const block = response.content.find((c) => c.type === "text");
    if (!block) throw new Error(`rewriteNarrative: no text block (stop_reason: ${response.stop_reason}).`);
    // Strip any stray wrapping quotes the model may add despite instruction.
    return block.text.trim().replace(/^["'“”]+|["'“”]+$/g, "").trim();
  };

  let response = await callOnce(ask());
  let text = extract(response);
  let usage = response.usage;

  if (Number.isFinite(maxChars) && text.length > maxChars) {
    // One stricter retry: tell it exactly how far over it is.
    const over = text.length - maxChars;
    response = await callOnce(ask(
      `\n\nYour previous draft was ${text.length} characters — ${over} over the ${maxChars} limit. ` +
      `Rewrite it to ${maxChars} characters or fewer.`,
    ));
    const retryText = extract(response);
    // Merge token usage across both attempts for an honest cost tally.
    usage = {
      input_tokens: (usage?.input_tokens ?? 0) + (response.usage?.input_tokens ?? 0),
      output_tokens: (usage?.output_tokens ?? 0) + (response.usage?.output_tokens ?? 0),
    };
    text = retryText;
  }

  const overflow = Number.isFinite(maxChars) && text.length > maxChars;
  return { text, usage, overflow };
}
