# Pipeline Failure-Mode Audit (2026-06-09)

$0 control-flow trace against the actual code (no API/renders/commits). Diagnose-before-fix.

## The happy-path chain (reference for every trace below)
1. **Stripe Checkout charges the card** (hosted Checkout).
2. Webhook `checkout.session.completed` (`website/app/api/stripe/webhook/route.ts:141`) →
   `createOrderFromDraft` (`:194`; **orders row created with `pipeline_status` default `'queued'`** — `supabase/migrations/20260603120100_create_orders.sql:43`) + create `pipeline_jobs` row (`pending`) + `inngest.send('pipeline/job.requested')` (`:97`).
3. Worker `runPipelineJob` (`worker/src/server.js`, `retries: 2`, `onFailure`): step **mark-running** (job→`running`) → step **execute-pipeline** = `runPipeline` (`worker/src/run-pipeline.js:85`) → `generateBook` (`:90`) → **`if (!bookPdfBytes) throw`** (`:111`) → `uploadBookPdf` (`:116`) → step **mark-awaiting-review** (`server.js:89`; job→`awaiting_review`, `pdf_url` set; `worker/src/db.js markAwaitingReview`).
4. Admin `/admin/orders` → **Ship** → `markShipped` + `dispatchShipNotification` email (`ship-job.ts:60,117`).
5. Any step error surviving the 2 retries → `onFailure` → `markFailed` (job→`failed`; `worker/src/db.js`).

**Load-bearing fact for every mode:** `orders.pipeline_status` is **never updated in any branch** — `updateOrderPipelineStatus()` exists (`website/db/orders.ts:83`) but has **0 callers**. Both `markAwaitingReview` and `markFailed` write **only the `pipeline_jobs` table**. So the customer-facing `orders.pipeline_status` is permanently `'queued'` regardless of outcome.

---

## 1. C4 — sheet mint hits the 300s wall ceiling (the Stage-2 case)

**Where caught:** `generateImage` throws `WallCeilingError` (`src/wall-ceiling.js`) → caught by the sheet-mint try/catch (`book-pipeline.js:603-617`): records `status:"failed"`, emits `sheet_mint_failed`, **does NOT rethrow, does NOT retry** — moves to the next view.

**Per-subject decision** (`book-pipeline.js:622-662`):
- **Protagonist `< 2` of `viewCount` succeeded → THROW** (`:639`, `err.kind="protagonist_sheets_insufficient"`).
- **Protagonist `≥ 2` but `< viewCount` → proceed DEGRADED** (`:641-647`: logs a warning, `sheetBuffers = subjectBufs`, `skipped:false`). ← **this is the Stage-2 case: Adrian rendered off 2/3 sheets.**
- **Secondary `< viewCount` → mark `skipped:true`** (`:655`), excluded from every page; book continues.

**Worker does next:**
- Protagonist ≥2 → degraded book continues → page render → assembly → `mark-awaiting-review`.
- Protagonist <2 → `generateBook` throws → propagates through `runPipeline` → **execute-pipeline step throws → Inngest re-runs the WHOLE pipeline (retries:2), re-minting every sheet from scratch (the scratch dir is deleted each run — `run-pipeline.js` cleanup — so no resume)** → if still failing after 2 retries → `onFailure → markFailed`.

**Terminal state:** job→`awaiting_review` (degraded) OR `failed` (protagonist<2). `orders.pipeline_status='queued'` either way.

**Customer sees:** degraded → eventually a (possibly flawed) book emailed after admin ships; protagonist<2 → **nothing** (stuck `queued`, no email, already paid).

**Human/alert:** degraded → only the **manual admin review** can catch it. failed → Sentry capture (no alert rule); admin must notice via the dashboard `status=failed` filter.

### THE DESIGN FORK (tradeoffs only — not deciding)
Current behaviour is a **hybrid**: degrade-if-≥2 (protagonist) / skip (secondary), fail-if-<2 — i.e. it *silently degrades* rather than cleanly doing (a) or (c).
- **(a) Fail the whole book + surface for retry.** Add one typed guard after Section A: "if any required sheet is missing, throw a `RetryablePipelineError`." Effort: **small** (one check + a typed error). *Caveat:* the existing Inngest retry re-runs the entire pipeline and **re-mints all sheets (re-charging)** — so "surface for retry" is only clean if paired with (b) or step-level caching.
- **(b) Queue-and-resume the missing mint when the API recovers.** The pipeline already has **fingerprint-based sheet reuse** (`sheet-meta.js` FULL_SKIP / PARTIAL_RESUME) — succeeded sheets are written to disk + meta and a re-run mints only the missing view. The blocker is that the worker's **scratch dir is deleted each run**, so nothing survives to resume from. Effort: **medium** — persist succeeded sheets to Storage keyed by fingerprint, restore them into the scratch dir before `generateBook`, and the existing PARTIAL_RESUME path mints only the missing sheet. Leverages machinery that already exists.
- **(c) Hard-block completion until all sheets exist.** Tighten the threshold from `≥2` to `==viewCount` (and turn the secondary `skip` into a fail). Effort: **tiny** (change the threshold), but without (b) it just fails more often and re-mints fully on each retry.

