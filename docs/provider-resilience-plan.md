# Provider Resilience — Workstream Plan (2026-07-07)

**Status: PLAN. No build.** Scopes how Tuatale stops being existentially dependent on one Google image-gen endpoint before it scales. Companion to launch-blocker **C6** ([launch-blockers-2026-06-09.md](launch-blockers-2026-06-09.md)).

---

## 0. Why this exists (the problem, stated honestly)

Every image in the product — character sheets, all 12 pages, the cover, and the interactive preview — comes from **one** Google endpoint: `gemini-3.1-flash-image-preview` via a consumer `GEMINI_API_KEY`. Two structural weaknesses:

1. **It's a *preview* model.** Preview/experimental models have no SLA and variable availability. Observed 2026-07-07: repeated multi-minute windows where even a trivial image hangs >50s. (The GA `gemini-2.5-flash-image` returned in ~8s in the same window — evidence the preview model specifically is the weak link.)
2. **It's a consumer AI-Studio key.** Best-effort, rate-limited, no provisioned capacity. At volume this fails *harder* (429s stack on top of latency) — so **scale itself forces a move off this config.**

### Exposure is asymmetric — this is the key framing
- **Paid book generation is structurally protected.** It's **async** and wrapped by the reliability cluster (R1 completeness gate, R2 recovery, R3 resume/checkpoint, D2 fatal-stop, charged-then-failed recovery). A provider stall → the book is **delayed + retried in the background, not lost, no bad charge.** The customer waits for an email, not a spinner. A multi-hour outage is "books are slow today," not "paid customers got nothing."
- **The interactive pre-sale preview is the exposed surface.** A stall shows as "busy — try again." It's optional and pre-purchase (no money taken), so the cost is a degraded first impression / lost conversion, not a failed paid order.

**So this is a SCALE gate, not a first-sale blocker.** But single-provider dependency is a genuine business risk that must be engineered before volume — the answer is the ladder in §3.

### What "done" means
Not "the provider is never slow" (no image API is 100%). The bar is: **(1) no paying customer is ever left with nothing, and (2) the pre-sale surface degrades gracefully and recovers on its own.** Achievable with the four parts below.

---

## 1. GA-model quality bake-off — THE GATE (do first; blocks 2 & 3)

**A model swap is a one-line change (`gemini.js` `MODEL`), but the *output* changes.** Every quality lever in the product was tuned on `gemini-3.1-flash-image-preview`. None of it can be assumed to transfer. **No model or provider move ships until this passes.**

**What was tuned on the preview model (all must be re-validated):**
- **Character consistency** — chained-sheet-ref propagation across views (the multichar pipeline, N=1–4).
- **The 5 purchasable art styles** — watercolour, coloured_pencil, painterly, ink_wash, cutpaper. Each style's medium fidelity + the `EDGE_FILL`/`NO_FRAME` page-vocab behaviour.
- **Cutpaper's likeness quirk** — it survives likeness *because* the model collages env+clothing but keeps the **face painted-smooth**. A different model may collage the face → likeness breaks. Explicit check.
- **Photo-guided likeness** — the whole photo path depends on how the model balances the reference photo vs the prompt.
- **Reference-image count** — preview model validated at **6 refs** (allocator hands ≤2/subject → N=3 sends 6, N=4 sends 8). **A GA model may cap lower (3–4)** → multichar would break. Hard thing to test.

**Method** (cost-bounded, ~$5–15 of gens):
- Re-render the canonical Mila book (all 12 pages + cover) + a multichar trio book on each candidate, holding everything else constant (the eval-harness / `generate-book.js` with the `MODEL` swapped).
- Side-by-side vs the current preview-model output. **Adro's eye is the judge** (per the no-self-judge rule) on: per-style medium fidelity, face/likeness, consistency across pages, cutpaper face-painted behaviour, multichar ref-count survival.
- Keep the **watercolour byte-identical token guard** green (that's code-level, model-independent — confirms we didn't perturb the composition tokens).

**Candidates to bake off:** `gemini-2.5-flash-image` (GA, the obvious first — was fast today); optionally Imagen 3/4 (dedicated image model, different prompt/reference semantics — likely a bigger retune).

**Output:** a go/no-go **per style** + overall, + notes on any per-style prompt re-tuning the new model needs. If a style regresses, either re-tune its vocab or keep it preview-only until it passes.

---

## 2. Vertex AI migration (primary transport — depends on §1)

Move the primary from **AI Studio (consumer key)** → **Vertex AI (GCP)**: production SLA, **provisioned throughput** (reserved capacity that doesn't degrade under others' load), and real quota.

**What changes:**
- **Client init** — `@google/genai` supports Vertex mode (`new GoogleGenAI({ vertexai: true, project, location })`) instead of `{ apiKey }`. This is isolated to `src/gemini.js` (the one file that talks to Google).
- **Auth** — Application Default Credentials / a service-account key on the Fly worker, instead of `GEMINI_API_KEY`. New secret management.
- **Region** — pick a Vertex region for latency + data residency (AU/`australia-southeast1` for AU customers, if the model is served there; else nearest).
- **Model names** — Vertex publisher-model IDs may differ from AI-Studio IDs; confirm the GA model is available on Vertex in-region.
- **Capacity model** — **Provisioned Throughput** (reserved, sized to expected volume) vs **on-demand** (pay-per-call, shared quota). PT is the reliability lever at volume; costs more but guarantees capacity. Decision: start on-demand, move to PT as volume warrants — or PT from launch if predictable.
- **Re-run §1's bake-off ON Vertex** — same model *string* on Vertex vs AI Studio should be equivalent, but confirm (region/serving differences). PT vs on-demand shouldn't change output.

