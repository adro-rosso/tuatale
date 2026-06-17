# Reliability Cluster — Refreshed Design (2026-06-17)

$0 design refresh. No code, no migration, no deploy. Re-grounds
`docs/resume-design-2026-06-10.md` + `docs/pipeline-failure-audit-2026-06-09.md` +
`docs/launch-blockers-2026-06-09.md` against the code **as it is now**, folds in the
2-day-proven `scripts/_resume-sheets.mjs` policy, settles the open questions, and stages
the build.

**Goal:** an API incident (the 2-day Gemini outage) becomes a **non-event** for a paying
customer — not "charged + silently gets nothing."

---

## 1. Re-grounding against current code (what's stale)

### Still TRUE (the design's load-bearing facts hold)
- **Completeness gate site intact.** `run-pipeline.js:111` is still `if (!bookPdfBytes) throw`
  — an existence check. `generateBook` still always returns truthy `bookPdfBytes` and never
  throws on failed pages. The gate replacement is still valid and still un-built.
- **`orders.pipeline_status` never synced.** `updateOrderPipelineStatus()` (`website/db/orders.ts:83`)
  still has **0 production callers** (only its def, a doc-comment, and `orders.test.ts`).
  `markFailed`/`markAwaitingReview` (`worker/src/db.js:128`,`:107`) still write **only**
  `pipeline_jobs`. Order stays `'queued'` forever on any outcome.
- **Scratch dir still deleted unconditionally** (`run-pipeline.js:105`, `finally`) → nothing
  survives a failure; an Inngest retry re-mints/re-renders from zero.
- **Degrade-if-≥2 still live.** Protagonist `<2` views → throw `protagonist_sheets_insufficient`
  (`book-pipeline.js:746/:757`); `≥2 but <viewCount` → **proceeds degraded** (`:761-767`);
  secondary `<viewCount` → `skipped:true` (`:775`). The strict-gate question is still open + real.
- **No alerting / no balance check.** Still only `Sentry.captureException` (capture ≠ alert rule).

### CHANGED since the docs (stale claims to correct)
| Old claim | Now | Impact on design |
|---|---|---|
| `book-pipeline.js` anchors `:6xx–:10xx` (audit + design) | Shifted **~+120 lines** (photo→view-0 wiring, W-D, etc.). Per-subject decision `:622-662`→**`:740-780`**; return shape `:1034-1050`→**`:1166-1182`**; sheet try/catch `:603-617`→**~:725-735** | Line refs in both docs are stale — re-anchor before building |
| `server.js` `retries:2` at `:69` | **`:98`** | cosmetic |
| `run-pipeline.js` runPipeline at `:85` | def **`:56`**; gate `:111`, `finally` `:105`, upload `:116` all still accurate | gate plan unaffected |
| C3/D2 "escalation thrash HALF-FIXED" (audit, launch-blocker) | **FIXED.** `classifyFailure()` returns **"F"** for `RESOURCE_EXHAUSTED`/wall-ceiling (`book-pipeline.js:66-86`), and the page loop **aborts remaining pages on "F"** (`:1073-1083`), env-gated `D2_FATAL_STOP`. Shipped Stage 1a (`f06b38d`) | Failure is already **fast + clean**. The resume-vs-fail-fast *trigger primitive the design wanted (Q4) already exists* — but see the credit-vs-latency caveat below |
| Stage-1a idempotency "composes with this (hypothetical)" | **SHIPPED.** `findReusableBook()` (`server.js:76-92`) + `idempotency-check` step (`:110`) short-circuits a known-good job (`pdf_url` + `generation_metadata.pages.failed===0`) to `awaiting_review` with a fresh URL, before `mark-running` clears it | §3 idempotency is real now; **C5's stuck order class auto-recovers** on re-fire |
| launch-blocker **E5** "photo upload stubbed" | **STALE.** Photo upload wired (test-only) in builder + `book-pipeline.js` photo→view-0 anchor (`meta.inputs.child.photoPath` / secondary `photoPath`+`is_adult`). Privacy workstream still banked | n/a to reliability, but the audit's happy-path is now photo-capable |
| launch-blocker **E6** "preview is a placeholder" | **STALE.** Entire **preview subsystem shipped** — `preview_jobs` table, `preview/requested` Inngest event, `runPreviewJob` (`server.js:157-170`, retries:1, concurrency:3), `markPreviewFailed` (`preview.js`) | **NEW second failure surface** the old design predates — see §3.7 |

