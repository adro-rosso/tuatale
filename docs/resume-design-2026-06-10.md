# Stage 1b — Completeness-gate + Queue-and-Resume Design (2026-06-10)

$0 design doc. No code. Companion to Stage 1a (charge-idempotency guard + D2 fatal-stop)
and `docs/pipeline-failure-audit-2026-06-09.md`. Cluster-1 reliability work.

## Goal
Make a paid order's generation **durable across API-availability incidents** (credit
depletion, latency/300s-ceiling) instead of silently shipping a degraded book (C2) or
re-minting everything from scratch on every Inngest retry. Two pieces: (1) a **completeness
gate** that refuses to call a degraded book "done," and (2) **checkpoint + resume** so a
re-run continues completed work instead of redoing it.

---

## 1. Completeness gate (replaces `run-pipeline.js:111`)

**Today:** `if (!bookPdfBytes) throw new Error("Pipeline produced no PDF bytes")`
(`worker/src/run-pipeline.js:111`) — an *existence* check. `generateBook` always returns
truthy `bookPdfBytes` (even a 0-page PDF) and never throws on failed pages, so a degraded/empty
book sails through to `mark-awaiting-review`.

**Replace with a completeness check, right after the `generateBook` call returns
(`run-pipeline.js:99`, where `result` is in scope).** It inspects the existing return shape:
- **`result.counts.failed === 0`** — every page rendered (`book-pipeline.js:995-1000`).
- **All required sheets present** — derived from `result.subjectSheetStatus` (`book-pipeline.js`
  returns it at `:1047`): the protagonist must have its full `viewCount` sheets (not the
  current "≥2 of 3" degrade), and no required (tier-2) secondary may be `skipped:true`.
- **`bookPdfBytes` present** (keep the existing truthiness check as a floor).

**Required small addition to `generateBook`'s return:** the gate needs *expected-vs-actual*
sheet counts per subject. `subjectSheetStatus[id]` currently carries `sheetFiles` (actual) and
`skipped`; it does **not** carry the expected `viewCount`. Either (a) add `expected: viewCount`
to each `subjectSheetStatus` entry, or (b) surface `subjectList` (with `viewCount`) in the full
return (today only the `sheetsOnly` path returns `subjectList`, `:698`). Option (a) is the
smaller change.

**On incomplete:** throw a **typed** error (e.g. `IncompletePipelineError` with
`{ failedPages, missingSheets, reason }`). This is what the resume controller (below) and
Cluster 2's on-failed hook key off — *not* a bare `Error`. This is the single decision point
where "degraded" stops being invisible.

**Coupling note:** this gate is the same site that closes **C4** (sheet-drop) and **C2**
(failed-page) from the audit — one check fixes both.

---

## 2. Checkpoint / resume

The expensive, slow-to-fail work is **sheet minting** (`~$0.04`/view, the calls that hit the
300s ceiling this session) and **page rendering** (`~$0.04`/page). Today both live only in the
**ephemeral scratch dir** which `run-pipeline.js:105` deletes in `finally` on *every* exit —
so nothing survives a failure, and an Inngest retry re-mints + re-renders from zero.

### What is already reusable (leverage, don't rebuild)
- **Sheets already have fingerprint-based reuse**: `sheet-meta.js` (`FULL_SKIP` / `PARTIAL_RESUME`
  / `MISMATCH_REMINT`). If a sheet PNG + its `*-meta.json` are on disk with a matching marker
  fingerprint, `generateBook` skips re-minting it and mints only the missing views. **Sheet-level
  resume is therefore mostly free** — it just needs the sheets to *survive* to the next run.
- **Pages have NO reuse today**: `generateBook`'s page loop (`book-pipeline.js:849`) re-renders
  every scene every run. Page-level resume needs new machinery (below).

### What gets checkpointed, and where
- **Sheets** (PNG + `*-meta.json`): persisted to **Supabase Storage** under a job-scoped prefix,
  e.g. `checkpoints/{jobId}/character-sheets/`. On resume, restore into the fresh scratch dir
  *before* calling `generateBook` → its existing fingerprint reuse mints only what's missing.
- **Pages** (`page-NN.pdf`): persisted to `checkpoints/{jobId}/pages/`. On resume, restore into
  scratch — **but** `generateBook` must learn to **skip a scene whose final `page-NN.pdf` already
  exists** (a per-page short-circuit at the top of the page loop, analogous to the existing
  `resolveImageOverride` test seam but for the *rendered PDF*, not the raw image). This is the one
  genuinely new piece of pipeline code.
- **Checkpoint manifest** (which sheets/pages are done, attempt count, last error class):
  a `checkpoint jsonb` column on `pipeline_jobs` (transactional with `status`, queryable). Storage
  holds the bytes; the manifest holds the index + resume bookkeeping.