**Note:** Vertex reduces *latency-under-load* and *rate-limit* failure, and adds an SLA — but a Vertex/Gemini outage is still possible. That's what §3 is for.

---

## 3. Fallback-provider ladder (the real answer to "provider down for a long stretch")

A fallback is **NOT a drop-in.** Different providers produce different faces, styles, and reference-handling — the tuned art-style vocab and likeness behaviour will **not transfer**. The design principle: **"degraded-but-delivered" beats "nothing."** A book that ships looking a bit different during an outage is far better than a stalled queue.

**The ladder (each rung is progressively more work + more "degraded"):**
1. **Vertex-Gemini (primary)** — provisioned, §2.
2. **Alt Gemini model / on-demand Vertex** — same family → output stays close. Cheapest fallback; covers "primary model/PT degraded but Gemini is up." Likely near-transparent quality.
3. **Non-Google provider** (e.g. Imagen via a separate path, OpenAI `gpt-image`, Flux, Ideogram, Stability) — **different output characteristics; likeness/consistency/style vocab won't match.** This is the true-outage rung: accept **degraded fidelity** (lower likeness, different art feel) to keep books flowing. Would need its own minimal prompt adaptation per style.

**Design decisions (for the build phase, not now):**
- **Abstraction** — a provider interface behind `gemini.js`'s `generateImage` (each provider implements generate + its own retry/limits). The rest of the pipeline is unchanged.
- **Trigger** — health-signal-based failover (§4) for sustained outages, and/or per-call failover after the primary's retry budget is exhausted.
- **Consistency guard** — do **not** switch providers *mid-book* (a half-Gemini, half-fallback book looks inconsistent). Switch at **book start**, or restart a failed book on the fallback. Preview (single image) can fail over freely.
- **Fidelity floor** — Adro's call: how "degraded" is acceptable before it's better to *delay* than to *deliver* a lower-fidelity book. (Option: use the non-Google rung only for the interactive preview to keep the sales surface alive, and *delay* paid books rather than ship low-likeness — since paid books are async-protected anyway.)

**Honest scope:** rung 2 is modest; rung 3 is a real project (per-provider prompt adaptation + quality acceptance). Phase it — rung 2 first (biggest reliability gain per effort), rung 3 when the business can't tolerate a Gemini-family outage.

---

## 4. Provider-health monitoring + alerting (do in parallel; enables §3 failover)

Sentry currently *captures* exceptions but has no proactive signal (this overlaps launch item **C1**). Add:
- **Per-call telemetry** — latency, success/failure, 429-rate, per-attempt-timeout rate (the fail-fast wrapper already classifies these — emit them).
- **Alert rules** — sustained degradation (e.g. p95 latency > threshold for N min, or failure-rate > X%, or any 429) → ops notification (email/Slack) **and** the failover trigger for §3.
- **Synthetic canary** — a periodic cheap probe (the `apple 1:1` gen) to detect an outage *before* customers do, and to drive automatic failover.
- **Credit/quota signal** — on AI Studio, low-balance detection (was C1); on Vertex, quota/PT-utilisation.

This is the nervous system that makes the fallback ladder *automatic* rather than a manual scramble during an incident.

---

## 5. Sequencing & dependencies

```
§1 GA bake-off  ──(gate: must pass)──►  §2 Vertex migration  ──►  §3 fallback rung 2 ──► rung 3
      │                                                                    ▲
      └────────────────────────────────────────────────────────────────── │
§4 monitoring/alerting  ── parallel, independent ── enables automatic failover ┘
```

- **§1 is the hard gate** — nothing moves off the current model until it passes Adro's eye.
- **§2 depends on §1** (validate the chosen model on Vertex).
- **§4 is parallel** (needed to *trigger* §3 anyway; also closes C1).
- **§3 is phased** — rung 2 (cheap, big gain) before rung 3 (real project).
- Interim (already shipped): fail-fast+retry+hedge (`0348fcd`) + the async reliability cluster keep the paid path resilient and the preview graceful *today*, buying time to do this properly.

## 6. Open decisions for Adro (before build)
1. **Candidate model(s)** for the bake-off — `gemini-2.5-flash-image` only, or also Imagen?
2. **Vertex region** — AU (`australia-southeast1`) for latency/residency, or nearest-serving?
3. **Provisioned Throughput** from launch, or on-demand until volume justifies PT?
4. **Fallback fidelity floor** — is a lower-likeness non-Google book acceptable during an outage, or should paid books *delay* (async-protected) and the non-Google rung serve *preview only*?
5. **Priority vs the other launch blockers** (A/B physical + payments) — this is a scale gate, so likely *after* first-sale blockers but *before* marketing spend / volume.