### NEW infra the old design must account for
- **Preview pipeline** = a parallel, **pre-purchase, no-charge** generation path with its own
  Inngest function + table + failure transition (`markPreviewFailed`). It is **not** a paid order;
  Cluster-2 **customer-recovery does not apply** (nothing to refund / no delivery promise). Only
  **ops-alert** has (low-priority) relevance. Keep it out of the paid-recovery hook.
- **`pipeline_jobs` schema**: status enum = `pending|running|awaiting_review|shipped|failed|cancelled`
  — **no** resumable / blocked-on-credits state, **no** `checkpoint` column (both net-new). But
  **`attempt_count` already exists** (`:77`) for backoff bookkeeping, and `generation_metadata`/`error_details`
  are JSONB.
- **No `step.sleep` anywhere** in the worker (confirmed) — the step-ceiling bug was the *HTTP-step
  request timeout*, fixed by **Connect** (B.6), not `step.sleep`. So §3.4 (cron, not `step.sleep`)
  is reinforced: there's no sleep-loop to remove, just a cron to add.

---

## 2. What the 2-day prototype proved (`scripts/_resume-sheets.mjs` → production policy)

The manual resume ran correctly for two days. Its proven behaviours **are** the production
resume policy:

| Prototype behaviour | Production primitive |
|---|---|
| **Health probe before resuming** ("don't blind-hammer") | A pre-resume Gemini latency probe (or probe-by-first-call) gates each resume cycle |
| **Abort-at-60s on the slow-call warning** (kill a dragging call, don't grind to 288s) | Per-call latency guard: on the slow-call signal, abort the run + reschedule — don't burn the full 300s ceiling × retries |
| **15-min cadence, skip-existing on each retry** | Cron re-enqueue at a capped cadence; checkpoint-restore + fingerprint reuse so each retry mints only what's missing |
| **2h cap** | Backoff window — **but the incident lasted 2 days**, so the cap can't be the customer's only protection (see credit-park) |
| **Stop on credit-depletion (`RESOURCE_EXHAUSTED` → exit 2, do NOT retry)** | **PARK** in a blocked-on-credits state + alert; polling a human-topup problem is futile (proven: 2 days) |
| **Recovered the next morning when probed** | Latency/5xx **does** self-clear on the cron cadence → resume-with-backoff is right for *that* class |

**Sharpest learning:** the prototype empirically separated the two failure classes — **latency
recovered within the probe cadence; credit-depletion did not recover for 2 days.** That validates
treating them differently (resume vs park), which the shipped `classifyFailure` "F" does **not** yet
do (it lumps both as "F").

---

## 3. Open questions — settled (confirmed/adjusted against current code)

1. **Completeness gate** replaces `!bookPdfBytes` with **all required sheets present + `counts.failed===0`**.
   **CONFIRM.** Adjustments: (a) `run-pipeline.js` currently **discards** `result.counts` +
   `result.subjectSheetStatus` (keeps only `bookPdfBytes`+`summary`) — the gate must read them before
   they fall out of scope. (b) "Required sheets" = compare `subjectSheetStatus[id].sheetFiles.length`
   to expected; **expected is now available cheaply** via `plan.subjectList[].expectedViewCount`
   (`book-pipeline.js:413`) — no need to add `expected` to each status entry as the old doc proposed.
   (c) Throw a typed `IncompletePipelineError{failedPages, missingSheets, reason}`. (d) **Strict**
   (Q6): no degraded ship — turn protagonist-≥2-degrade and secondary-skip into gate failures.

2. **Sheets-only resume FIRST, page-level second.** **CONFIRM.** Sheet minting is the costly,
   slow-to-fail surface and already has fingerprint reuse (`sheet-meta.js`); it just needs the bytes
   to survive. Page-level resume needs net-new "PDF-already-exists → skip" machinery.

3. **Checkpoint = `pipeline_jobs.checkpoint jsonb` manifest + Supabase Storage for bytes.**
   **CONFIRM.** `attempt_count` already exists for resume bookkeeping; add `checkpoint jsonb`
   (additive migration). Storage prefix `checkpoints/{jobId}/`. Restore into the fresh scratch dir
   *before* `generateBook` → existing PARTIAL_RESUME mints only the missing views.

4. **Delayed-resume via CRON re-enqueue, NOT `step.sleep`.** **CONFIRM, reinforced.** No `step.sleep`
   exists to remove; the cron just re-sends the **already-wired `pipeline/job.retried` event**
   (`runPipelineJob` already triggers on it, `server.js:100`) for jobs in a `failed_resumable` state
   whose next-attempt-time has arrived. Capped backoff lives in the cron's selection query, gated by
   `attempt_count`.

5. **Credit-DEPLETION → alert + PARK in `blocked-on-credits`; latency/5xx → resume with capped backoff.**
   **CONFIRM — strongly (the prototype proved credit-polling is futile for days).** Adjustment: the
   shipped `classifyFailure` "F" must be **split**: `RESOURCE_EXHAUSTED`/quota/billing → credit-park
   (no auto-resume; un-park on a balance-recovered signal or manual topup); wall-ceiling/5xx →
   latency-resume. The substring branch already isolates `RESOURCE_EXHAUSTED` — just fork it.

6. **Strict completeness gate (no degraded ship) + per-job Gemini cap (~$2) until page-resume exists.**
   **CONFIRM.** Strict closes the `:761` degrade path. The cap bounds runaway re-mint cost: until
   page-resume lands, every resume re-renders all 12 pages (~$0.48) on top of restored sheets — cap
   cumulative spend (track via `generation_metadata` running total / `attempt_count`) and terminal-fail
   past the ceiling.

7. **Cluster 2 = one hook off `markFailed` → (a) ops-ALERT, (b) customer-RECOVERY.** **CONFIRM** with
   three refinements:
   - **(i) Fire customer-recovery on TERMINAL failure only.** With the resume controller, `failed`
     splits into `failed_resumable` (parked/retrying — customer not yet told) vs terminal `failed`.
     Refund/email must fire only on terminal — not on a transient park, or we'd refund a job that
     later succeeds.
   - **(ii) Scope to PAID pipeline failures.** `markPreviewFailed` (pre-purchase) → ops-alert only,
     never customer-recovery.
   - **(iii) ops-ALERT** = Sentry **alert rule** (C1) + a **credit-balance check** (would have caught
     the depletion; the prototype's health-probe is the seed for a proactive balance/latency canary).
     **customer-RECOVERY** (B3) = call the already-built `updateOrderPipelineStatus()` (0 callers
     today), send a failure email (reuse the Resend `dispatchShipNotification` pattern), trigger refund.

---

## 4. Staged build plan + recommended order

Three increments. Stage 1a already shipped **fatal-stop** (failure is fast/clean) + the
**idempotency guard** (re-fires are free), so we build on a clean-failure base.

- **Stage R1 — Completeness gate (TINY, prerequisite).** Replace `run-pipeline.js:111` with the
  strict check (capture `result.counts`+`subjectSheetStatus`; compare against
  `plan.subjectList[].expectedViewCount`); throw typed `IncompletePipelineError`. One file + one error
  type + tests. **Names** a degraded/empty book as `failed` — without it, Cluster 2 only catches hard
  failures and degraded books still ship silently.

- **Stage R2 — Cluster 2 safety-net (SMALL; biggest safety win per effort).** One hook off the
  worker's terminal `markFailed` → ops-alert (Sentry rule + credit-balance check) + customer-recovery
  (`updateOrderPipelineStatus` + failure email + refund trigger). Reuses existing primitives. After
  R1+R2, a failed paid order (incl. degraded, thanks to R1) becomes **alerted + customer-told +
  refunded + status-truthful** instead of silent. This is the **non-disaster** floor.

- **Stage R3 — Checkpoint + Resume (BIG; open-question-bearing).** `checkpoint jsonb` migration +
  add `failed_resumable`/`blocked_on_credits` states; conditional scratch-dir lifecycle; Storage
  checkpoint of sheets; cron re-enqueue on `pipeline/job.retried` with capped backoff; credit-vs-latency
  split (park vs resume); per-job $2 cap. Sheets-only first; page-level resume as R3b. This turns a
  **latency** incident into a true **non-event** (book completes later, customer never notices); a
  **credit** incident becomes park-until-topup with R2 as the refund backstop.

### Recommended order: **R1 → R2 → R3.**
The old doc framed it "Cluster 2 (smaller) vs gate+resume (bigger)" — but the **gate is tinier than
Cluster 2** and is its prerequisite (it makes Cluster 2 cover degraded books, not just hard failures).
So gate first (tiny, unlocks coverage), Cluster 2 second (small, the customer-protection floor —
delivers the headline "paid-then-nothing" fix before any resume exists), resume last (big, turns the
floor into invisibility). Each stage is independently shippable and reviewable; R1+R2 alone already
make an incident a non-disaster.
```
incident today:   charged → silent nothing
after R1+R2:      charged → alerted + told + refunded   (non-disaster)
after R3:         charged → book just completes later     (non-event, latency)
                  charged → parked + topup + delivered    (credit; refund backstop)
```

---

## Post-deploy update (2026-06-17) — R1+R2 SHIPPED + prod-validated; R3 policy sharpened

**R1+R2 are live on prod and validated end-to-end.** Branch-split (Option c): `feature/wizard-revamp`
holds the parked wizard/builder/preview/photo/art-style work; `main` got R1+R2 + dormant pipeline +
docs (`d713b54`, `dde8588`). Website (Vercel) ships only the internal `/api/internal/recover` route
(no customer-facing change, `/start/style` 404s); worker (Fly) runs R1+R2 (`/health` version `dde8588`).
A synthetic prod test (refundable test-mode PI + service-role order insert, no pipeline → zero gen)
proved the whole chain: status→`failed` + `pipeline_error.recovery` marker, customer refund email,
ops credit-depletion alert, real Stripe test refund, and idempotency (repeat → `skipped`, no double
refund/email). Test-DB note: `add_style_step` was reverted on `tuatale-test` to match main — **re-apply
it when `feature/wizard-revamp` resumes.**

**R3 POLICY (Adro, locked) — refund is TERMINAL-ONLY, after resume is exhausted.**
The physical book has a **days-to-weeks print + delivery window**, so a generation **DELAY is NOT a
failure-to-deliver.** Therefore R3 must:
- **RESUME on API recovery** for transient incidents (latency/5xx AND credit-depletion-after-topup) —
  **wait, don't refund.** A multi-hour or even multi-day delay is acceptable against the fulfilment window.
- **REFUND only when terminal** — i.e. *after* the resume policy is exhausted (N attempts / M-hours/days
  cap, or a deterministic non-recoverable failure), not on first failure.
- **R2's current refund-on-failure is a SAFETY-NET PLACEHOLDER** — correct while there's no resume, but
  R3 must move the refund/customer-email behind the resume gate so a transient incident resumes silently
  instead of refunding a book that would have completed. (Keep ops-alert firing immediately regardless.)
- Implication for the credit-depletion path: park + alert (already designed), and on top-up **resume**
  rather than treating it as terminal — the customer still gets the book, just late.