### Scratch-dir lifecycle change
`run-pipeline.js:105` must **not** blindly delete the scratch dir on failure. On a *resumable*
failure: push completed sheets/pages to Storage + write the manifest, then it's safe to delete
local scratch. On *success* or *terminal* failure: delete checkpoint artifacts too.

---

## 3. Idempotency

- **Never re-charge the customer:** N/A — verified there is **no Stripe call in the pipeline**;
  the card is charged once at Checkout, before the webhook. (Corrects the failure-audit's
  "(re-charging)" wording, which meant Gemini COGS, not a customer charge.)
- **Never create a duplicate order:** the webhook is idempotent on `stripe_session_id`
  (unique constraint) and an Inngest retry re-runs the *pipeline*, not the webhook.
- **Never re-mint completed sheets:** Storage-restore + fingerprint reuse.
- **Never re-generate an already-finished book:** the **Stage-1a guard** (short-circuit
  `runPipeline` when the job already has a known-good `pdf_url` + `counts.failed===0` metadata)
  composes with this — a re-entry for a completed job returns the existing PDF's fresh signed URL.
- **Inngest step memoization** already prevents re-running a *succeeded* `execute-pipeline` step;
  the only re-run is of a step that *threw*. Checkpoint+restore makes that re-run cheap; the
  Stage-1a guard makes a re-entry for a completed job free.

---

## 4. Retry / backoff policy

The failures that *warrant resume* are **availability** failures (slow-call 300s ceiling,
`RESOURCE_EXHAUSTED`/429, 5xx-after-call-retries) — transient but slow to clear. The failures
that *warrant fail-fast* are **deterministic** (bad input → protagonist can't mint, validation
errors). The **D2 "F" classification (Stage 1a-ii)** is exactly the signal that separates these.

Proposed shape (parameters are open questions, §5):
- On a **resumable** `IncompletePipelineError`/availability failure: checkpoint, then schedule a
  resume after a **capped exponential backoff** (e.g. 5m → 15m → 45m → 2h), up to **N attempts
  over M hours**.
- On a **deterministic** failure: **fail-fast immediately** — no resume — and fall through to
  Cluster 2's on-`failed` hook (alert + customer comms + status sync).
- After N attempts / M hours exhausted: fail-fast (same terminal path).

**Why not native Inngest retries:** `retries: 2` (`worker/src/server.js:69`) is too few and too
fast (seconds) for an hours-long credit-depletion or latency incident. The resume cadence needs
to be minutes-to-hours and capped, owned deliberately (see §5).

---

## 5. Open questions (decide before building)

1. **Page-level resume scope.** Sheets-only resume is nearly free (reuse exists). Page-level
   resume needs a new per-page "PDF already exists → skip" short-circuit in `generateBook`.
   Do we build sheets-only first (cheaper, covers the costlier failure surface), or both at once?
2. **Checkpoint storage.** `pipeline_jobs.checkpoint jsonb` (manifest) + Storage (bytes) — or a
   separate `pipeline_checkpoints` table, or a Storage-only manifest? (Leaning JSONB + Storage.)
3. **Delayed-resume ownership.** Inngest with a custom multi-step `step.sleep` backoff loop, vs a
   scheduled cron that re-enqueues `failed-resumable` jobs, vs Inngest configurable retry policy.
   Which owns the minutes-to-hours cadence?
4. **Resume-vs-fail-fast trigger.** Reuse the D2 "F" classifier to tag a failure
   availability-vs-deterministic — computed where (worker, from the error type on the thrown
   `IncompletePipelineError`)? A credit-**depletion** specifically *cannot* auto-resolve (needs a
   human top-up) — should it resume on a long backoff anyway, or **alert + park** (a distinct
   "blocked-on-credits" state) rather than burn resume attempts? This is the sharpest question.
5. **Backoff parameters (N, M, schedule).** Match to real recovery times: this session's latency
   incident was minutes-to-hours; credit depletion was manual/hours. Needs concrete values.
6. **Completeness-gate strictness.** Is protagonist 2/3 sheets ever acceptable (current behaviour
   degrades), or is the gate strictly all-or-nothing? (This doc assumes strict; confirm.)
7. **Per-job spend ceiling.** Until page-level resume exists, a resumed run re-renders all pages —
   should total Gemini spend per job be capped to bound runaway cost across resume attempts?
8. **Scratch-dir change blast radius.** Making `run-pipeline.js`'s `finally` conditional touches
   the one place that guarantees cleanup — needs care so a non-resumable path still always cleans up.

---

## Build-order implication (no recommendation beyond ordering)
The completeness gate (§1) is the prerequisite — it's what *names* a book incomplete, which both
resume (§2-4) and Cluster 2's on-failed hook consume. Sheet-level checkpoint/restore (§2) reuses
existing fingerprint machinery and is the cheap first increment; page-level resume + the delayed
backoff controller (§3-4) are the larger, open-question-bearing parts.
