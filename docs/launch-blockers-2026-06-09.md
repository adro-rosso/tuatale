# Tuatale — Launch-Blocker Register (2026-06-09)

$0 enumeration from the codebase, memory, and this session's evidence. No code/spend.
Severity: **BLOCKER** (gates a real public launch) · **SHOULD-FIX** (launch-quality/ops) · **NICE** (deferrable/accepted).
"Needs" = API/spend vs local-only.

---

## A. Physical product / print fulfilment — the hardest blockers
The product is a *printed* book shipped in AU; the PDF is secondary. Almost nothing here exists.

| # | Item | Breaks for a real customer | Sev | Effort | Needs |
|---|------|----------------------------|-----|--------|-------|
| A1 | **No POD vendor chosen/integrated.** Zero print/fulfilment code (no Lulu/Blurb/Gelato/Cloudprinter/IngramSpark/AU printer). SESSION_NOTES line 17 lists it as the gating decision. | They pay for a *physical book* that can never be printed or shipped. | BLOCKER | Large (vendor selection + integration OR manual fulfilment process) | Vendor + spend |
| A2 | **PDF is not print-ready.** Screen RGB, 11×8.5in, 0 margins, **no bleed, no trim/registration marks, no CMYK, no DPI spec** (`src/page-pipeline.js:158-188`). | Printer rejects the file or prints with white edges / wrong colour. | BLOCKER | Medium (trim/bleed/colour wiring — but spec depends on A1) | Local |
| A3 | **Front cover only — no spine/back wrap** (`templates/cover-iter-1`, SESSION_NOTES:702). Spine width depends on the vendor's binding. | No printable cover for a bound book. | BLOCKER | Medium (gated on A1) | Local |
| A4 | **No shipping-address collection anywhere** — wizard has no address step; `orders` schema has no address fields. | Can't ship; can't compute shipping cost (pricing `SHIPPING_CENTS:0`). | BLOCKER | Medium (wizard step + schema + checkout) | Local |

---

## B. Payments / legal / taking real money
Currently test-mode and missing the trust/legal layer needed to charge strangers.

| # | Item | Breaks for a real customer | Sev | Effort | Needs |
|---|------|----------------------------|-----|--------|-------|
| B1 | **Stripe is TEST mode** (`sk_test_`/`pk_test_`; live flip = "Phase 5"). Dashboard webhook-endpoint registration unconfirmed (secret is in `.env.local`, but the live endpoint/event filters may not be set). | No real payment can be taken; or webhook never fires → paid order never created. | BLOCKER | Small (key flip + Dashboard endpoint + re-test) | Stripe |
| B2 | **No legal pages** — no Terms, Privacy, or Refund/Returns routes anywhere in `website/app`. | Charging without ToS/refund policy violates Stripe terms + AU consumer law; no disclosed refund terms. | BLOCKER | Small–Medium (write + publish) | Local |
| B3 | **Charged-then-failed has no recovery.** Stripe charges at checkout *before* generation (`create-checkout-session.ts`, webhook `checkout.session.completed`). On failure there is **no refund path** (no Stripe refund code anywhere), **no customer failure email** (email only on ship), and `orders.pipeline_status` is **never synced** (`updateOrderPipelineStatus()` exists but is never called) so the order shows `queued` forever. | Customer pays, generation fails, they get silence and no refund. | BLOCKER | Medium (refund hook + failure email + status sync) | Local |

---

## C. API-availability / pipeline resilience (TWO incidents this session)
This session hit (1) Gemini prepay-credit depletion mid-run and (2) a latency/hang incident exceeding the 300s ceiling on a *single* call. Verified current behaviour:

