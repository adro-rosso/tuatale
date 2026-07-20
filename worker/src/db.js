// worker/src/db.js — the worker's own Supabase access layer.
//
// Independent of website/db/ (locked decision #2): the website's helpers are
// TypeScript with @/ path aliases and a transition-matrix validator; the worker
// re-implements the small subset it needs in plain ESM JS against the SAME
// pipeline_jobs + orders tables. Service-role client only.
//
// Transitions mirror website/db/pipeline-jobs.ts semantics (same target status
// + same fields per edge). updated_at is NOT set manually — the
// pipeline_jobs_set_updated_at BEFORE-UPDATE trigger owns it (matching the
// website's helpers). The worker only calls a subset:
//   - getOrderById / getJobById      (reads)
//   - markRunning / markAwaitingReview / markFailed
// The admin-only transitions (markShipped, markCancelled, retry, notes,
// notification tracking) stay on the website.

import { createClient } from "@supabase/supabase-js";

let _client = null;

/**
 * Lazily construct the service-role Supabase client. Reads
 * NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY from the environment.
 * The URL is normalized to its origin (defense-in-depth against a mis-pasted
 * REST URL with a trailing /rest/v1/ path — the website hit this in Phase 2.B).
 */
export function getClient() {
  if (_client) return _client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "Supabase env vars missing: NEXT_PUBLIC_SUPABASE_URL and " +
      "SUPABASE_SERVICE_ROLE_KEY are both required.",
    );
  }
  let normalizedUrl;
  try {
    normalizedUrl = new URL(url).origin;
  } catch {
    normalizedUrl = url.replace(/\/+$/, "");
  }
  _client = createClient(normalizedUrl, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return _client;
}

/** Inject a client (or reset to null) for tests. */
export function setClientForTesting(client) {
  _client = client;
}

// ---- Reads -----------------------------------------------------------------

export async function getOrderById(orderId) {
  const { data, error } = await getClient()
    .from("orders")
    .select("*")
    .eq("id", orderId)
    .single();
  if (error) throw new Error(`getOrderById(${orderId}) failed: ${error.message}`);
  return data;
}

export async function getJobById(jobId) {
  const { data, error } = await getClient()
    .from("pipeline_jobs")
    .select("*")
    .eq("id", jobId)
    .single();
  if (error) throw new Error(`getJobById(${jobId}) failed: ${error.message}`);
  return data;
}

// ---- Transitions -----------------------------------------------------------

/**
 * pending -> running (or failed/awaiting_review -> running on a regenerate).
 * Stamps started_at + the Inngest cross-references; clears the terminal output
 * fields so a regenerate doesn't leave a prior run's pdf_url / metadata /
 * completed_at stuck on the row (matches website markRunning).
 */
export async function markRunning(jobId, { inngestEventId, inngestRunId } = {}) {
  const { data, error } = await getClient()
    .from("pipeline_jobs")
    .update({
      status: "running",
      started_at: new Date().toISOString(),
      completed_at: null,
      pdf_url: null,
      generation_metadata: null,
      inngest_event_id: inngestEventId ?? null,
      inngest_run_id: inngestRunId ?? null,
    })
    .eq("id", jobId)
    .select()
    .single();
  if (error) throw new Error(`markRunning(${jobId}) failed: ${error.message}`);
  return data;
}

/**
 * running -> awaiting_review. The pipeline produced a PDF; admin to approve.
 * completed_at + pdf_url are mandatory at this edge.
 */
export async function markAwaitingReview(jobId, { pdfUrl, generationMetadata } = {}) {
  const { data, error } = await getClient()
    .from("pipeline_jobs")
    .update({
      status: "awaiting_review",
      completed_at: new Date().toISOString(),
      pdf_url: pdfUrl,
      generation_metadata: generationMetadata ?? null,
    })
    .eq("id", jobId)
    .select()
    .single();
  if (error) throw new Error(`markAwaitingReview(${jobId}) failed: ${error.message}`);
  return data;
}

/**
 * running -> failed (retries exhausted). Sets failed_at AND completed_at (the
 * latter to match website behaviour, so admin dashboards reading either
 * timestamp stay consistent), plus the structured error payload.
 */
export async function markFailed(jobId, { errorMessage, errorDetails } = {}) {
  const failedAt = new Date().toISOString();
  const { data, error } = await getClient()
    .from("pipeline_jobs")
    .update({
      status: "failed",
      failed_at: failedAt,
      completed_at: failedAt,
      error_message: errorMessage,
      error_details: errorDetails ?? null,
    })
    .eq("id", jobId)
    .select()
    .single();
  if (error) throw new Error(`markFailed(${jobId}) failed: ${error.message}`);
  return data;
}

