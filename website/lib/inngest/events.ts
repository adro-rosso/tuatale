/**
 * Typed Inngest event definitions for Tuatale's pipeline workflow.
 *
 * Inngest v4 uses StandardSchemaV1 for trigger typing. `staticSchema`
 * is the type-only schema — passthrough at runtime (no validation
 * library required), full TypeScript inference for the handler's
 * event.data field. We accept the lack of runtime validation here
 * because event creation only happens from our own Server Actions /
 * route handlers (Cycle A.3); we already type-check the payload at
 * the call site.
 *
 * Two events drive the pipeline lifecycle:
 *
 *   pipeline/job.requested  — fresh job, just created by order webhook
 *   pipeline/job.retried    — admin (or system) is re-triggering a
 *                             previously-failed job; carries diagnostic
 *                             context so the function can log it
 *
 * Both events are consumed by `runPipelineJob`. The handler discriminates
 * on event.name when it needs to access the retry-only fields.
 */
import { eventType, staticSchema } from 'inngest';

// Index-signature intersection (`& Record<string, unknown>`) makes
// these types compatible with Inngest's staticSchema constraint
// (TSchema extends Record<string, unknown>) without affecting the
// runtime payload or the named-field narrowing in handlers.
export type PipelineJobRequestedData = {
  jobId: string;
  orderId: string;
} & Record<string, unknown>;

export type PipelineJobRetriedData = {
  jobId: string;
  orderId: string;
  /** Admin notes captured at retry time (Cycle A.4 admin UI). */
  retryReason: string;
  /** attempt_count BEFORE this retry. Helps the function log the bump. */
  previousAttemptCount: number;
} & Record<string, unknown>;

export const pipelineJobRequested = eventType('pipeline/job.requested', {
  schema: staticSchema<PipelineJobRequestedData>(),
});

export const pipelineJobRetried = eventType('pipeline/job.retried', {
  schema: staticSchema<PipelineJobRetriedData>(),
});

// Whole-character PREVIEW generation (S-C). The website's requestPreview action
// sends this; the worker's runPreviewJob mints ONE character image. Photo bytes
// are NOT in the payload — only photoPath (the bucket object the worker downloads).
export type PreviewRequestedData = {
  previewId: string;
  age: number;
  name?: string;
  features?: Record<string, string>;
  freeText?: string;
  /** Chosen art style (W-F) — the worker mints the preview in it. */
  style?: string;
  photoPath?: string;
} & Record<string, unknown>;

export const previewRequested = eventType('preview/requested', {
  schema: staticSchema<PreviewRequestedData>(),
});