| # | Item | Breaks for a real customer | Sev | Effort | Needs |
|---|------|----------------------------|-----|--------|-------|
| C1 | **No balance/availability alerting.** Sentry *captures* pipeline exceptions but has **no alert rules** — no email/Slack/page on failure or on low credits. | Credits deplete or API hangs and nobody knows until a customer complains. | BLOCKER | Small (Sentry alert rule + a credit-balance check) | Local |
| C2 | **Degraded/empty book can pass as success.** `generateBook` never throws on page failures — returns `counts.failed`; if all pages fail it writes a 0-page PDF. The worker (`worker/src/run-pipeline.js`) **does not check `counts.failed`** — it uploads whatever PDF exists and marks the job `awaiting_review`. Only the **manual admin review** catches a broken book. | A blank/partial book could be shipped if admin misses it; no automated guard. | SHOULD-FIX | Small (assert `counts.failed===0` in worker; fail the job otherwise) | Local |
| C3 | **D2 (half-open): page/sheet escalation re-attempts on non-retryable errors.** Call-level is fixed (`gemini.js:57` "Do NOT retry on 429"), but `book-pipeline.js` escalation runs original→retry→fallback on *any* failure — so a billing 429 burns each page's full escalation before failing (observed in D-H's `escalations.log`). 429s aren't charged, but it wastes time and ends in an all-failed book. | Mid-order credit depletion → every remaining page thrashes, book ends empty. | SHOULD-FIX | Small (treat 429/billing/WallCeiling as fatal-stop, skip escalation) | Local |
| C4 | **300s wall-ceiling failures are silent per-asset.** Fixed = fatal-not-retried (`wall-ceiling.js`). A slow sheet mint fails; **protagonist needs ≥2 of 3 views or `generateBook` throws** — with exactly 2 it proceeds **degraded** (Stage 2's Adrian rendered off 2/3 sheets). Bitten ~4× this session (story-gen, Stage-1 S3, Stage-2 Adrian profile, latency probe). | Slow-API episode silently ships a book minted off an incomplete reference set. | SHOULD-FIX | Medium (retry-once-after-cooldown on ceiling, or fail the job cleanly) | Local |
| C5 | **Inngest step-ceiling false-failure: fixed, one stuck order.** B.6 moved to Connect mode (no HTTP step timeout). But order **28d052b6 is still `failed` with a valid PDF in Storage** — needs a manual admin retry to flip to `awaiting_review`. | (One-off cleanup; the class is fixed.) | SHOULD-FIX | Tiny (one admin retry) | Local |

---

## D. Pipeline reliability defects D2–D5 (status confirmed against code)

| Defect | Status | Evidence |
|--------|--------|----------|
| **D2** retry classifier mis-retries billing 429 | **HALF-FIXED** | Call-level fixed (`gemini.js:57`); page/sheet escalation layer still re-attempts (see C3). |
| **D3** hardcoded CONFIRM gate / no auto-confirm | **FIXED** | Gate lives only in CLI shim (`scripts/generate-book.js:314-332`); worker calls `generateBook()` directly, no gate. |
| **D4** temp-file race on shared render HTML | **FIXED** | `page-pipeline.js:150` uses `crypto.randomUUID()` per-render temp path + guarded cleanup. |
| **D5** parallel renders slow → need a queue | **OPEN (by-design sequential)** | `book-pipeline.js` mints sheets + renders pages **sequentially** with a 6s pacing gap; no concurrency. Throughput ≈ 1 book at a time (~6-7 min when API healthy). Fine at low volume; a capacity ceiling at scale. |

---

## E. Website / customer journey gaps

| # | Item | Breaks for a real customer | Sev | Effort | Needs |
|---|------|----------------------------|-----|--------|-------|
| E1 | **Landing is a "coming soon" placeholder** (`app/page.tsx`) with no clear path into `/start`. | A real visitor can't find how to buy. | SHOULD-FIX | Small | Local |
| E2 | **Signed download URL expires in 7 days** (`worker/src/storage.js:13`). No customer account; delivery is a single email link. File is retained (admin can re-issue), but there's no self-serve re-download. | After 7 days the customer's only link is dead. | SHOULD-FIX | Small (longer TTL / re-issue endpoint / account) | Local |
| E3 | **Email from-domain is `onboarding@resend.dev`** placeholder (`lib/email/send.ts`). | Deliverability/spam + unbranded sender. | SHOULD-FIX | Small (verify tuatale.com domain in Resend) | Resend |
| E4 | **Admin auth = single hardcoded Basic-Auth cred** in `.env.local`. | Weak admin access control as the team/data grows. | SHOULD-FIX | Small | Local |
| E5 | **Photo upload stubbed** ("coming soon", `ChildForm.tsx`; Phase 3.A). Text-description path works. | Lower likeness fidelity; not a hard blocker (text path functions). | NICE | — | (later) |
| E6 | **Preview (step 4) is a placeholder** (Phase 2.D). | "See your book before paying" promise unmet; not required to purchase. | NICE | — | (later) |
| E7 | **No customer accounts/dashboard** — anonymous checkout, email-gated delivery. | No order history / re-download self-serve. | NICE | — | Local |

---

## F. Content-safety / ops / capacity

| # | Item | Breaks for a real customer | Sev | Effort | Needs |
|---|------|----------------------------|-----|--------|-------|
| F1 | **No automated input moderation.** Customer free-text (appearance, theme, secondaries) flows straight to Sonnet/Gemini. The only safety gate is **manual admin review before ship**. | Abusive/unsafe input could generate inappropriate content; relies entirely on admin catching it pre-ship. | SHOULD-FIX | Medium (input moderation pass) | Maybe API |
| F2 | **Single-machine worker, sequential renders** (see D5). | At volume, the queue backs up (one ~6-7 min book at a time); slow-API episodes stall the single lane. | SHOULD-FIX (at scale) / NICE (early) | Medium | Local/infra |

---

## G. Residual visual defects — ship-WITH decisions (Adro's call)
Explicit so they're a decision, not a surprise. The manual admin-review-before-ship gate is the backstop for all of these.

| Defect | Current state | Ship-with? |
|--------|---------------|------------|
| **Mole count/side through rotation** | Model limit. B.9 fix reverted. D-M de-emphasis proven SUBTLE at sheet level (N=3), but **Stage 2 render-survival PARKED on the API incident** — so **production currently ships the un-de-emphasised (moderate/duplicated) mole.** | PENDING (Stage 2) — until then, ships prominent |
| **p7 helmet presence gap** | Helmet absent on the pre-ride page; D-H otherwise improved presence. | Accepted (minor) |
| **Page-8 dramatic-template aging** | Climactic template biases older/realistic. Banked. | Pending/accepted |
| **Upstream outfit-COLOUR (colourless-prose residual)** | Protagonist outfit colour rides on reference-weighting; shorts/footwear unpinned; sheet outfit-inconsistency root. Banked (story-gen schema cycle). | Accepted (locks hold consistency; exact colour uncaptured) |

---

## What this implies for sequencing (no recommendations beyond ordering)

**Hard gate — cannot launch a paid physical product without these (A + B):**
- A1 POD vendor is the **critical-path root**: it gates A2 (bleed/colour), A3 (spine/cover wrap), A4 shipping cost, and pricing's `SHIPPING_CENTS`. Nothing in A2/A3 can be finalised before A1.
- B1 (Stripe live) + B2 (legal) + B3 (charged-then-failed recovery) are independent of A and can proceed **in parallel** with the vendor decision.
- A1 has the longest lead time (external vendor selection) → starting it unblocks the most downstream work.

**Parallelisable with the above (independent, local):**
- C1 alerting, C3 escalation-stop, C2 worker counts-check, C5 stuck-order cleanup — small, self-contained reliability fixes; do anytime.
- E1 landing CTA, E2 URL expiry, E3 email domain — small website polish.

**Deferable / decision-only (won't block a soft launch):**
- E5 photo, E6 preview, E7 accounts — product enhancements; text path + email delivery already function.
- F2 capacity — only bites at volume; fine for a low-volume soft launch.
- G residuals — Adro's ship-with calls; admin review is the backstop. The mole specifically reverts to "prominent" in production unless D-M Stage 2 is completed first.

**Note on softest-possible launch:** the smallest viable real-money path that avoids the physical-product blockers entirely would be **selling the digital PDF only** (drops A1–A4) — still needs B1/B2/B3 + C1. Whether that's an acceptable product is Adro's call, not a recommendation here.