// ---- R3b resume-state transitions ------------------------------------------

/** running/failed -> resumable: parked for the cron to re-enqueue at next_retry_at. */
export async function markResumable(jobId, { nextRetryAt } = {}) {
  const { data, error } = await getClient()
    .from("pipeline_jobs")
    .update({ status: "resumable", next_retry_at: nextRetryAt ?? null })
    .eq("id", jobId)
    .select()
    .single();
  if (error) throw new Error(`markResumable(${jobId}) failed: ${error.message}`);
  return data;
}

/** running -> blocked_on_credits: RESOURCE_EXHAUSTED; the cron probe-flips it back. */
export async function markBlockedOnCredits(jobId) {
  const { data, error } = await getClient()
    .from("pipeline_jobs")
    .update({ status: "blocked_on_credits", next_retry_at: null })
    .eq("id", jobId)
    .select()
    .single();
  if (error) throw new Error(`markBlockedOnCredits(${jobId}) failed: ${error.message}`);
  return data;
}

/** Resumable jobs whose backoff has elapsed and that are under the attempt cap. */
export async function listDueResumable(nowIso, maxAttempts) {
  const { data, error } = await getClient()
    .from("pipeline_jobs")
    .select("*")
    .eq("status", "resumable")
    .lte("next_retry_at", nowIso)
    .lt("attempt_count", maxAttempts);
  if (error) throw new Error(`listDueResumable failed: ${error.message}`);
  return data ?? [];
}

/** Jobs parked on credit depletion (the cron probe-flips these when the API recovers). */
export async function listBlockedOnCredits() {
  const { data, error } = await getClient()
    .from("pipeline_jobs")
    .select("*")
    .eq("status", "blocked_on_credits");
  if (error) throw new Error(`listBlockedOnCredits failed: ${error.message}`);
  return data ?? [];
}

/**
 * Cron re-enqueue bookkeeping: bump attempt_count and clear next_retry_at (so the
 * job isn't re-selected before runPipelineJob's markRunning flips it to 'running').
 */
export async function requeueResumable(jobId, attemptCount) {
  const { data, error } = await getClient()
    .from("pipeline_jobs")
    .update({ attempt_count: attemptCount, next_retry_at: null })
    .eq("id", jobId)
    .select()
    .single();
  if (error) throw new Error(`requeueResumable(${jobId}) failed: ${error.message}`);
  return data;
}

// ---- Proactive credit monitoring (2026-07-20) ------------------------------

/** Last recorded result for a synthetic health check. null when never run. */
export async function getOpsHealth(kind) {
  const { data, error } = await getClient()
    .from("ops_health")
    .select("*")
    .eq("kind", kind)
    .maybeSingle();
  if (error) throw new Error(`getOpsHealth(${kind}) failed: ${error.message}`);
  return data ?? null;
}

/** Record this tick's result. One row per check kind (kind is the primary key). */
export async function upsertOpsHealth({ kind, healthy, reason, detail, checkedAt, lastAlertAt, unhealthyStreak, alertState }) {
  const { data, error } = await getClient()
    .from("ops_health")
    .upsert(
      {
        kind,
        healthy,
        reason,
        detail: detail ?? null,
        checked_at: checkedAt,
        last_alert_at: lastAlertAt ?? null,
        unhealthy_streak: unhealthyStreak ?? 0,
        alert_state: alertState ?? "up",
      },
      { onConflict: "kind" },
    )
    .select()
    .single();
  if (error) throw new Error(`upsertOpsHealth(${kind}) failed: ${error.message}`);
  return data;
}

/**
 * Did a real customer render succeed recently? A successful job is free proof that
 * credits exist, so the credit monitor skips its paid synthetic probe when this is
 * true. 'shipped' and 'awaiting_review' both mean every Gemini call in that book
 * completed — the pipeline cannot reach either state otherwise.
 */
export async function hadRecentGeminiSuccess(sinceIso) {
  const { data, error } = await getClient()
    .from("pipeline_jobs")
    .select("id")
    .in("status", ["shipped", "awaiting_review"])
    .gte("updated_at", sinceIso)
    .limit(1);
  if (error) throw new Error(`hadRecentGeminiSuccess failed: ${error.message}`);
  return (data ?? []).length > 0;
}