**Closest to current:** none cleanly — it's "degrade silently (a/c are both partial)." (a)/(c) buy a completeness guarantee at the cost of more failures + re-mint spend **unless** paired with (b)'s resume.

---

## 2. C4/availability — page render hits the 300s ceiling

**Where caught:** `renderPageWithTemplate` wraps the whole render in try/catch and on **any** error (incl. `WallCeilingError`) returns `{success:false, structuredError}` (`page-pipeline.js:801-824`; comment at `:802` explicitly preserves "WallCeilingError"). The page loop calls `tryRender` with **no surrounding try/catch** (`book-pipeline.js:860`) — it relies on this success:false contract, so the book does **not** crash.

**What happens next** (`book-pipeline.js:865-925`): `classifyFailure` (`:832`) returns `"A"` for a ceiling error (only `"B"`=region-too-small and `"C"`=no-font-fits are special) → **retry same template once** (`:883`, after a 2s sleep) → still failing → **escalate to fallback template** (`:905`) → still failing → `outcome="failed"`, `pdfPath=null` (`:922-925`).

**Consequence in a slow episode:** one page can burn **up to 3 full renders, each up to 300s ≈ 900s**, before being marked failed. (Contrast §1: a *sheet* ceiling is caught-but-not-retried; a *page* ceiling is retried+escalated.)

**Assembly** (`:978`): `successfulPages = perPageResults.filter(r => r.outcome !== "failed")` → the failed page is **dropped**; remaining pages merge into `book.pdf`. **A book CAN finish missing a page.**

**Terminal state:** job→`awaiting_review` with an N-page book (N<12). `orders.pipeline_status='queued'`.

**Customer sees:** a book missing page(s) if admin ships it. **Human/alert:** manual admin review only.

---

## 3. D2 — non-retryable error mid-render (billing 429, the D-H thrash)

**Call level (correct):** `gemini.js classifyError` (`:70-91`) — a 429 is not in `RETRYABLE_5XX` (`[500,502,503,504]`), has no network code, no "fetch failed" → **returns `null` → not retried at the call level** (`:57` comment: "Do NOT retry on 429 — we want it visible").

**Escalation level (re-attempts anyway):** the 429 surfaces as a failed render → `classifyFailure` → **`"A"`** (it's not region/font) → the page loop runs **original → retry (`:883`) → fallback (`:905`)**. Each attempt re-calls Gemini, gets an instant 429, fails. **3 wasted attempts per page** (this is exactly the D-H `escalations.log`: every page logged `attempt:1,2,3` with `failureType:"A"` and the `RESOURCE_EXHAUSTED` message).

**Full-book 429 terminal state:** every page exhausts its 3 attempts → all `outcome:"failed"` → `successfulPages = []` → **`book.pdf` written with 0 pages** (`:979-987`; a valid but empty PDF, ~hundreds of bytes — the D-H run produced a 583-byte stub). 429s aren't charged, so the cost is wasted *time*, not dollars; but the book is empty. Then §4 governs what happens to that empty book.

---

## 4. Partial / degraded book reaches review (C2)

**Is `counts.failed` checked before `awaiting_review`?** **No.** The worker's only guard is `if (!bookPdfBytes) throw new Error("Pipeline produced no PDF bytes")` (`run-pipeline.js:111`). `generateBook` **always returns `bookPdfBytes`** (the merged PDF) and **never throws on page failures** — it returns `counts.failed` in the summary (`book-pipeline.js:995-1000, 1034-1050`) but the worker reads only `result.bookPdfBytes` (`:99`) and `result.summary` for metadata. An empty 0-page PDF is still truthy bytes → passes `:111` → `uploadBookPdf` → `mark-awaiting-review`.

**So the only thing stopping a degraded/empty book from reaching a customer is the manual admin "Ship" click.** There is **no automated completeness gate** anywhere between `generateBook` and `awaiting_review`. `counts.failed` rides along in `generation_metadata` (visible to a diligent admin) but gates nothing.

**Terminal state:** any book (0–12 pages, missing sheets) → job `awaiting_review`. Customer impact depends entirely on admin diligence.

---

## 5. B3 — charged-then-failed recovery

- **Charged before generation:** Stripe Checkout charges the card; the webhook fires on `checkout.session.completed` (payment already succeeded) and only *then* creates the order + job + Inngest event (`webhook/route.ts:141,194,97`). **The customer has paid before a single sheet is minted.**
- **`updateOrderPipelineStatus()` — 0 callers** (`website/db/orders.ts:83`; only self-references at `:7` doc + `:83` def). `markFailed`/`markAwaitingReview` touch only `pipeline_jobs`. → **`orders.pipeline_status` stays `'queued'` forever.**
- **No refund code** anywhere (`grep` across `website/` + `worker/` + `src/`: only a *comment* at `pipeline-jobs.ts:323` mentioning "order refund"; no `stripe.refunds.create`).
- **No failure email:** the only email is `dispatchShipNotification`, fired from the admin **Ship** action (`ship-job.ts:60`) — success path only. **No email on `markFailed`.**

**Terminal state after a generation failure:** `pipeline_jobs.status='failed'` (with `error_message`/`error_details`); **`orders.pipeline_status='queued'`** (unchanged); no refund; no email.

**Customer sees:** **nothing.** They paid, the success page told them "we'll email you in 3–5 days," and no email ever comes. Their order lookup (if any) shows `queued`.

---

## 6. C1 — alerting

- The only alerting-adjacent code is `Sentry.captureException` in the webhook (`route.ts:89,102`, tagged `pipeline-job-create` / `inngest-dispatch`) and in the worker's `onFailure` path. **Sentry capture ≠ alert** — alert *rules* (email/Slack/paging) are Sentry-dashboard config, not in the repo; there is **no evidence of any alert rule**, and nothing in code sends a notification on failure.
- **No balance/quota/availability check** anywhere (`grep` for balance/quota/credit-check across `worker/src` + `src` → no hits; only unrelated "title" prompt text).
- **What would have surfaced this session's two incidents?** **Nothing automated.** (a) Credit depletion: produced an empty book → would have ridden silently into `awaiting_review` (§4); the only signal was the developer watching the run. (b) API hang: the 300s ceiling fired and failed the call, but there is no aggregate "calls are timing out" alert; it surfaced only because a human was watching the background task. A real paid order during either incident would have failed silently per §3/§5.

---

## Dependency / coupling note (informs fix order)

- **C4 (sheet-drop) and C2 (failed-page gate) share ONE mechanism: the completion-quality gate.** Today that gate is `if (!bookPdfBytes) throw` (`run-pipeline.js:111`) — an *existence* check. Replacing it with a *completeness* check ("all required sheets present **and** `counts.failed === 0`, else throw a typed failure") fixes **both** C4 and C2 at the same site. They are not two separate fixes — they are one gate.
- **D2 (escalation thrash) feeds C2.** D2 lives in a different site (`book-pipeline.js` `classifyFailure`/escalation). Fixing it (treat 429/billing/`WallCeilingError` as fatal-stop — skip retry+escalate) makes a full-book failure **faster and cleaner**, which then hits the C2/C4 completeness gate sooner. D2 is independent to *write* but composes with the gate: D2 = "fail fast," gate = "catch the failed book."
- **C1 (alerting) and B3 (customer recovery) share the failure-detection trigger.** Both want a hook on the `pipeline_jobs.status → 'failed'` transition (which `markFailed` already performs reliably). From that single trigger, work fans out two directions: **ops-facing (C1: Sentry alert rule / notification)** and **customer-facing (B3: sync `orders.pipeline_status`, send a failure email, issue a refund)**. C1 does **not** strictly depend on B3's order-sync — it can watch `pipeline_jobs.status` directly — but a single "on job failed" hook is the natural shared entry point for both.
- **B3's order-status sync also underpins any customer-facing status UI** (the success page / order lookup), independent of alerting. It is the smallest shared primitive: calling the already-existing `updateOrderPipelineStatus()` from the worker's `markAwaitingReview`/`markFailed` (and the ship action) makes `orders.pipeline_status` truthful, which both the customer UI and a `failed`-transition alert can then rely on.

**Net coupling:** two clusters — **{C4, C2, D2}** around the completion gate (one gate fix + one fail-fast tweak), and **{C1, B3}** around the `status='failed'` transition (one hook → ops alert + customer sync/email/refund). The two clusters meet only at "a book/job ends failed," not in shared code.
