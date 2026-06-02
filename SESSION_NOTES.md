# SESSION_NOTES.md

_Last updated: 2026-05-29_

Resume document for the DaBookTing project. Read this end-to-end when picking work back up.

The project is in **Stage-2 — interiors + COVER both shipped; LAUNCH BLOCKERS next (2026-05-29)**. Interior catalogue = four production page templates: prompt-2-iter-2 (split-spread, any-length), prompt-3-iter-2 (Type C, ≤300 intimate), prompt-6-iter-1 (≤200 climactic, reserved), prompt-8-iter-1 (vertical-split portrait-pinned 3:4, ≤280); prompt-4 + prompt-7 deferred/scrapped + filtered. **Front-cover system shipped** (cover-iter-1, Variant C: story-linked via a new `cover_concept` field, face-orientation guardrail, auto-fit title panel) and validated on 3 protagonists. **Robustness pass complete** (6 non-Iris books; 5 website-prerequisite defects fixed/noted). **Multi-subject parked** (non-human reference-sheet approach proven; two-human case open). **The only remaining work before launch is the two BLOCKERS — both NOT STARTED: (1) print-on-demand vendor decision (gates the cover wrap/spine/back + unit economics; user in Australia), (2) the MVP website on the `{name, age, theme} → book.pdf` contract (needs a job queue, per D5).** Path 1 locked. Phase 1 + Phase 2 closed.

---

## 1. Current status (the only section that changes often)

**Phase:** **Stage-2 — COVER SYSTEM shipped; catalogue (4 templates) + robustness pass complete. Launch blockers next (vendor + website).** Four production page templates (prompt-2 any-length, prompt-3 ≤300 intimate, prompt-6 ≤200 climactic-reserved, prompt-8 ≤280 vertical/portrait; prompt-4 + prompt-7 deferred/scrapped + filtered). Cover system (front cover, Variant C) shipped and validated on 3 protagonists. Robustness batch (6 non-Iris books) run; 5 website-prerequisite defects fixed (D2/D3/D4/slug) or noted (D5). Multi-subject investigation parked (non-human proven, two-human open). **The remaining work is the LAUNCH BLOCKERS, both NOT STARTED: (1) print-on-demand vendor decision, (2) MVP website.** Path 1 locked: variable typography per page; ship with compromises; learn from customers. Phase 1 + Phase 2 closed.
**Today:** 2026-05-29.

**⏸ NEXT SESSION — RESUME HERE (the real launch blockers, both NOT STARTED):**
1. **Print-on-demand VENDOR decision** — none chosen. User is in **Australia** (fulfillment/shipping constraints; thin 12-page spine is a binding constraint). This decision GATES the cover WRAP (spine + back — currently only the FRONT cover is built) AND unit economics. Start here or with (2).
2. **MVP WEBSITE** — build against the existing `{name, age, theme} → book.pdf` contract. MUST use a **job queue** (bounded/serial workers), NOT parallel process spawns — see D5 (6 concurrent renders ran 2-3× slower; concurrency is a website-architecture constraint, not a pipeline bug). Auto-confirm path (`--yes` / `AUTO_CONFIRM=1`) already exists for unattended runs (D3).

**Last completed action (2026-05-29): COVER SYSTEM shipped + multi-subject investigation parked.**
- **cover_concept field** added to story-gen ([src/anthropic.js](src/anthropic.js)) — Sonnet, having written the whole story, describes the ideal cover image for THIS story (signature moment + motif + mood); schema `required` is now `[title, character, scenes, cover_concept]`, with a defensive presence check; the cover prompt CONSUMES it (story-linked covers, no longer generic). Orthogonal to scenes/Option-B (confirmed).
- **Face-orientation guardrail** in the cover_concept instruction (faces RIGHT-SIDE-UP/legible; no inverted/extreme-overhead/foreshortened) — added after Iris first rendered upside-down (lying-on-back + overhead → inverted face). Protects all future covers.
- **[templates/cover-iter-1/](templates/cover-iter-1/)** (Variant C: hero art full-bleed + translucent cream lower-third panel `rgba(240,234,219,0.92)` + EB Garamond title auto-fit via `fitTextToRegion` + italic "A story for <Name>" subtitle). `kind:"cover"` excludes it from the interior page-template registry ([src/template-registry.js](src/template-registry.js) skips non-"page" kinds). Renderers: [scripts/render-cover.mjs](scripts/render-cover.mjs) (exports `renderCover()`), [scripts/render-cover-batch.mjs](scripts/render-cover-batch.mjs) (driver, `--only <name>` filter).
- **3 covers validated** (Iris/Anneliese/Søren) at [output/covers/<name>/](output/covers/) — story-specific signature moments, on-model (sheets dominate appearance, option (a)), faces right-side-up, calm lower zone holds, title auto-fits. Anneliese/Søren approved as-is; Iris re-rendered once under the face guardrail ("Iris and the Winking Star").
- **Multi-subject investigation** (Stage A, non-human) — see Section 2 "Multi-subject probe (2026-05-29)". PARKED, nothing wired into the pipeline; all artifacts throwaway in `templates/_multisubject-probe/`.

**Earlier this session (2026-05-24): prompt-8-iter-1 (vertical-split) shipped** — catalogue's first portrait-image template, first on the side-by-side-with-portrait arrangement axis. 3:4 aspect-pin to Gemini ([src/gemini.js](src/gemini.js)) matches the 58% CSS column aspect exactly (zero `object-fit:cover` crop) — the same aspect-pin lever built for prompt-7 v1 work, now paying off cleanly. Validated solo N=3 over $0.12 (Milky Way / towering tree / stress: indoor-reading-looking-down): pin held identically across all 3 (aspect 0.747 vs target 0.750), Gemini composed vertically on every render — including the stress scene where it found a tall-room interpretation for a low/seated/looking-down action (subject in lower 40%, room/window rising above). Productionised: moved `templates/_vertical-split-prototype/` → [templates/prompt-8-iter-1/](templates/prompt-8-iter-1/), `id` updated, validation renders preserved in [templates/prompt-8-iter-1/test-output/](templates/prompt-8-iter-1/test-output/), registry test updated for 4 active templates + 2 deferred (prompt-4 + prompt-7), all 6 tests pass. See Section 2 "Catalogue expansion lessons (2026-05-24)" for the arrangement-axis lens and the full session's banked failures.

**Earlier still this session (2026-05-24, ~$0.36 in Gemini spend — only prompt-8's $0.12 shipped, the rest is banked-failure cost):** Three attempts at catalogue expansion before vertical-split landed. (1) **prompt-7-iter-1 SCRAPPED**: tried "quiet-vignette / breath page" — small contained image in upper-center on abundant cream. Gemini wouldn't reliably honour "small vignette" size language even with 16:9 aspect pin (N=3 stress: 1/3 strong-pass for the natural firefly scene, 2/3 frame-fill on expansive + interior scenes). Built a v2 CSS-structural rescue (three-band layout with feathered-shrunk-raster) but firefly-as-test-image was busy enough that the feathered edge looked marginal — concept-validation not conclusive, parked. (2) **frame-break Flavor 1 prototyped twice**: art-bleeds-past-inset-frame on retrofit images (1333 p9). v1 (frame inside full-page image) had the bleed go into more image — invisible effect. v2 (corrected: image strip narrower with cream margins L+R, image taller than frame) reads as mild-elegant but not exciting — frame-break's real drama requires Flavor-2 subject-isolation (bg-removal: fragile on watercolor — soft hair edges, translucent glow, wash integration all fail modes; deferred with eyes open). (3) **"workhorse-drama" prototyped**: full-bleed image top 75% + clean text band bottom 25%. The hard horizontal cut + gallery aesthetic worked — but on reflection it's the same top/bottom ARRANGEMENT as prompt-3 (just bigger image / different image-text boundary), so it's a size/drama VARIATION not a new arrangement. **NOT shipped** — keeping the catalogue lens at arrangement-axis-first. All three failures + prompt-8's success informed the arrangement-axis lens (Section 2).

**Superseded earlier (2026-05-23):** Count-drift resolved at the product layer. Shipped Option B cheap-repair (valid-leading-12 truncation in [src/anthropic.js](src/anthropic.js)) + 3 system-prompt cuts removing don't-think-of-pink-elephant reinforcement. N=3 post-simplification probe ($0.43): drift detoxified to simple historical duplicate-p12 + one quiet empty-stub; catastrophic 37-scene + sentinel-"DISCARD" modes GONE. **Priming hypothesis split: WRONG that reinforcement was root cause (rate stayed ~67%), RIGHT that it was worsening drift into dangerous modes.** Net: drift invisible to the product. See Section 2 "Count-drift resolution (2026-05-23)".

**Superseded earlier (2026-05-22):** Foundation integration sign-off. Rendered the 1333 Shimmer story as a full 12-page book through the 3-template registry + Type C prompt-3 + decoration-free design + anti-repetition rule 4 — first time all four pieces cohere in one artifact. **12/12 success, 0 escalations.** One Gemini-composition variance on the p9 climax fixed via augmented-action override ($0.04, landed first try). Banked technique: for "good scene, bad composition" Gemini misses, override the action with a camera/orientation nudge. See Section 2 "Augmented-action override technique" and "Foundation integration validated in full book."

**Superseded earlier (2026-05-22):** anti-repetition rule 4 implemented (rule-4 prompt addition in [src/anthropic.js](src/anthropic.js)) + 2-run story-gen probe ($0.29) confirming the rule works (baseline 4.3/11 adjacent-same pairs → probe 0/11; all 3 guardrails held). Fix 1 also applied: rationale instruction amended to permit honest variety reasons + 4th Example modeling it.

**Superseded earlier (2026-05-21):** prompt-3 migrated to Type C; 44% escalation eliminated. (2026-05-20: Stream 3 orchestration shipped; prompt-6 third template validated; prompt-4 deferred.)

Stream 3 deliverables (2026-05-20):

- [src/template-registry.js](src/template-registry.js) — `loadTemplateRegistry()` + `buildTemplateMetadataForPrompt()` + `findTemplate()`. Discovers all template configs from disk and provides formatted metadata for v2 system prompt placeholder substitution + runtime enum for the `template_id` field in the story schema.
- [src/anthropic.js](src/anthropic.js) — v2 system prompt with TEMPLATE SELECTION section, `layout_intent` field added to scene schema (template_id + rationale, both required), runtime enum built from the template registry, MAX_TOKENS bumped to 16384 to prevent truncation on multi-template story output.
- [scripts/generate-book.js](scripts/generate-book.js) — full multi-template orchestration rewrite: CONFIRM gate prints per-scene plan + template distribution + cost estimate, per-page render via `renderPageWithTemplate`, single-retry on transient 500/network failure (Failure A), escalation-to-default-template on B-class min-region-size or content failure (Failure B), [escalations.log](output/books/2026-05-20-iris-1230/escalations.log) NDJSON post-mortem, [pdf-lib](https://github.com/Hopding/pdf-lib) merge into final book.pdf.
- [templates/prompt-2-iter-2/config.json](templates/prompt-2-iter-2/config.json) — first Type B template config (regionDetection: null, autoFit: null, static CSS positioning) with selection_metadata for v2 system prompt. Pairs with the existing template.html shipped 2026-05-17.
- [output/books/2026-05-20-iris-1230/book.pdf](output/books/2026-05-20-iris-1230/book.pdf) — first multi-template book end-to-end: 12 pages, 5×prompt-2 + 7×prompt-3 (1 escalated from prompt-3 → prompt-2 on B-class minSizePx failure), $0.52, 9770 KB. Visually validated.
- [templates/prompt-6-iter-1/](templates/prompt-6-iter-1/) — **third production template (Type B climactic full-bleed). First-attempt success 2026-05-20** at $0.04. Image fills entire page edge-to-edge; text overlay band in bottom 30% on `rgba(240, 234, 219, 0.92)` translucent cream backdrop; EB Garamond 18pt centered. selection_metadata: `max_narrative_chars: 200`, `aesthetic_intent: ["climactic", "dramatic", "peak-emotion", "cinematic-scale", "full-bleed", "wonder"]`. Test artifacts preserved in `test-output/`: page-01.pdf (Part 1 mechanical), page-02.png + page-02.pdf (Part 2 first-attempt validation). Ready for v2 system prompt to pick on climactic scenes.
- [scripts/test-prompt-6.js](scripts/test-prompt-6.js) — two-part integration test for prompt-6 (Part 1 imagePathOverride mechanical, Part 2 fresh Gemini at $0.04 with CONFIRM gate, SKIP_PART_1 env var support).

Stream 3 hardening deliverables (2026-05-21):

- [src/page-pipeline.js](src/page-pipeline.js) — **Type C path added.** `renderPageWithTemplate()` now supports three modes: Type A (detection + auto-fit), Type B (static CSS), Type C (no detection + auto-fit into a fixed `config.textRegion`). The mode check rejects only the invalid combo (detection ON + auto-fit OFF). Type C is the `else if (autoFitEnabled)` branch — "Type A minus the detect step."
- [src/anthropic.js](src/anthropic.js) — bounded one-retry on shape-validation failure (scene count ≠ 12, page numbering, missing character), raw-response capture to `output/stories/_failed/<ts>-attempt<N>-raw.json` on every shape failure, and three "EXACTLY 12 scenes" prompt reinforcements. Fixes the scene-count drift defect (Sonnet emitting a duplicate 13th scene).
- [templates/prompt-3-iter-2/](templates/prompt-3-iter-2/) — **migrated to Type C.** config.json: `regionDetection: null`, `autoFit` kept, `textRegion: {x:0.10, y:0.70, width:0.80, height:0.25}`, decoration language removed, composition prompt rewritten (hardcoded cream zone, kept CONTAINED VIGNETTE paragraph). template.html: feathered cream backdrop (opacity 0.30) + triple text-halo + flex-centered fixed box.
- [templates/prompt-4-iter-1/config.json](templates/prompt-4-iter-1/config.json) — `deferred: true` flag added; [src/template-registry.js](src/template-registry.js) now filters `deferred` templates out of the registry (the probe surfaced that prompt-4 was still selectable despite being deferred).
- Test/probe scripts (2026-05-21): probe-template-selection.js, test-color-correction.js + test-color-correction-feathered.js (prompt-4 post-process tests, $0), verify-prompt-3-decoration-fix.js, test-prompt-3-phase2.js, test-prompt-3-typeC.js, verify-prompt-3-typeC-fresh.js, test-prompt-3-typeC-reposition.js, test-prompt-6-robustness.js.

Stream 3 sign-off deliverables (2026-05-22):

- [src/anthropic.js](src/anthropic.js) — **Selection rule 4 added** in `SYSTEM_PROMPT_TEMPLATE`: "Prefer varying the template on adjacent pages..." as a SOFT preference with two HARD constraints (max_narrative_chars always wins; never use prompt-6 to break a run — climactic reservation preserved). **Rationale instruction amended** to permit honest variety reasons (e.g. "chosen for adjacent-page variety") + 4th Example modeling it — closes the rationale-confabulation failure mode (Sonnet had been inventing char-cap reasons when the real motivation was variety).
- [output/books/2026-05-22-iris-1333/](output/books/2026-05-22-iris-1333/) — first book at the validated foundation. 1333 Shimmer story, 12 pages, **0 escalations**, $0.60 base + $0.04 p9 regen. Distribution: 6 prompt-3 + 5 prompt-2 + 1 prompt-6 (perfect ABAB with climactic peak at p9). Validated as good visual rhythm, not mechanical seesaw.
- [scripts/regen-1333-p9.js](scripts/regen-1333-p9.js) — one-off p9 climax regen with augmented-action camera-orientation nudge (Gemini had painted Iris inverted/head-toward-viewer); $0.04, fixed first try. Original preserved at `pages/page-09-original.{png,pdf}` for comparison.
- Anti-repetition probe scripts (2026-05-22 paid runs): output/stories/2026-05-22-iris-1333/, output/stories/2026-05-22-iris-1338/ — 2 story-gens validating rule 4 (4.3→0 adjacent-same pairs).

Stream 2 deliverables (2026-05-19, still active):

- [src/text-measurement.js](src/text-measurement.js) — `measureText()` Puppeteer-based dimensional prediction.
- [src/region-detection.js](src/region-detection.js) — `detectCleanRegion()` largest cream rectangle in ROI via RGB-Euclidean classifier (threshold 30).
- [src/auto-fit.js](src/auto-fit.js) — `fitTextToRegion()` iterates fontSize from max to min.
- [src/page-pipeline.js](src/page-pipeline.js) — `renderPageWithTemplate()` orchestrator. **Updated 2026-05-20** to handle Type A vs Type B template paths (Type B skips region-detect + auto-fit + dynamic-CSS injection; static template CSS is used verbatim with fontSize from config.typography).
- [templates/prompt-3-iter-2/config.json](templates/prompt-3-iter-2/config.json) — first complete template config; **updated 2026-05-20** with selection_metadata for v2 system prompt.

Deferred template (third-template slot ultimately filled by prompt-6-iter-1, not this one):

- [templates/prompt-4-iter-1/](templates/prompt-4-iter-1/) — config.json + template.html (Type B, asymmetric off-center). **DEFERRED INDEFINITELY** after 5 iterations across 2 sessions tested 3 distinct architectural patterns (partial-bleed CSS mask v1-v3, all-four-edge mask v4, color-matched cream substrate v5) and none landed. Color-correction post-process tests ([scripts/test-color-correction.js](scripts/test-color-correction.js) + [scripts/test-color-correction-feathered.js](scripts/test-color-correction-feathered.js)) confirmed feathered post-process can deterministically dissolve the rectangle, but the workaround feels architecturally awkward against prompt-6's clean first-attempt full-bleed result. Iteration artifacts preserved in `test-output/`: page-02.png/pdf (v1), page-02-v2.png/pdf, page-02-v3.png/pdf, page-02-v4.png/pdf, page-02-v5.png/pdf, plus page-02-v5-corrected.png/pdf (binary snap) and page-02-v5-corrected-feathered.png/pdf (gradient blend). See Section 2's four banked lessons: "CSS crop math is load-bearing..." (2026-05-20), "Prompt engineering for organic edges + the bounded-image-bleed trap" (2026-05-20), "Color-matched substrate is the right concept but Gemini's color precision is insufficient" (2026-05-20), and the design heuristic "Full-bleed wins where inset-on-cream loses" (2026-05-20) extracted from the prompt-4 vs prompt-6 contrast.

**Integration test result (Mateo p9 via prompt-3-iter-2):**
- Detected cream region: 832×165 px (source) → 663.00 × 131.48 pt (page) via object-fit:cover conversion
- Auto-fit: **fontSize 13pt**, 5 lines, 103.95pt rendered height in 131.48pt budget (27pt headroom)
- Pipeline timing: regionDetect 45ms, autoFit 10,402ms (4 iterations × ~2.6s/iter), render 2,882ms, total 13.3s
- Cost: $0 for the test (used v4 image override; no Gemini call). Per-page Gemini cost in production = ~$0.04.

**Path 1 LOCKED (2026-05-19):** ship with compromises, learn from customers.
- Auto-fit produces variable typography per page: 11pt for dense narratives, 13-15pt for moderate, capped at 16pt
- 13pt is borderline-readable for children's book convention (typical body is 14-18pt) but accepted
- Aesthetic tradeoff (cleaner text-cream separation vs. blooming text-on-painted integration) accepted

**Reference values from validation (baseline for Stream 3 work):**

| Page + typography / Region | Width resolved | Lines | Rendered height (pt) |
|---|---|---|---|
| Mateo p9 in prompt-2-iter-2 (EB Garamond 18pt, 1.7 lh, 32% width) | 253.43pt | 15 | 458.96 |
| Mateo p9 in prompt-3-iter-2 (Architects Daughter 16pt, 1.6 lh, 70% width) | 554.39pt | 8 | 204.75 |
| Sage p10 in prompt-3-iter-2 (Architects Daughter 16pt, 1.6 lh, 70% width) | 554.39pt | 7 | 179.16 |
| **Mateo p9 page-pipeline result (auto-fit into v4 detected region 663×131pt)** | **663.00pt** | **5** | **103.95 (at 13pt)** |

**Next concrete action (your move, next session): Step 3 of the 3-step template-quality plan — catalogue expansion.**

The 3-step template-quality plan is closed except for Step 3:
- **Step 1 — decoration removal** ✓ DONE (2026-05-21).
- **prompt-3 Type C reliability fix** ✓ DONE (2026-05-21). 44% escalation eliminated; **0 escalations in the 1333 book** proves Type C structural reliability in practice.
- **Step 2 — anti-repetition rule 4** ✓ DONE (2026-05-22). Validated in full book: ABAB rhythm reads as good pacing, not mechanical seesaw. Rule 4 ships as-is. Do NOT loosen to "avoid runs of 3."
- **Foundation integration** ✓ DONE (2026-05-22). 1333 Shimmer book is the foundation artifact — all three foundational changes cohere at perfect-product standard.
- **Step 3 — catalogue expansion** — NOT STARTED. Add templates beyond the current 3. Apply the **design laws** banked in Section 2 ("Design laws for template work, 2026-05-21"): prefer Type B / Type C over Type A; decorations scene-neutral or scene-driven, never fixed-motif and never load-bearing for layout; avoid inset-on-cream; structural-lever > prompt-grind when reliability/quality seem to trade. Candidate ideas to scope when starting: title-page, dialogue/two-column, full-spread without text, calm-quiet bedtime variant. Likely ~$0.08-0.32 per new template iteration cycle.

**Other open items (not blocking Step 3):**
- **WATCH-ITEM (passive, not a task): rationale-honesty.** Fix-1 applied 2026-05-22 (rationale instruction amended + 4th Example modeling honest variety rationale), but the foundation render reused an existing story.json (1333) whose rationales were already honest. On the NEXT fresh story-gen, passively check that variety-driven prompt-2 picks state honest reasons ("chosen for adjacent-page variety") rather than confabulated char-cap claims. Don't spend a dedicated call; just look when it happens.
- **Re-run any pre-1333 book on the new prompt-3 Type C.** The 1104 book was rendered on the OLD prompt-3 Type A (that render surfaced the 44% defect). The 1333 book is now the canonical Type-C-era example; pre-1333 books are pre-architecture.
- **generate-book.js cost accounting** — failed-retry-attempt tokens are captured but not summed into meta.json cost (flagged 2026-05-21).
**Near-term infra-cleanup group (flagged 2026-05-22, don't block Step 2/3):**

- **Count-drift cheap-repair — RESOLVED-VIA-OPTION-B (2026-05-23).** See Section 2 "Count-drift resolution (2026-05-23)" for the full result. Headline: Option B (valid-leading-12 truncation in [src/anthropic.js](src/anthropic.js)) + system-prompt simplification (3 cuts removing don't-think-of-pink-elephant reinforcement) ship together. Drift is now **invisible to the product**: every observed mode = valid-leading-12 + trailing garbage → Option B truncates deterministically, $0 extra, no retry, clean 12-scene story every time, ~$0.13-0.16/book. Residual benign drift rate ~67% in the post-simplification N=3 probe (2/3 over-count, both caught cleanly by B; 0 under-count) is a cosmetic internal "how often B works" metric, NOT a product failure rate. **Watch-items moved to Section 2** (product-impact triggers, not rate-based).
- **generate-book.js `isTypeA` label bug.** The CONFIRM-gate template-distribution display has a BINARY `isTypeA` check (regionDetection && autoFit both set → "Type A", else → "Type B — static CSS") that predates the Type C class — so prompt-3-iter-2 (Type C) mislabels as "Type B" in the gate. **Before just fixing the label string: audit whether that binary `isTypeA` is load-bearing anywhere functional** (any downstream branch assuming binary A/not-A). If it's purely the display string, make it a 3-way label (A/B/C). If a functional branch relies on it, Type C needs real handling there. Cosmetic in the gate as observed (the render path in page-pipeline.js routes Type C correctly), but audit before patching.
- **`output/stories/_failed/` directory cap.** Captures accumulate unbounded as the shape-retry fires on ~every recent story-gen. Worth a simple cap (e.g. keep last 50 captures, prune oldest) before the dir gets unwieldy. ~10 lines, low priority.
- **meta.json cross-attempt cost accumulation.** [src/anthropic.js](src/anthropic.js)'s shape-retry pays ~2× tokens but [scripts/generate-story.js](scripts/generate-story.js)'s meta.json `estimated_cost_usd` only reflects the successful attempt's usage — the failed attempt's tokens are billed but not surfaced in the cost field. For accurate per-book cost tracking (especially when shipping to friendly testers), bubble per-attempt usage from `generateStory()` to the script and sum. ~10-15 lines.
- **generate-book.js wall-time estimate formula.** The CONFIRM gate prints "~3-3 min" because the formula counts only the render step, not Gemini-call time per page. Realistic wall is ~7-10 min for a 12-page book. Adjust the formula (~3 lines).
- **Phase 4 infra:** resumable book generation; `npm audit fix` (2 moderate pdf-lib deps); shared Puppeteer browser across auto-fit iterations; distribution mechanics for friendly testers. See Section 2 "Week 4 housekeeping."
- **Pre-v2 book migration** — [output/books/2026-05-17-mateo-0002/](output/books/2026-05-17-mateo-0002/) has no `layout_intent` tags.

**Discipline patterns active (Memory entries):**
- [feedback-iterate-vs-external-test]: user has consistently chosen iterate; don't pushback citing speed-of-external-validation.
- [feedback-review-before-execute]: after writing approved files, pause for code review before running them, even when "run after write" was part of the approved plan.

---

## 2. MVP overview

### Goal

Ship a working, paid version of DaBookTing — AI-personalised children's books — by **2026-07-10** (8 weeks from kickoff). Time budget: **10-15 hours per week**.

### What "MVP" means here

The smallest end-to-end thing a parent can pay for: input a child's details, get a personalised illustrated story, receive a deliverable (PDF or similar). Not feature-complete. No multi-character. No re-edit flow. One template path, one style.

### 8-week roadmap (originally locked 2026-05-15; deadline dropped 2026-05-17)

The roadmap was originally locked toward a 2026-07-10 launch. **As of 2026-05-17, that fixed deadline is dropped** in favour of getting the layout right — the new bar is "looks like a real children's book", not a calendar date. Weeks 1-3 work shipped early; Weeks 4-8 timing is open. The week-by-week below is retained as reference, not commitment.

| Week | Dates | What it builds |
|---|---|---|
| **1** (now) | May 15-22 | Story generation pipeline. Anthropic-driven story creation, output JSON matching `test-script.json` shape. |
| 2 | May 22-29 | End-to-end CLI book generation. Wire story-gen to existing image pipeline. Single CLI command: parent inputs → 12 images + story text saved. No UI yet. |
| 3 | May 29 - June 5 | PDF assembly. Combine 12 images + page text into printable PDF. Node PDF library (`pdfkit` or `pdf-lib` — pick the lighter-weight one in Week 3 prep). |
| 4 | June 5-12 | Minimal web UI. Single form. Hosted on Vercel or Netlify. Wires to backend handler. |
| 5 | June 12-19 | Async job system + transactional email. Resend or Postmark. ~15 min job latency. |
| 6 | June 19-26 | First 5 friendly testers (family/friends). Watch, fix, iterate. |
| 7 | June 26 - July 3 | Stripe integration. Turn on payments at user ~20 milestone. |
| 8 | July 3-10 | Launch to strangers. Goal: first paying stranger by July 10. |

### Scope locks

- **Distribution:** digital PDF only. No print-on-demand.
- **CLI:** internal use only for Weeks 2-3 (developer workflow). Not customer-facing.
- **Web UI:** starts Week 4.
- **Page count:** 12 pages per book (carried over from Phase 1/2 spike anchor).

### Story-generation decisions locked in (Week 1)

- **Model provider:** Anthropic Claude. Chosen over Gemini-for-text because Anthropic just gave us API access with $5 free credit, and the API contract is clean. Gemini stays in the stack for images.
- **Creative posture:** **Full creative freedom.** No rigid template. The system prompt sets bounds (age-appropriate, no scary themes, etc.); Claude chooses arc, beats, voice.
- **Output shape:** top-level JSON matches `test-script.json` (character, style, composition_rules, negative_prompt, `scenes[]`). Each scene = `{ page: number, action: string, narrative_text: string }` where `narrative_text` is 3-5 sentences. `action` is the image-prompt seed consumed by the Phase 1 Gemini pipeline in Week 2.
- **Determinism:** structured JSON output via Anthropic's `output_config.format` (server-side schema enforcement), not free-form prose. Wrapper schema is 2-field (character + scenes); style/composition_rules/negative_prompt are brand constants merged in by the wrapper. Page-number sequence (1..12) validated in code (`output_config.format` doesn't enforce array-length constraints).
- **Model:** `claude-sonnet-4-6` (Claude Sonnet, latest). **Locked 2026-05-15 for Week 1.** Reasoning: story quality is core to product value; ~$0.05 per story is trivial at MVP volume; downgrade to Haiku is easy later, but upgrading Haiku output is not. Revisit only if quality is overshooting or cost ramps unexpectedly.
- **Effort + thinking:** `effort: "medium"` + `thinking: { type: "adaptive" }`. Set explicitly because Sonnet 4.6 silently defaults to `"high"` which is overkill for one-shot creative gen. Ratchet up to `"high"` if quality misses.

### Week 2 plan (locked 2026-05-16)

**Deliverable:** A single CLI command that takes parent inputs and produces a complete book on disk — `story.json` + 3 character-sheet PNGs + 12 page PNGs + 12 narrative-text files — ready for PDF assembly in Week 3.

**Day-by-day (May 22-29):**

| Day | Date | Work |
|---|---|---|
| Fri | May 22 | Plan review + scaffold `scripts/generate-book.js`. Reuse `generateStory()` and `generateImage()` from existing wrappers. Day-end: skeleton CLI parses flags, prints what it *would* do, makes no API calls. |
| Sat | May 23 | Implement Section A (character-sheet generation, 3 calls). End-of-day: 3 PNGs land on disk for a test input. |
| Sun | May 24 | Implement Section B (12 scene calls conditioned on character sheets). End-of-day: 12 PNGs + 12 .txt files on disk. |
| Mon | May 25 | First end-to-end test with **Mateo's Week 1 inputs**. **Visual diff** the output against Phase 1 Run 3's outputs (`output/character-sheet/sheet-*.png`, `output/scenes/page-*.png`) — same kid, same style expected. Materially different = prompt-construction bug to find. Visual diff, eyes-only, no automated comparison. |
| Tue | May 26 | Debug + harden. Add continue-on-failure pattern (same as `scripts/generate-flux-scenes.js`). Re-test. |
| Wed | May 27 | Second full book with **Sage's Week 1 inputs**. Validates pipeline across a different story shape (emotional vs adventure). |
| Thu | May 28 | Buffer day. Likely: third book with fresh inputs, OR Week 3 prep (pick `pdfkit` vs `pdf-lib`). |
| Fri | May 29 | Week 2 close. Update SESSION_NOTES, lock book-pipeline shape, draft Week 3 plan. |

~12-15 hours total — matches the time budget.

**Files created:**
- `scripts/generate-book.js` — main orchestrator CLI. Same named-flag interface as `scripts/generate-story.js` (`--name`, `--age`, `--appearance`, `--theme`). Flow: confirmation gate → `generateStory()` → 3 character-sheet `generateImage()` calls → 12 scene `generateImage()` calls (each passing the 3 sheets as references) → write artefacts to disk with combined `meta.json`.

**Files changed:** None to existing source. `src/pipeline.js` becomes archived alongside the FLUX scripts — still works on `test-script.json` but no longer called by MVP-active code.

**CLI shape:**
```
node scripts/generate-book.js --name "..." --age N --appearance "..." --theme "..."
```

**Output structure:**
```
output/books/<YYYY-MM-DD>-<name-slug>-<HHMM>/
  story.json
  meta.json
  character-sheets/
    sheet-01.png  sheet-02.png  sheet-03.png
  pages/
    page-01.png  page-01.txt
    page-02.png  page-02.txt
    ...
    page-12.png  page-12.txt
```

**Character-sheet prompts:** Hardcoded in `scripts/generate-book.js` as a 3-element array (front portrait / three-quarter view / side profile, all on plain cream background — exactly Phase 1's locked prompts).

**Decisions locked:**
- **A. Pipeline structure:** Inline orchestration in `scripts/generate-book.js`. No new `src/book-pipeline.js`. No retrofit of `src/pipeline.js`.
- **B. Failure resilience:**
  - Story call fails → halt the whole book (~$0.05 burnt; nothing recoverable).
  - Character sheets: **≥2/3 must succeed.** If only 1 sheet survives, halt before scenes — running 12 scenes off a single untested reference produces output of unknown quality (would be "uncertain output" mis-labeled as "partial success"). (Override of original 1+/3 floor, decided 2026-05-16.)
  - Scene images: continue on individual failure; partial book preserved on disk; failed page IDs surfaced in summary block.
- **C. Output dir structure:** Nested (`character-sheets/` and `pages/` subdirectories under each run's directory).
- **D. Character-sheet caching:** No cache. Fresh sheets per run.
- **E. Narrative texts:** Write per-page `.txt` files alongside PNGs (redundant with `story.json` but useful for human review and Week 3 PDF assembly).
- **F. Prompt structure for image-gen (Day 1 design choice):** Phase-1 mirror — `Subject: a {age}-year-old child.\nAppearance: {story.character minus name}.\n...` — to maximise visual-diff compatibility with Phase 1 Run 3. Requires name-stripping via word-boundary regex; edge-case behaviour reviewed before code is written.
- **G. story.json write timing:** Written immediately after Section A succeeds (defensive — preserves the $0.05 story if Section B/C later crashes).

**Cost estimate per book:** ~$0.65 ($0.05 story + $0.12 sheets + $0.48 scenes).
**Week 2 testing total:** ~$2-3.25 (3-5 books expected). Gemini: informal tracking; Anthropic: ~$0.15-0.25, well within remaining ~$4.85 credit.

### Runtime decisions (locked 2026-05-17)

Validated against two end-to-end book runs (Mateo + Sage, both 2026-05-17). Tail latency variance is Gemini-side, not our pipeline. Locking the operational consequences:

1. **Runtime baseline: ~20-25 minutes per book.** All Week 3+ planning uses this number. Both runs landed at 23.2 min total; tail can spike on any one of the 15 Gemini calls (sheets or scenes), not localized to a specific call type.
2. **Async-with-email is the only viable UX.** No synchronous request/response flow anywhere — not even in dev-side scripts going forward. Affects Week 4 web UI design and Week 5 job system.
3. **Customer-facing promise: "your book within 1 hour."** Generous buffer over 25-min baseline; absorbs queue depth + occasional 30+ min outliers without becoming a credibility risk.
4. **No more runtime-optimization work pre-launch.** Revisit only if Week 6 friendly-testers report runtime as a conversion blocker. Local optimizations (parallel image generation, caching, pre-warming) are explicitly out of scope until then.

### Week 3 decisions (locked 2026-05-17)

Deliverable: `scripts/generate-pdf.js` — takes a book directory, produces a printable PDF. Full day-by-day plan + code still in review.

**Architecture locks:**
- **A. PDF library:** `pdfkit` — procedural API, mature ecosystem, fits "13 pages from scratch" use case.
- **B. Layout:** single-page per scene (image on top, text below). Revisit double-page spreads only if friendly-testers say it feels cramped.
- **C. Page size: landscape letter (11×8.5").** Locked after inspecting actual book output: Gemini's `gemini-3.1-flash-image-preview` returns **1408×768 landscape (~16:9)** for all our prompts, not the 1024×1024 square Phase 1 assumed. Landscape page is the native fit.
- **D. Cover page:** yes — `sheet-01.png` as cover art (fit-to-box, handles portrait outlier as poster framing), title "[Child's name]'s Story" centered below, theme line as subtitle.

**Minor defaults locked:**
- Font: Helvetica (PDF built-in, no font bundling).
- Sizes: 16pt body, 18pt subtitle, 24-32pt title.
- Margins: 0.5" all around.
- Image scaling: **fit-to-box** (preserves aspect ratio, adds whitespace padding for off-ratio images; handles portrait outliers gracefully).
- Image-not-found: skip the page, log in summary.
- No back matter, no CONFIRM gate ($0 in API costs for local PDF gen).

**Day 4 phone-screen test (REQUIRED, not optional):**
Mon May 25's visual quality pass must include opening the generated PDF on an **actual physical phone**, not just desktop or emulator. Landscape PDFs on portrait phone screens display oddly without auto-rotate — real UX validation, not nice-to-have.

**Known image behavior (acceptable for MVP, not fixing):**
- Gemini's image model returns **1408×768 landscape** for most prompts in our pipeline (all 24 scene images across Mateo + Sage runs; 5/6 character sheets).
- BUT: the word "portrait" in a prompt triggers orientation flip. Mateo's `sheet-01.png` (prompt: *"front-facing portrait, neutral expression, plain cream background"*) came back **768×1376 portrait**. Sage's `sheet-01.png` with the same prompt came back 1408×768 landscape. **Non-deterministic across runs.**
- Acceptable for v1: fit-to-box scaling handles both orientations on a landscape page. Portrait outliers center with side whitespace (poster-framed). Revisit only if visual-diff or friendly-tester feedback flags it.

### Layout v2 scope (decided 2026-05-17) — SUPERSEDED 2026-05-17 evening

_All pdfkit-based layout work in this subsection was superseded by the Architecture-B pivot (see "Pivot — Template architecture" below). Three rounds of iteration (Classic v2 typography + variance test + post-diagnostic fixes) did not pass the bland-feeling gut test. Retained as historical record of the dead end._

Plan pivot from "ship v1 single-page layout" to "design + implement three layout variants with system-chosen variance per scene." Reasoning: a single uniform layout doesn't pass the "looks like a real children's book" gut test, and that test is now the bar that drives schedule (not the dropped July 10 deadline).

**Scope:**
- **Three layout styles.** Candidates identified in [research-notes/layout-research.md](research-notes/layout-research.md): **Classic framed** (calm baseline; already implemented as v1 in `scripts/generate-pdf.js`), **Cinematic full-bleed** (atmospheric/climactic moments), **Asymmetric breathing** (intimate/reflective beats).
- **System-chosen, not user-chosen.** The pipeline picks which layout for which scene based on simple heuristics (page position in arc + narrative-text shape). Variance across pages is the point — a curated rhythm, not a uniform template.
- **Advanced user override deferred to Week 4+ web UI.** When users land on the form, an "advanced" toggle could let them lock all pages to one layout or pick per page. Not in scope this week.

**Done definition:**
- Gut-feel "looks like a real children's book" when reviewed on desktop AND phone (Day-4 phone-screen test still locked, just applied to layout-v2 output rather than v1).
- No fixed objective bar. Bar is taste, not metrics.

**Status:**
- Research doc complete; three candidates identified.
- v1 (Classic framed) lives in `scripts/generate-pdf.js` (345 lines, untested against either book yet). Implementation of Candidates B and C is pending pick-and-review.
- Week 3's locked decisions (PDF library, page size, fit-to-box, etc.) carry forward to layout-v2; only the "single uniform layout" decision is superseded.

**Open-question decisions (locked 2026-05-17):**

| # | Question | Decision |
|---|---|---|
| 1 | Cinematic panel: rounded corners or soft alpha-edge? | **Rounded corners, ~8pt radius, semi-transparent cream fill (~85% alpha).** Soft alpha-gradient edges are harder in pdfkit and risk smudgy at small sizes. Revisit if phone test reads as app-y. |
| 2 | Asymmetric: image upper-right or alternate L/R? | **Always upper-right for v1.** Alternation is a 1-line change later if monotonous. |
| 3 | Cinematic panel: bottom-left or alternate? | **Always bottom-left for v1.** Same reasoning as Q2. |
| 4 | Cover page: Cinematic or its own layout? | **Its own** — keep the existing cover composition (image in top region, title + theme subtitle below). The cover doesn't need Cinematic's high-emotion treatment. |
| 5 | Portrait outlier (768×1376) on Cinematic full-bleed? | **Fall back to Classic for that page.** Portrait pillarboxes on a landscape page defeat the cinematic intent. Classic handles portrait outliers cleanly via fit-to-box. |

**Implementation sequence (locked 2026-05-17):**

1. **Classic v2** — redesigned from v1; the "looks like a real children's book at the default page" pass. Works on existing Mateo/Sage books on disk; no schema change needed.
2. **Schema + system-prompt change** — add `layout_intent` field (enum: classic / atmospheric / intimate / active; optional in schema, defaults to "classic" in `src/anthropic.js` post-parse). Regenerate one test book (~$0.66) to validate tagging distribution AND **re-apply the four-question rubric** (bedtime-readable, memorable moment present, emotional honesty, earned resolution) to confirm the prompt change didn't degrade prose quality. **If any of the four regresses, halt and re-tune before Cinematic.**
3. **Cinematic full-bleed** — tested against tagged book.
4. **Asymmetric breathing.**
5. **Per-page selection** — reads `scene.layout_intent` from `story.json`, maps to renderer.

**System-prompt change risk (canary practice):**
Step 2 adds tagging instructions to the locked v1 system prompt. Risk: instructions for tagging may inadvertently nudge Sonnet's prose toward whichever tag the new section emphasises. We do **not ship a worse story for the sake of better layout selection.** The four-question rubric re-application is the canary — if Mateo and Sage equivalents regress on any quality dimension, the prompt change reverts and we re-design the tagging instruction.

**Layout v2.1 candidates (banked 2026-05-17 — observe during test runs, do not pre-emptively change):**

Things to watch in Day-4 visual evaluation of Classic v2 against Mateo and Sage books. None block v2 shipping; each is a one-line tweak if needed.

1. **Times-Italic cover subtitle reads "designed" or "academic"?** If academic, swap to `FONT_BODY` (Times-Roman) for the subtitle. The italic risks "research paper abstract" feel; only ship if it reads as elegant.
2. **1.5pt image border visible on phone screens?** Dense-pixel displays may eat thin strokes. If invisible at phone-viewing distance, bump `IMAGE_BORDER_WIDTH` to 2pt.
3. **Cream `#F8F4ED` reads as paper or just "off-white"?** Judge in **low-light bedtime conditions**, not bright daylight — the warmth should register subconsciously, not look greyish. If it reads as just dim white, warm toward `#FAF5E8` or `#F7F2E5`.
4. **Image-to-text ratio (55/45) feels page-dominant enough?** If the image feels too small, the budget has slack: worst-case rendered narrative was 160pt at v2's 67% utilization. Could tighten `TEXT_REGION_HEIGHT` to ~200pt (80% utilization, still under 90% warning), giving the image back ~40pt — `IMAGE_REGION_HEIGHT` 288 → 328pt. Reverts the ratio toward ~60/40.

These are v2.1 territory — do not change in v2. v2's purpose is to ship the improved layout and gut-test it; we iterate on observed output, not anticipated issues.

### Layout v2 (post-diagnostic, 2026-05-17) — SUPERSEDED 2026-05-17 evening

_Even with Fix A and Fix D applied, user verdict on rendered output was: "they do not look good, like at all. No blending with images, text is just in a big chunk, no writing excitement." This was the third failed round of pdfkit iteration and triggered the pivot to Architecture B (Recraft + HTML/CSS + Puppeteer). Retained as historical record._

Diagnostic pass on the shipped Layout v3 build (research-notes/layout-diagnostic.md) surfaced two geometric findings worth addressing before the variance verdict:

- **Fix A — Asymmetric text width expanded 540 → 720pt (full content width).** The original 540pt text width left a 180pt empty strip on the right side of every Asymmetric page, which combined with the upper-left empty quadrant to form a visually-broken L-shape (two disconnected empty zones violating Gestalt closure). Full content width consolidates the negative space into one upper-left zone. **Trade-off accepted:** Asymmetric character is weakened from "strong diagonal" to "soft asymmetric" — the diagonal eye-flow (upper-right image → lower-left text) becomes vertical (upper-right image → full-width text band below). Image-right-anchored + upper-left empty quadrant still distinguish this layout from Classic, but less dramatically. Estimate: ~50% of original Asymmetric character retained. Worst-case utilization drops from 81% (540pt) to 60% (720pt). If the verdict says "Asymmetric pages now feel like Classic-with-image-shifted-right," the alternative is to keep 540pt and find another way to close the L-shape (e.g. a horizontal rule, a decorative element in the empty quadrant) — but ship the simpler fix first.

- **Fix D — Cinematic panel position cycles across scene-role.** Previously all three cinematic pages (1, 9, 12) anchored bottom-left, which read as "feels like page 1 again" rather than three distinct beats. New cycle: page 1 (establishing) → bottom-left, page 9 (climactic) → top-left, page 12 (closing) → bottom-right. Each position chosen for what its scene-role demands: bottom-left for establishing (Western reading-start corner; eye flows image→text after absorbing the world-shot); top-left for climactic (disrupts the bottom-anchor pattern the reader has built by page 8, forces text-before-image, arrests the eye on the climax); bottom-right for closing (mirror of page 1's bottom-left — same vertical, opposite horizontal — bookend rhyme signals structural closure). Implementation: `CINEMATIC_PANEL_POSITIONS` array + `computeCinematicPanelPosition` helper + `cinematicCount` counter incremented unconditionally on every cinematic dispatch (including fallbacks — so the position cycle is keyed to scene-role intent, not to actual cinematic renders).

Both fixes applied in [scripts/generate-pdf.js](scripts/generate-pdf.js) on 2026-05-17 in the same edit session. **Verdict on whether variance now reads as curated** is the next concrete action — runs Mateo + Sage from terminal, opens both PDFs, judges against the four UX questions in Section 1.

### Pivot — Template architecture (decided 2026-05-17 evening)

After three rounds of pdfkit layout iteration failed the bland-feeling gut test (Classic v2 unchanged → variance test still bland with broken page 5 + page-9-feels-like-page-1 → post-diagnostic fixes "do not look good, like at all — no blending with images, text just in a big chunk, no writing excitement"), the design layer pivots out of pdfkit entirely.

**Path chosen:** AI-generated layout references + hand-coded HTML/CSS templates + Puppeteer-to-PDF. Picked over: hire-designer ($1500-3000), template marketplace, accept-current-and-ship, more pdfkit iteration.

**Decisions locked this session:**

| # | Decision |
|---|---|
| A. AI layout-design tool | **Recraft.** Designed for layout output (text-in-image-region with proper hierarchy), not just illustration. Confirmed by spike rounds 1 + 2. Free tier covers the spike. |
| B. Template architecture | **Hand-code each template in HTML/CSS, render via Puppeteer to PDF.** Recraft outputs serve as visual references, not direct production assets. Reasoning: image compositing onto AI-generated PNGs has known controllability gaps (font swap, page-specific text length, age/portrait variants); HTML/CSS gives runtime flexibility; matches production systems for this product category. |
| C. Product reframing | **Print-on-demand is the actual product, not PDF.** PDF is an optional secondary deliverable. Affects template design (bleed margins, CMYK considerations) when the library expands. Deferred test: user declined the $30 physical-print test this session — wants to master layout digitally first. |
| D. Pivot scope | **All Layout-v2 / variance / position-rule work is superseded.** [scripts/generate-pdf.js](scripts/generate-pdf.js) (716 lines, on disk) is preserved as historical artefact but its future status is "to be replaced by Puppeteer-based renderer if Architecture B spike succeeds." Do NOT iterate on it further. |

**Recraft spike record:**

| Round | Setup | Verdict |
|---|---|---|
| 1 | Single prompt, ~10 candidates | "Two watercolour illustrations text in a nice readable but soft font, text central below image central too. I like the font, page colour, I still think there can be more variance." → directionally right, needs more compositional variance. |
| 2 | 6 prompts × 4-6 candidates each, targeting different compositions | "Yes, that was good. Especially prompt 2, prompt 3, prompt 4, prompt 6. They were particularly fantastic." |

**Round-2 winning prompts (the four candidates to pick from for the architecture spike):**

- **Prompt 2 — Split spread.** Text left, image right. Magazine-editorial composition.
- **Prompt 3 — Text in negative space inside image.** Snowy-Day-style; text sits in compositionally-quiet zones of the illustration itself.
- **Prompt 4 — Asymmetric off-center.** Image upper-right, text lower-left. (Conceptually parallel to the failed pdfkit Asymmetric — but executed as a designed template, not as a runtime positioning rule.)
- **Prompt 6 — Climactic full-bleed.** Dramatic image, minimal text overlay. (Conceptually parallel to the failed pdfkit Cinematic.)

**Prompts that did NOT fully land:** Prompt 1 (full-bleed with overlay panel) and Prompt 5 (bordered with caption underneath).

**Architecture-spike done definition:**

Tiny script fills the chosen template with Mateo's page-09 content (image + narrative text), renders via Puppeteer to PDF. Output beats current [scripts/generate-pdf.js](scripts/generate-pdf.js) page-09 on the bland-feeling gut test AND lands close enough to the Recraft reference that the AI tool's compositional value is preserved through hand-coding. If both clauses hold → expand to library. If either fails → reopen design path (hire-designer becomes live).

### Template architecture finding (2026-05-17): images must be generated FOR templates, not retrofit afterward

Spike on prompt 2 iteration 2 revealed: the Recraft reference's image quality comes partly from compositional elements (forest canopy bleeding across top, hanging vines bridging to cream text zone) that are part of the original painted composition. Our existing Gemini-generated images are flat-edged photo-style illustrations without such elements.

CSS techniques can approximate organic edges (soft-fade masks) but cannot fake painted-elements that aren't in the source image.

Implication for the template library expansion: if templates require integrated painted elements (canopy bleeds, organic borders, vine transitions, region-aware light areas), Gemini image generation needs to become template-aware. This means:

- Each template would specify constraints on the image to be generated for it (e.g. "upper-left corner should be dark forest canopy" or "lower-right region should be light/empty for text overlay").
- The story generation step would tag each scene with which template it'll use, the way `layout_intent` was discussed before.
- The image generation prompt would include the template-specific constraints.

This is a substantive change to the image pipeline ([src/gemini.js](src/gemini.js) layer). Architectural call: **defer until after the spike proves the template architecture works in principle.** If spike succeeds → next step is making image generation template-aware. If spike fails → this finding becomes moot.

### Text-aware zones (decided 2026-05-18)

Architecture B proved out end-to-end across two templates (prompt-2-iter-2 split-spread, prompt-3-iter-2 painted-clearing). Validation surfaced a load-bearing constraint the Template architecture finding (above) didn't anticipate: **text size must drive image-zone size, not the reverse.**

prompt-3-iter-2's painted-clearing layout has a defined cream zone for text. The initial image-generation prompt produced a clearing roughly 60% × 25% of the frame. Mateo's 504-char narrative at the spec'd typography (Architects Daughter 16pt, 1.6 line-height, 70% page width) renders at ~7 lines / ~180pt height — taller than the clearing. Same narrative viewed through prompt-2-iter-2's 32%-width column would need ~15 lines / ~459pt of vertical space. Neither template's image-side clearing was sized to fit the actual narrative dimensions. "Template-aware" (layout-aware) is insufficient — the system must also be "text-aware" (content-aware).

**Three sub-decisions locked (2026-05-18):**

| # | Decision |
|---|---|
| 1. Measurement engine | **Puppeteer-based** rendering + `getBoundingClientRect()` + `Range.getClientRects()`. Not a font-metrics library, not a glyph-width heuristic. Rationale: same engine renders the production PDF, so the measurement matches production within rendering tolerance. Conversion CSS-px → PDF-pt at 0.75× (1in = 96 CSS px = 72 PDF pt). |
| 2. Prompt language | **Hybrid: percentage constraints + explicit absolute units.** Example: "the cream clearing must measure approximately 5.4 inches × 2.5 inches, located at the bottom-center of the frame." Pairs the percentage framing humans understand with the absolute units Gemini can reason about deterministically. |
| 3. Mismatch fallback | **Auto-shrink text font size** if the measured text zone doesn't fit the generated image's clearing. Shrink in 0.5pt steps with a minimum floor (e.g. 12pt) before halting with a clear error. Prevents "text overflows zone" from being a fatal error during production runs. |

**Primitive built and validated (2026-05-18):**

- [src/text-measurement.js](src/text-measurement.js) — `measureText()` async function. Inputs: `text`, `fontFamily`, `fontSize`, `lineHeight`, `maxWidth` (supports `%`, `in`, `pt`), `pageWidth`, `pageHeight`, optional `letterSpacing`, `fontWeight`, `fontVariantNumeric`. Returns: `{ lines, linesByRange, heightPt, heightIn, widthPt, actualMaxWidthPt }`. ~140 lines.
- [scripts/test-measure-text.js](scripts/test-measure-text.js) — validation suite. Test 1 fail-asserts conversion math; Tests 2/3 measure Mateo p9 and Sage p10 in production typography and emit validation PDFs with red dashed line at predicted text-bottom for visual confirmation.

**Reference values from validation** — "what the primitive predicts" baseline for integration testing:

- **Mateo p9 in prompt-2-iter-2 typography** (EB Garamond 18pt, 1.7 lh, 32% × 11in = 253.43pt width): **15 lines, 458.96pt rendered height** (6.37in)
- **Sage p10 in prompt-3-iter-2 typography** (Architects Daughter 16pt, 1.6 lh, 70% × 11in = 554.39pt width): **7 lines, 179.16pt rendered height** (2.49in)

**Bug surfaced and resolved (2026-05-18) — lesson banked:**

The test harness initially under-predicted Mateo p9 by one line (measured 15, validation PDF rendered 16). Diagnosis via [scripts/diagnose-measure-text.js](scripts/diagnose-measure-text.js) ran the same measurement against two HTML structures side-by-side. Root cause: `renderValidationPdf` wrapped `.measure` in a `.text-origin` div with `position: absolute` + `width: auto`. That wrapper shrink-to-fit to 1008px (page-context width 1056 minus left offset 48), and `.measure`'s `width: 32%` resolved against that smaller basis (322.55px) instead of against `.page-context` (337.91px). The 15.36-px width difference flipped one word break onto a new line.

The primitive itself was correct — the harness was rendering one HTML structure while the primitive measured a different one. Fix removed the wrapper and positioned `.measure` directly inside `.page-context`. After fix, the validation PDFs aligned visually with the predicted text-bottom markers.

**Lesson banked:** The test harness must mirror production structure exactly when validating CSS measurements. Any wrapper element with `position: absolute` + `width: auto` creates a shrink-to-fit containing block that resolves percentage widths against a different basis than production templates (which use explicit width on the text container, e.g. prompt-2-iter-2's `.text-layer { width: 32%; }`). **Future template validation tests must use the explicit-width-on-text-container pattern.**

### Integration test result + soft-boundary finding (2026-05-19)

The Stage-2 integration test ([scripts/test-text-aware-zone.js](scripts/test-text-aware-zone.js)) ran the full text-aware-zones flow for Mateo p9 in prompt-3-iter-2 typography: measure → compute zone dimensions → build Gemini prompt with explicit absolute-unit constraints → generate image → render PDF. End-to-end completion, no errors, single Gemini call ($0.04).

**Architectural result: positive.** The hybrid percentage + explicit-inches prompt language (Sub-decision 2 of "Text-aware zones" above) was honoured by Gemini. The resulting image has a cream clearing at roughly the requested 8.20″ × 3.24″ position (centered-bottom of frame), with painted framing elements (grasses, autumn leaves) at the corners/sides of the clearing as instructed.

**Architectural finding: Gemini's cream-clearing upper boundary is SOFT, not CRISP.** Despite the explicit "completely blank — no paint, no wash, no texture, no scene content, no ground, no hills, no terrain" instruction, Gemini produced a transitional band between Mateo's painted ground and the cream zone — a watercolor-natural softening where painted scene fades into paper over a vertical span of roughly 0.3-0.5″, rather than terminating at a crisp horizontal line. This is consistent with the underlying model's training on actual picture-book illustrations, where painted scenes rarely have rectangular boundaries.

**Effect on the rendered PDF.** The template positions text-layer at `top: 80%` (vertical center), placing the 8-line text block from ~y=387pt to y=592pt. The cream clearing nominally starts at the lower ~60% of the page (around y=367pt), so the text *should* sit entirely on cream. But the soft boundary band extends down from ~y=367 to ~y=420, and the first line of text lands in that band — partly overlapping painted ground. Lines 2-8 sit on clear cream.

**Implication for templates.** Templates positioning text via fixed CSS coordinates need to account for the soft transitional band. Two compensation paths exist:
- **Image side:** ask Gemini for a *larger* cream zone than the text strictly needs, so the band lives inside the requested zone and the text region inside the band is clear. Increase the padding constant (currently 0.4″ vertical = 0.2″ above + 0.2″ below the text region) to ~0.7-0.8″ to absorb the band.
- **Template side:** move the text-layer position lower (top:80% → top:85% or computed from cream-zone-upper-edge + buffer). Keeps the Gemini constraint as-is but shifts the text away from the band.

Decision pending — see Section 1's "Next concrete action."

**Diagnostic-related lesson.** During the integration test, an initial visual-discrepancy investigation appeared to show the PDF rendering with a different composition than the PNG. A diagnostic script (PDF.js rendering of the PDF inside Puppeteer; throwaway, deleted after) confirmed PNG and PDF embed are byte-identical (sha256 F87842D5). The apparent discrepancy was perceptual — the soft-boundary band, combined with `object-fit: cover` cropping at ~15% per horizontal side (1408×768 source → 1.29:1 page aspect), made the first text line appear to overlap painted ground when it was actually in the transition zone. **Future visual-discrepancy investigations should run a PDF.js render before regenerating anything** — the file-on-disk is usually correct; the apparent difference is often in cropping, text overlay, or viewer cache, not in the image bytes.

### Stage-2 Stream 2 — page-pipeline architecture (decided 2026-05-19)

Stream 2 of Stage 2: assemble the per-page rendering pipeline from validated primitives. Builds on Stream 1's text-measurement work. Integration validated end-to-end with user verdict ship-acceptable. Path 1 locked.

**Four production primitives now live in `src/`:**

- [src/text-measurement.js](src/text-measurement.js) — `measureText()` Puppeteer-based dimensional prediction.
- [src/region-detection.js](src/region-detection.js) — `detectCleanRegion()` finds largest rectangle of cream pixels in an ROI using RGB-Euclidean distance (HSL was wrong for near-white — see finding 3 below).
- [src/auto-fit.js](src/auto-fit.js) — `fitTextToRegion()` iterates fontSize from `maxFontSize` to `minFontSize`, returns largest size at which text wraps within the region.
- [src/page-pipeline.js](src/page-pipeline.js) — `renderPageWithTemplate()` the orchestrator. One async function that ties everything together.

**Template config system:**

Per-template `config.json` co-located with `template.html` declares: typography defaults, regionDetection ROI + tolerance, imageGeneration padding + prompt-template with placeholders, rendering page size. First config: [templates/prompt-3-iter-2/config.json](templates/prompt-3-iter-2/config.json).

`compositionPromptTemplate` uses `{{LINES}}`, `{{CREAM_HEIGHT_PCT}}`, `{{CREAM_WIDTH_PCT}}`, `{{CREAM_HEIGHT_IN}}`, `{{CREAM_WIDTH_IN}}` placeholders substituted at runtime from a baseline measureText call + padding values from config.

**Dynamic CSS injection (Option 2, locked):**

The page-pipeline overrides `template.html`'s default `.text-layer` and `.narrative` rules via a `<style>` block injected at end-of-`<head>`. Source-order CSS specificity + `!important` rules ensure the dynamic values win. template.html stays unmodified for templates that don't need dynamic positioning. Pattern reusable for any template's pipeline integration.

**Integration test PASSED (2026-05-19):**

[templates/prompt-3-iter-2/page-09.pdf](templates/prompt-3-iter-2/page-09.pdf) — Mateo p9, 815KB, user-validated. Detected region 832×165 source-px → 663×131 page-pt → auto-fit produced 13pt × 5 lines fitting in 132pt budget with 27pt headroom.

**Path 1 LOCKED (2026-05-19): ship with compromises, learn from customers.**

Auto-fit produces different font sizes per page based on narrative length + detected region size. Mateo p9 (504 chars, 663×131pt region) → 13pt. Mateo p5 (320 chars, same region) → 15pt. The 4-point spread within a book is real architectural tension that we accept for v1; iterate based on friendly-tester feedback.

**Seven architectural findings banked this session:**

1. **Vertical padding propagates; horizontal padding doesn't propagate cleanly.** Gemini honored bigger vertical cream-zone requests (v2 0.4″ → v4 2.5″ raised cream-band height substantially in the rendered image). Horizontal padding hit a ceiling at 2.0″ (v3 result was OK but pushed framing elements toward the crop boundary); going wider broke composition. **Producing wider clearings via padding is unreliable.**
2. **Gemini has a ceiling on the largest contiguous clean rectangle.** Scattered decorations (watercolor splatter, dots, framing elements) break the cream zone into smaller maximal rectangles regardless of total cream area requested. Higher PADDING values increase total cream coverage (51% → 70% of ROI between v2 and v4) but the *biggest hole* between decorations stays roughly similar. **This is the hard limit of the Gemini-side approach** and is what triggered the Path-1 lock (auto-fit instead of fighting for bigger clearings).
3. **HSL saturation is mathematically unstable at high lightness for near-white color detection.** `S = (max-min)/(2-max-min)` blows up as `max+min` approaches 2. Cream target #F0E8D8 has HSL S=0.444 but actual cream pixels cluster at S=0.5-0.7 (outside ±0.10 tolerance). **RGB Euclidean distance with threshold ~30 is the correct fix** for near-white targets. Empirically validated: 5/5 cream samples and 4/4 painted samples classified correctly with RGB; only 1/5 cream samples passed under HSL.
4. **Test harnesses must mirror production structure exactly.** Any wrapper element with `position: absolute` + `width: auto` creates a shrink-to-fit containing block that resolves percentage widths against a different basis than production templates. Caused a 1-line under-prediction in measureText test harness. Fix: position `.measure` directly inside `.page-context`, matching how production templates structure text containers.
5. **Pixel-to-page-pt conversion uses `object-fit: cover` scale + crop math:** `scale = max(pageHpt/srcHpx, pageWpt/srcWpx)`; cropped pixels = (scaledLargerDim - targetLargerDim) / 2 each side. For 1408×768 source into 11×8.5in landscape: scale=0.797, horizontal crop=165pt each side, no vertical crop. **The simpler 1:1 axis mapping (used in earlier auto-fit prediction) underestimated page-pt region width by ~40%.** Critical to get right because the page-pipeline uses these coords for CSS positioning.
6. **When changing dimensional values in image-gen prompts, scan for dependent constraints.** "Upper ~60%" + cream-zone-percentage needed both numbers to sum coherently. Changing one without the other created a 23pp contradiction (v4 had 62.87% cream zone but kept "upper ~60%" scene language). Resolution: update preamble to match (upper ~35%) so the prompt was internally consistent.
7. **Prompt language with internal contradictions degrades Gemini fidelity.** Resolve contradictions BEFORE testing each dimensional change — otherwise you're testing how Gemini handles contradictions instead of whether your padding change worked. Caught geometric conflict in v3 between "central 70% safe zone" and "edges of 88% wide clearing"; resolved by splitting the rule into scene-content vs decorative-element variants.

**Performance characteristics (Mateo p9 integration test):**

- regionDetect: 45ms (sharp + RGB-Euclidean — fast)
- autoFit: 10,402ms (4 iterations × ~2.6s/iter — **Puppeteer per-iteration is the bottleneck**)
- render: 2,882ms (one Puppeteer launch + PDF emit)
- TOTAL: 13.3 seconds per page

For a 12-page book at this rate: ~156s of auto-fit overhead alone. **Stage-3 optimization candidate: shared browser across iterations.** Refactor `measureText` to accept optional `browser` param; `fitTextToRegion` launches one browser for all iterations. Cuts auto-fit from ~10s → ~2s. Defer until Stream 3 needs it.

**Discipline patterns held throughout this session:**

- Review-before-write (each diff proposed and approved before disk write)
- Diagnose-before-fix (HSL classifier failure → pixel-sampling diagnostic → propose RGB Euclidean → apply fix)
- Test harness mirrors production structure
- Preserve previous artifacts for comparison (v1-v4 spike images all kept; integration PDF distinct filename)
- Defensive disk writes (no overwriting validated outputs)

### CSS crop math is load-bearing for any template with an image (2026-05-20)

Banked from prompt-4-iter-1 v1 → v2 iteration. The v1 composition produced a centered subject despite the prompt asking for upper-right placement. Diagnosis revealed a structural misalignment between the CSS crop behavior and the composition prompt's geometry assumptions, NOT a weak-prompt issue.

**The trap.** [templates/prompt-4-iter-1/template.html](templates/prompt-4-iter-1/template.html) used `object-fit: cover` with `object-position: right top` to display a 1408×768 source image (aspect 1.833) in a ~square container (65% × 85% of an 11×8.5in page = aspect 0.99). With `object-fit: cover`, the source's wider-than-container axis overflows, and `object-position` controls which slice survives. `right top` crops the entire overflow from the LEFT — for this geometry, 46% of source width is hidden on the left, leaving the visible portion as source x=46-100%. The composition prompt told Gemini "central 70% survives" and "subject at 65% from left of frame", but with right-top anchoring, source x=65% renders at (65-46)/54 = 35% — center-left, opposite the upper-right intent. The "lower-left atmospheric space" instructions targeted source x=0-40%, a region cropped entirely.

**The math.** Container aspect A_c, source aspect A_s. If A_s > A_c (source wider), horizontal overflow fraction = 1 − A_c/A_s. With `object-position: right top`, the entire overflow is cropped from the LEFT (visible source x-range: overflow_fraction → 100%). With `object-position: center top`, half is cropped from each side (visible source x-range: overflow/2 → 1 − overflow/2). For prompt-4-iter-1: overflow = 1 − 0.99/1.833 = 46%. Right-top → visible 46-100%; center top → visible 23-77%.

**The rule.** The composition prompt's geometry (subject location, safe zone, organic-edge regions) must be specified in **the surviving region's coordinates**, not the source-frame coordinates. Either:
- (a) Use a symmetric crop (`object-position: center top` / `center center`) so prompt phrases like "central 70%" actually map to the surviving area, OR
- (b) Keep an asymmetric `object-position` and explicitly translate prompt percentages into source-frame coordinates (e.g. "subject at source x=78%" if you want it at rendered x=65% with right-top crop).

v2 chose (a): switched to `object-position: center top` and kept the prompt as a symmetric "central 70%" / "subject at 65%" spec.

**Note on prompt-3-iter-2.** Section 2's 2026-05-19 "Diagnostic-related lesson" para refers to `object-fit: cover` cropping at "~15% per horizontal side" for prompt-3 — that math is correct because prompt-3's template uses centered positioning. The bug here is specific to asymmetric `object-position` values.

**Process implication for new templates.** Each template config should explicitly document its `object-position` behavior alongside the composition prompt. A `cropBehavior` field in config.json or a header comment in `compositionPromptTemplate` would help future template authors avoid this trap. Defer the schema change until a third template surfaces a related issue; for now, the lesson lives here.

### Prompt engineering for organic edges + the bounded-image-bleed trap (2026-05-20)

Banked from prompt-4-iter-1 v2 → v3 iteration (which still didn't ship; see Section 1's "Next concrete action"). Two findings.

**1. Multi-paragraph reinforcement with negative-direction language works for modifying Gemini's default tendencies.**

v2's composition prompt bundled left + bottom edge organic-fading instructions into a single paragraph: "The LEFT and BOTTOM edges of the painted scene should fade organically into the cream paper background...". Result: left edge bled correctly; bottom edge produced a hard horizontal ground/floor line at the scene's natural baseline. Diagnosis: Gemini's default tendency (paint a ground line where a scene meets cream) overrode the bundled instruction because the instruction didn't specifically counter that tendency.

v3 split the bundle into two dedicated paragraphs (ORGANIC LEFT EDGE, ORGANIC BOTTOM EDGE) and added negative-direction language ("Do NOT paint a hard horizontal ground line, floor edge, or scene-base boundary at the bottom") plus a positive alternative ("Instead, let the painted scene fade out through watercolor wash and paint splatter — pigment becoming sparse, drips of paint scattered into the cream, the painting losing its substance gradually rather than ending at a line. Imagine the painter using more water at the bottom"). Result: bottom edge visibly improved.

**The pattern that worked:** dedicated paragraph per edge + "Do NOT do X" + "Do Y instead" + concrete imagery describing Y. Use the next time a default Gemini tendency needs explicit counter-instruction.

**2. Every edge of an image-layer that doesn't extend to the page boundary needs its own organic-bleed treatment.**

prompt-4-iter-1's design assumption was that the TOP and RIGHT edges of the image-layer "extend to the frame edge naturally" and don't need organic fading. v3's rendered output showed a visible hard rectangular boundary against cream despite v2/v3's CSS mask correctly feathering the left + bottom edges of the image-layer. **User diagnosis on v3:** "the image container is 65% width but the mask only feathers left and bottom. There's a 35% cream strip on the right where the hard rectangle becomes visible." The exact failure-mode geometry needs fresh analysis next session with the v3 PDF in hand — the recorded user description is preserved verbatim above to ground that re-derivation.

**The rule:** for any new template, audit each of {top, right, bottom, left} of the image-layer's CSS bounding box: "does cream show outside this edge?" If yes, that edge needs (a) CSS mask feathering AND (b) a dedicated composition-prompt paragraph asking Gemini to paint that edge as a watercolor wash dissolving into paper. Skip only edges that bleed off the page boundary.

**Why prompt-4-iter-1 didn't ship despite three iterations.** v1 had the CSS-crop bug (centered subject from object-position: right top). v2 fixed the crop math but had bundled-edge prompt language → hard bottom edge. v3 fixed the bottom edge but exposed the right-edge mask gap. Each iteration was a real architectural lesson, not just polish. The template needs a deliberate redesign session — full-edge bleed (Option 1a) or off-page geometry (Option 1b) — not another increment on the current design.

### Color-matched substrate is the right concept but Gemini's color precision is insufficient (2026-05-20)

Banked from prompt-4-iter-1 v5 + color-correction post-process tests. v5 abandoned the CSS-mask approach entirely and asked Gemini to paint the scene on a cream paper substrate using EXACTLY `#F0EADB` (the project's page background color). The architectural elegance: if image-substrate matches page-background, the rectangle boundary becomes invisible because both sides are the same color. The concept is correct — but **empirically Gemini's color precision is insufficient**.

**Empirical drift data (v5 sampled at six 20×20-px patches via [scripts/test-prompt-4.js](scripts/test-prompt-4.js) post-run diagnostic):**
- Corners: ~`#F8F5E4` (Euclidean distance ~16 from `#F0EADB`)
- Mid-edges: ~`#FCF8EA` (distance ~21)
- Per channel: R +8, G +11, B +9 — drift is **global** across all four corners (corners within 1 RGB unit of each other), not edge-specific

The ~16-21 RGB-unit uniform drift produces a visibly-lighter inset rectangle against the page's `#F0EADB`, defeating the substrate-match concept in practice.

**Color-correction post-process tests:**

- **Binary snap** ([scripts/test-color-correction.js](scripts/test-color-correction.js) — outer 20% margin, threshold 40 RGB-Euclidean, force-snap to `#F0EADB`): 95.1% of border pixels (658,139 of 691,799) corrected. Visible result: rectangle **migrated** from the image-page boundary to the INNER edge of the correction zone — a new horizontal seam appeared where corrected-flat-cream met original-painted content. Boundary problem moved, not solved.
- **Feathered gradient** ([scripts/test-color-correction-feathered.js](scripts/test-color-correction-feathered.js) — strength 1.0 at outer edge → 0.0 at inner boundary; zone width 153px = `min(20%×width, 20%×height)`): 94.1% of in-zone pixels blended; near-uniform strength distribution (15.8% / 18.3% / 19.5% / 22.1% / 24.3% across five buckets `[0.0,0.2)...[0.8,1.0]`). The migrated seam dissolves into a smooth gradient — the rectangle problem is genuinely solvable via post-process.

**Hidden geometric caveat (for future templates).** With `object-fit: cover` + `object-position: center center` on the 1408×768 source into the 65%×80% (aspect 1.05) image container, source `x < 153` and source `x > 1255` are cropped out entirely. Color-correction strength computed in source coordinates only has visible effect on top + bottom strips of the rendered output. For future templates needing genuinely all-four-edge correction visible at render, strength must be computed in **post-crop rendered coordinates** (or equivalently, in source coordinates clamped to the visible source x-range). Not relevant for prompt-4-iter-1's failure mode (top+bottom seams are exactly what migrated), but a general principle.

**Decision (2026-05-20).** Color-correction post-process was deferred indefinitely as production behavior — not because it doesn't work, but because [templates/prompt-6-iter-1/](templates/prompt-6-iter-1/) shipped on first attempt without needing this complexity. The full-bleed pattern dodges the substrate-color problem entirely. **Re-evaluate** if a future template genuinely requires inset-on-cream framing.

### Full-bleed wins where inset-on-cream loses — template-design heuristic (2026-05-20)

Distilled from the prompt-4-iter-1 (5 iterations, 3 architectural patterns, $0.20 spent, deferred) vs prompt-6-iter-1 (first-attempt success, $0.04) contrast.

**The pattern that worked:** image fills the entire page edge-to-edge; text overlay sits on a CSS-rendered translucent cream band on top of the image. **The pattern that didn't work:** image inset within page with cream visible around it; the image-cream boundary requires either CSS magic (mask feathering) or Gemini-side substrate-color precision — neither sufficient with current tooling.

**Why the difference is structural, not effort.** prompt-6's cream is rendered by **CSS** — deterministic, exact `#F0EADB`, no Gemini variance. The image and the page meet at the page boundary, where the image extends off the edge of the visible area — no boundary to dissolve. prompt-4 needed cream rendered by **Gemini** (as substrate of the painted scene) — non-deterministic with ~16-21 RGB-unit drift per the empirical data above. CSS feathering disguises the boundary but attenuates the painting at the edges (v4's visible attenuation artifact); Gemini substrate matching fails because Gemini won't lock to an exact hex. Both routes have a structural ceiling that effort doesn't break through.

**Heuristic for future template additions:**

- ✅ **Full-bleed variants are reliable.** Image covers page boundary in all directions; cream visible only through CSS-rendered overlays (translucent bands, text-clearing masks on top of image, etc.).
- ⚠ **Inset-on-cream variants are risky.** Any template that asks for cream visible adjacent to an image edge needs either feathered post-process color-correction (a workaround) or significantly better Gemini color precision than we have today (no estimate when this lands).
- 📝 **Cream-on-top-of-image is safe; cream-around-image is hard.**

**Application:** when designing a fourth template, favor full-bleed variants. If an inset framing is desired for aesthetic reasons, plan the color-correction post-process from the start rather than discovering the drift problem after iterations.

### Type C template class + the prompt-3 region-detection fix (2026-05-21)

**The new Type C template class.** Templates now come in three kinds, distinguished by two config fields (`regionDetection`, `autoFit`):
- **Type A** — detection ON + auto-fit ON. `detectCleanRegion()` finds the cream zone in the Gemini image; auto-fit sizes text into the *detected* region. (No template currently uses Type A — prompt-3 was the last and migrated away.)
- **Type B** — detection OFF + auto-fit OFF. Static template CSS, fixed font size. (prompt-2-iter-2, prompt-6-iter-1.)
- **Type C** *(new 2026-05-21)* — detection OFF + auto-fit ON. The text region is a **fixed** box declared in `config.textRegion` (fractional page coords); auto-fit sizes the narrative into that fixed box. No region detection. (prompt-3-iter-2.)
- Invalid combo: detection ON + auto-fit OFF — [src/page-pipeline.js](src/page-pipeline.js) throws on it.

The Type C path is page-pipeline's `else if (autoFitEnabled)` branch: region = `config.textRegion × page dimensions` → `fitTextToRegion` → `buildDynamicCss`. "Type A minus the detect step."

**Why Type C matters.** Type A made the text-zone guarantee *depend on Gemini* — region detection had to find a clean cream rectangle in a non-deterministic image. Type C moves the guarantee into the template: the text box is fixed, deterministic, never escalates. Same principle as prompt-6's CSS overlay band, generalized — and the constructive form of the "fixed/full-bleed wins, detection-dependent loses" heuristic.

**The prompt-3 problem this fixed.** prompt-3-iter-2 (Type A) escalated **44%** of its pages in the 1104 book (4 of 9 prompt-3 pages B-class-failed region detection → silently fell back to prompt-2, overriding Sonnet's intentional template choice — a product-quality defect, not just cost). Root cause: prompt-3's text-in-clearing is an inset-on-cream pattern; `minSizePx` (400×100) was a redundant blunt gate *in front of* auto-fit (the real arbiter — auto-fit enforces `minFontSize`), discarding usable wide-short clearings; and Gemini unreliably produced the contained-vignette-with-clearing layout at all.

**The fix — full arc (preserve this reasoning):**
1. Migrated prompt-3 to Type C: `regionDetection: null`, `textRegion: {x:0.10, y:0.70, width:0.80, height:0.25}`, `autoFit` kept.
2. **textRegion reasoning:** the box is center-aligned, so the first line's vertical position depends on narrative line count. Solved for the **4-line worst case** (300-char cap → 4 lines): box at y=0.70 / height=0.25 puts the worst-case first line at ~74% page height, clearing standing-figure feet (~72%) by ~2%; the typical 3-line case clears by ~4%. y=0.68 was too tight (~1%). Box ends at 0.95 (5% bottom margin). Top-align was considered and rejected — it would over-gap lying-figure scenes (vignettes end ~64%, vs standing ~72%).
3. **Backdrop spec:** feathered cream `#F0E8D8` at **opacity 0.30**, compound feather mask (linear-gradient 18/82 horizontal × 22/78 vertical, `mask-composite: intersect`), + triple cream text-halo (`text-shadow: 0 0 5px ×2, 0 0 3px`). **Why 0.30 not 0.55:** cream-on-cream is invisible *at any opacity* — the hard rectangular EDGE is what betrays a backdrop, so the fix is feather (kill the edge) + low opacity (0.55 still left a faint band on clean pages; 0.30 is pristine). The halo is invisible on cream and carries per-glyph legibility on the rare vignette intrusion.
4. **Composition prompt rewritten:** dropped the `{{CREAM_*}}`/`{{LINES}}` placeholders (box is fixed now → cream zone is a constant, hardcoded "bottom ~37% blank cream"); KEPT the "CONTAINED VIGNETTE, NOT FULL-BLEED" paragraph — **load-bearing**: it's what makes Gemini paint a contained vignette instead of full-bleed.
5. **Validated at generation time** on the worst-case bedroom (standing indoor figure, resisted all prior attempts): the rewritten prompt forms a contained vignette (~80% clean lower gap — indoor standing figures intrude slightly; the backdrop+halo handle it; outdoor scenes are cleaner).

Region-detection escalation is eliminated for prompt-3. The template is now in the reliable fixed-zone class.

### Design laws for template work (2026-05-21)

Banked for Step 3 (catalogue expansion) and all future template work:

1. **Decorations must be scene-neutral or scene-driven** — never a fixed thematic motif the scene can contradict (prompt-3's hardcoded autumn leaves clashed with bedroom/non-autumn scenes), AND never load-bearing for layout (removing prompt-3's decoration prose also removed structure that forced Gemini to create the cream zone — had to replace it with explicit layout prose).
2. **Prefer Type B / Type C (fixed-zone) over Type A (detection-dependent)** for new templates. Type A's region detection was the direct cause of the 44% prompt-3 escalation. Fixed-zone templates never escalate.
3. **Avoid inset-on-cream patterns** (the prompt-4 graveyard — 5 failed iterations). Full-bleed (prompt-6) and fixed-zone (prompt-3 Type C) win; an image inset within cream with a boundary to disguise does not.
4. **When reliability and quality seem to trade off, find the structural lever, not the prompt grind.** prompt-3's text-across-the-figure problem was fixed by moving the text box down (geometry), not by iterating the composition prompt to force a shorter vignette (which would be grinding the inset-pattern tail).

### Foundation integration validated in full book (2026-05-22)

The 1333 (Shimmer) book — 12 pages, $0.60, 7.3 min, **0 escalations** — confirmed three foundational changes end-to-end in a complete book for the first time:

- **Anti-repetition rule 4 validated.** ABAB rhythm reads as genuine pacing, NOT mechanical seesaw. The 0-clumps outcome does NOT overshoot — alternation + natural image-composition variance produces real breathing rhythm. **Conclusion: do not loosen rule 4.** The "avoid 2 consecutive" wording is correctly tuned, not too strict.
- **prompt-3 Type C validated in context.** Holds across all 6 prompt-3 pages — every first line clears its figure, backdrop invisible on clean pages, no text-on-character anywhere. **0 prompt-3 escalations** (the 1104 book had 4; Type C structurally cannot B-class-fail, now proven in practice). textRegion y=0.70 + opacity-0.30 feathered backdrop + triple text-halo all hold under real-book variance.
- **Decoration-free vignettes validated.** Every prompt-3 vignette stands on its own organic watercolor edges — no page reads bare without the old autumn-leaf framing. 2026-05-21 design law vindicated.
- **prompt-6 climax template mechanics work.** Full-bleed + translucent cream band + 18pt centered render cleanly. The format change at p9 (sudden full-bleed after 8 alternating contained pages) is itself the peak signal; ABAB rhythm *amplifies* the climax. (Image-composition variance on the original p9 render — Gemini painted Iris's face inverted, head-toward-viewer — was fixed 2026-05-22 via the augmented-action override technique. See "Augmented-action override" subsection below. Climax now reads instantly star→face. Original preserved at `pages/page-09-original.{png,pdf}`.)
- **Character consistency validated.** Fresh sheets for 1333 held across all 12 pages — the sheet pipeline works end-to-end.

The 3-template foundation (prompt-2 Type B + prompt-3 Type C + prompt-6 Type B, all detection-free) is architecturally closed AND signed off in a complete book at perfect-product standard. Remaining items are near-term cleanups only (see "Near-term infra-cleanup group" below) — none architectural. Step 3 catalogue expansion is the next phase.

### Augmented-action override technique for Gemini composition misses (2026-05-22)

Banked from the 1333 page-9 climax regen. When Gemini produces a "good scene, bad composition" result (e.g. the 1333 climax: action said "Iris lies on the blanket looking straight up... blazing star directly above her" — Gemini chose camera angle down-the-body-from-above-her-head, inverting her face), the fix is NOT pure-reroll (re-rolling the same action re-rolls the same dice; Gemini already picked the bad angle from this action) and NOT permanently changing the story.json. Instead, **override the action for that one regen** with a camera/orientation constraint that preserves the scene's spirit but pins the failure axis.

Pattern that worked for the 1333 climax (cost $0.04, landed first try):
- Original action: "Iris lies on the blanket looking straight up, arms spread wide, as a dark cloud slides away to reveal one blazing star burning bright directly above her."
- Failure mode: Gemini chose camera angle viewing down-the-body-from-above-her-head → face inverted, head-toward-viewer.
- Augmented action: "Iris lies on the blanket **with her feet toward the viewer and her head at the top of the frame**, gazing UP at one blazing star directly above her, arms spread wide, as a dark cloud slides away. Her face is right-side-up and clearly visible. **Do NOT paint her face inverted, head-toward-viewer, or in any disorienting orientation.**"
- Result: clean composition first try. Original preserved as `page-09-original.{png,pdf}` for side-by-side.

Pattern elements (use for future Gemini composition misses):
1. **Pin the failure axis with positive specification** (here: "feet toward viewer, head at top of frame" for an orientation failure; analogous "subject upper-left looking right" for a positioning failure).
2. **Add negative-direction reinforcement** ("Do NOT do X") naming the specific failure observed — leverages the negative-direction-language lesson banked 2026-05-20.
3. **Preserve the scene's spirit** (narrative-relevant content: lying, arms spread, star above) — change only camera/orientation/position, not what's happening.
4. **One-off override**: pass the augmented action to `renderPageWithTemplate` for the single regen; story.json's action stays unchanged. Back up the original page before overwriting (see [scripts/regen-1333-p9.js](scripts/regen-1333-p9.js) for the pattern: copy `page-NN.{png,pdf}` → `page-NN-original.{png,pdf}`, regen, re-merge `book.pdf` via pdf-lib).

### Count-drift resolution (2026-05-23)

Sonnet's scene-count drift on the 3-template story-gen — characterised over 2026-05-22 as fires-on-~100%, evolving modes (byte-identical p12 duplicate → sentinel "DISCARD" 13th → 37-scene 3× repeat) — is **resolved at the product layer** via a two-part change. Drift is now invisible to the product.

**The fix (both shipped together, non-confounding):**

1. **Option B cheap-repair** in [src/anthropic.js](src/anthropic.js) `attemptStoryGeneration()`. Detection: `scenes.length > 12 && scenes[0..11].every((s, i) => s.page === i + 1)`. Action: truncate to first 12, capture the dropped tail to `output/stories/_failed/` with a distinguishing error message, continue to shape validation (which now passes). Deterministic, ~$0 extra, no retry, no broken stories.
2. **System-prompt simplification** in `SYSTEM_PROMPT_TEMPLATE`. Three cuts removed don't-think-of-pink-elephant reinforcement: the "EXACTLY 12 — not 11, not 13" line collapsed to a single positive statement; the "exactly 12 — no setup or epilogue outside that count" parenthetical dropped; the "Do NOT emit a duplicate of any scene — in particular, do NOT emit the closing scene twice" block dropped entirely. Input tokens dropped 2862 → 2752.

**The result (post-simplification N=3 probe, 2026-05-23, $0.43 total):**

| Run | Raw scenes | Pages | Mode | B fired | Final | Cost |
|---|---|---|---|---|---|---|
| 1 | 13 | 1..12, **0** | empty-stub (page=0, action="", narrative="") | ✓ dropped 1 | valid 12 | $0.1561 |
| 2 | 13 | 1..12, **12** | classic duplicate-p12 | ✓ dropped 1 | valid 12 | $0.1258 |
| 3 | 12 | 1..12 | clean | — | valid 12 | $0.1493 |

**The priming hypothesis split cleanly:**
- **WRONG** that the heavy reinforcement language was the root cause of drift. Rate stayed ~67% post-simplification (2/3), not the dramatic drop-to-zero that root-cause-priming would predict.
- **RIGHT** that the reinforcement was WORSENING drift. The catastrophic modes (37-scene 3× loops, sentinel "DISCARD" text in narrative_text) are GONE. Drift reverted to the simple historical mode (duplicate page 12) plus one quiet empty-stub variant. The heavy reinforcement was manufacturing the dangerous modes; removing it detoxified drift to a simple, fully-Option-B-catchable shape.

**Net product state:** drift is **invisible to the product**. Every observed mode = valid-leading-12 + trailing garbage → Option B truncates deterministically, $0 extra, no retry, clean 12-scene story every time, ~$0.13–0.16/book. The 67% is a cosmetic internal "how often B works" metric, NOT a product failure rate. The user never sees a failure. This is the perfect-product outcome for one-shot generation: not "drift never happens" but "drift never reaches the product." Shipping a working bounded safety net, not settling.

**Watch-items during Step 3 (catalogue expansion will exercise story-gen heavily — free passive monitoring):**

Frame on PRODUCT IMPACT, not rate.

- **ESCALATION TRIGGER A — any mode that ESCAPES Option B reaches the product.** Two cases: (a) under-count (≤11 scenes) — Option B has no floor, so an under-count response falls through to the (now-unreliable) shape-retry; (b) extras where leading-12 is NOT structurally valid (e.g. pages emitted out of order, missing page 7, page 1 appearing twice in the leading slots) — Option B's gate fails, falls through to retry, retry may catastrophically fail at modest cost. **If seen → escalate to fundamental generation rethink immediately (e.g. not requesting all 12 scenes in one shot).** Do not grind more on prompt iteration.
- **ESCALATION TRIGGER B — catastrophic modes reappear.** 37-scene 3× loops, retry-amplification, literal sentinel strings ("DISCARD", "PLACEHOLDER", etc.) appearing in narrative_text. **If seen → escalate.**
- **NOT a trigger:** benign-caught drift rate sitting 50–70%. That's Option B doing its job. Do not escalate on rate alone.

**Monitoring is free/passive.** Step 3 will run story-gen heavily; just check `output/stories/_failed/` captures periodically:
- `grep "cheap-repair"` (in error fields) → count of benign-caught drift (informational, not alarming)
- captures WITHOUT a "cheap-repair" error → surface anything that went to retry (the actual thing to worry about)
- spot-check raw scene counts and page sequences in the leading-12 slots when investigating any non-cheap-repair capture

**Pre-committed escalation rule** (carried forward from 2026-05-23 plan): if either trigger fires, the next move is a fundamental rethink of generation — NOT more prompt iteration, NOT more output-side cleverness.

### Catalogue expansion lessons (2026-05-24)

First catalogue-expansion iteration shipped (**prompt-8-iter-1 vertical-split**) after three failed attempts. The lessons from the four attempts together are more durable than any single template:

**THE ARRANGEMENT-AXIS LENS** — the right way to think about template variety:

What makes a new template legitimate is a NEW ARRANGEMENT of image-and-text on the page, not a size/drama/aesthetic variation of an existing arrangement. The catalogue's arrangement slots so far:

| Arrangement | Template | Image type |
|---|---|---|
| side-by-side (vertical split line), landscape image | **prompt-2-iter-2** | landscape aggressively cropped into a 0.84-aspect column, with painted left-edge feather bleeding into text |
| top/bottom (horizontal split line), contained vignette image | **prompt-3-iter-2** | landscape, painted as a vignette occupying upper portion with cream clearing for text below |
| text-over-fullbleed, landscape image | **prompt-6-iter-1** | landscape edge-to-edge, text overlay in lower portion on translucent cream backdrop (RESERVED for climax) |
| **side-by-side (vertical split line), PORTRAIT image** | **prompt-8-iter-1** | **portrait 3:4 pinned, fills 58% column edge-to-edge with hard clean vertical cut to text on pure cream** |

The arrangement-axis perspective explains why prompt-8 ships and "workhorse-drama" doesn't, even though both made nice mockups. Future template ideas should be evaluated against the arrangement-axis test first: *is this a new arrangement, or is it just a different size/drama/typography of an existing arrangement?* If the latter, the gain is marginal and not worth the catalogue weight.

**THREE BANKED FAILURES from this iteration** (don't repeat the mistakes; do reuse the lessons):

1. **prompt-7-iter-1 "quiet-vignette / breath page" — SCRAPPED.** The hypothesis was that prompting Gemini for "small contained vignette with abundant cream around" would produce reliable small images. It didn't — N=3 stress-test gave 1/3 strong-pass (natural firefly), 2/3 frame-fill (expansive + interior scenes). Aspect-pin (16:9) held but the SIZE language was ignored. **Lesson banked: prompt-engineering Gemini for structural properties of the painted area (small / contained / cream-around) is unreliable. Gemini's reliable mode is full-bleed contained scenes; ask it to do that and let CSS handle structural constraints.** A v2 three-band CSS-structural rescue was prototyped (image shrunk-and-feathered into a fixed CSS band, text on guaranteed-clean cream band, structural gap between) — the layout mechanics work, but feathered-shrunk-raster on the busy v1-firefly source read marginal (caveat: a cleanly-edged production composition would likely feather better, but never tested because the structural pivot to prompt-8 was the clearer win). Breath-page slot remains open if a future approach proves reliable; current `templates/prompt-7-iter-1/` kept on disk via `deferred: true` for the test-output/ failure-mode evidence. **prompt-7 number is BURNED — don't reuse it for future templates** (the next slot is prompt-9-iter-1 if/when needed).

2. **frame-break Flavors 1 + 2 — both hit ceilings.** Flavor 1 (CSS frame inset within image, art bleeds past frame): two $0 mockups on retrofit images (1333 p9). v1 (frame inside full-page image) had the bleed go into MORE IMAGE — invisible effect. v2 (corrected: image strip narrower with cream margins L+R, image taller than frame extending into cream top+bottom) read as mild-elegant "rectangle drawn through an image" rather than dynamic "scene bursts past frame." Lesson banked: **frame-break drama at the structural-only level requires the bleed to extend into VISIBLE CREAM around a contained image — the retrofit cropping into a narrower-than-page column achieves this, but the result is mild because all our existing images are composed full-bleed with the same scene continuing in the bleed area** (no directional "subject pierces the frame" content). Flavor 2 (true comics character-burst) requires SUBJECT ISOLATION (bg-removal). Honest assessment: feasible via `@imgly/background-removal-node` (~30MB JS/WASM, integrates), but the failure modes are watercolor-specific and severe — soft hair edges mangled, translucent glow elements misclassified, wash-integrated atmospheric shadow either clipped or kept-with-bg, multi-character scenes ambiguous. **DEFERRED with eyes open about the failure-mode budget** — not worth investing unless prompt-8 + future workhorse templates leave a real gap that only comics-burst drama can fill. Both `templates/_frame-break-prototype/` (template-only, no config) on disk for the mockup artifacts; not registered.

3. **"workhorse-drama" prototype — NOT shipped (arrangement-axis lesson).** Full-bleed image top 75% + clean text band bottom 25% on pure cream. The mockup was beautiful — hard horizontal cut at 75% read as intentional/gallery-feel, the distinction from prompt-6 (which keeps text OVER the image on translucent cream) was clearly readable, EB Garamond 18pt narrative on pure cream below was clean and legible. But: it's the same **top/bottom arrangement** as prompt-3 — just with a bigger image and a different image-text boundary style. A SIZE/DRAMA VARIATION of an existing arrangement axis. **The user correctly identified that catalogue weight should be spent on new arrangements, not variations** (a book using both prompt-3 and "workhorse-drama" would feel like two flavors of the same kind of page). Lesson banked + the arrangement-axis lens was named here. The mockup files in `templates/_workhorse-drama-prototype/` are kept on disk (template-only, no config) as evidence + reference for the lens.

**THE PATTERN COMMON TO ALL THREE FAILURES + prompt-8's SUCCESS:**

- prompt-7 failed because we asked Gemini to do something it's not tuned for (paint small).
- frame-break failed because the dramatic effect requires content Gemini doesn't naturally produce (directional subject-edge-piercing) — and the alternative (subject isolation) trades reliability for drama.
- workhorse-drama "failed" (not shipped) because it didn't add a new arrangement to the catalogue.
- **prompt-8 succeeded** because it (a) asked Gemini for something it can reliably do (paint a full scene), (b) used the aspect-pin lever to make the column match the image, and (c) added a genuinely new arrangement axis (portrait-image side-by-side).

**The rule that crystallised:** *cooperate with both tools — ask Gemini for what it does naturally (full painted contained scenes, with the aspect we pin), let CSS do structural work (column geometry, hard clean boundaries, pure-cream text bands).* When a template idea requires Gemini to do something it can't reliably do (paint small, leave specific empty space, isolate subject), either find a CSS-only path or shelve. When a template idea is "same arrangement, different aesthetic," shelve.

**Aspect-pin lever (banked from prompt-7 work + prompt-8 validation, 2026-05-23 to 2026-05-24):** the SDK's `imageConfig.aspectRatio` field (supported on `@google/genai` v1.52+, plumbed through [src/gemini.js](src/gemini.js) → [src/page-pipeline.js](src/page-pipeline.js) → optional `imageGeneration.aspectRatio` in template configs) gives reliable per-template aspect control. Validated values: `"16:9"` (prompt-7 v1 holds, but Gemini still ignored size language at that aspect), `"3:4"` (prompt-8 holds across N=3 — aspect 0.747 vs target 0.750, ~0.4% deviation, identical across all 3 stress-varied scenes). The lever is now load-bearing for any template whose CSS box has a specific aspect — match the pin to the box, no `object-fit:cover` crop. Use it.

**Rendered-page measurement (banked from same work):** [src/page-pipeline.js](src/page-pipeline.js)'s `renderPdfWithDynamicCss` now also produces `page-NN-rendered.png` alongside the PDF via Puppeteer `page.screenshot()`. Use the RENDERED PNG for any measurement of "what the user sees" (size %, painted-area %, etc.) — the raw Gemini PNG lies when CSS crops it post-hoc. The lesson: measure the rendered output, not the raw inputs.

### Robustness-batch defect fixes (2026-05-28)

Ran a 6-book non-Iris robustness batch (Bo/3, Anneliese/9, Søren/6, Mia/4, Tobias/9, Priya/7) — all 12/12 rendered. Surfaced + FIXED 5 website-prerequisite issues (all in the main pipeline, verified):
- **D2 — retry classifier missed SDK timeouts.** `classifyError` ([src/anthropic.js](src/anthropic.js)) now detects `Anthropic.APIConnectionError` (covers `APIConnectionTimeoutError`) by ERROR CLASS, routed through the 1-retry backoff. Also bumped client `timeout` 180s → 300s. (Root cause of Søren/Tobias hard-fails when 6 story-gens ran concurrently.)
- **D3 — no unattended path.** Added `--yes` / `--auto-confirm` flag + `AUTO_CONFIRM=1` env var to both `generate-story.js` and `generate-book.js` (value-less boolean in parseArgs; skips the readline CONFIRM gate). Required for the website.
- **D4 — temp-file race.** `renderPdfWithDynamicCss` previously wrote a SHARED `templates/<id>/_pipeline-rendering.html` → concurrent renders collided (ENOENT/FILE_NOT_FOUND, caused Mia + Priya retries). Now a per-render unique path `os.tmpdir()/daboo-render-<uuid>.html` with `finally`-block cleanup (fires on success AND error). Verified via a 3-concurrent-same-template render.
- **Slug latinization.** `slugify` now latinizes diacritics (NFKD + explicit map for stroke/ligature letters ø/æ/œ/ð/þ/ł/đ/ß) so Søren → `soren` not `s-ren`. Filesystem-slug only; narrative content already handled diacritics. Confirmed live (regen dir `2026-05-29-soren-...`).
- **D5 — parallel-render slowdown is NOT a code bug.** 6 concurrent book renders ran 2-3× slower per book (14-34 min vs ~8 min solo) — Gemini concurrency/queueing. **Design input for the website: use a job queue (bounded/serial workers), not parallel process spawns.**
- Also surfaced (NOT fixed, known limitations): **Gemini multi-subject count drift** (Priya's "two cats" rendered as 4) and **secondary-subject drift** (non-protagonist subjects have no reference sheet → drift) — both fed the multi-subject investigation below.

### Cover system shipped (2026-05-28 → 2026-05-29)

Front cover only (wrap/spine/back deferred to vendor selection). Three-step build:
- **Layout prototyping ($0):** chose **Variant C** — hero art full-bleed + a translucent cream lower-third panel (`rgba(240,234,219,0.92)`) carrying a dark-ink EB Garamond title + italic "A story for <Name>" subtitle. Other variants (title-in-top-negative-space, title-direct-on-art) rejected: they depend on the hero having cooperative composition; the panel guarantees legibility regardless of art. Canvas matches the interior page aspect (11×8.5in landscape).
- **Title auto-fit:** reuses the interior `fitTextToRegion` so any title length fits the panel width (graceful shrink/wrap; "Bo" → 56pt, "Anneliese and the Bell of the Noordster" → 51pt). [scripts/render-cover.mjs](scripts/render-cover.mjs) exports `renderCover()`; [scripts/render-cover-batch.mjs](scripts/render-cover-batch.mjs) is the driver (`--only <name>`).
- **`cover_concept` field (story-linking the cover):** the generic-cover problem was that hand-written cover actions ignored the story. Now Sonnet generates a `cover_concept` (added to schema `required`, the LAST field so it's written after the whole story) describing THIS story's signature cover moment; the cover prompt injects it as the scene while the template enforces the structural scaffold (face upper-half, lower-40% calm, full-bleed, 4:3 pin, anchored to sheets). Result: covers depict their own story (Iris=whispering to the winking star, Anneliese=the bell-hum in the cabin, Søren=the first wave with his robot) and are far more dynamic/varied than the old standing-portrait trio.
- **Face-orientation guardrail:** Iris's first concept (lying-on-back + overhead) rendered her face UPSIDE-DOWN. Added a hard rule to the COVER CONCEPT instruction: face must read RIGHT-SIDE-UP/legible (front/three-quarter/profile); NEVER inverted/extreme-overhead/foreshortened; camera DISTANCE + ACTION may still vary. Regen → "Iris and the Winking Star" (standing, looking up, face upright). Protects all future covers.
- **Registry exclusion:** cover-iter-1 has `kind:"cover"`; `loadTemplateRegistry` skips non-"page" kinds (before the selection_metadata check) so the cover never enters interior orchestration. Registry tests still 4 page templates.
- **On-model finding:** reusing existing protagonist sheets + matching char desc (option (a)) made SHEETS dominate appearance — e.g. Anneliese's cover kept the interior teal wetsuit even though the fresh concept text said "navy-blue and yellow." Covers stayed on-model vs interiors. (Exception: non-protagonist subjects like Søren's robot Bolt drift on covers — no sheet — same limitation as interiors.)
- Artifacts: [output/covers/<name>/](output/covers/) (hero.png + cover-<name>.{png,pdf}). Throwaway prototype scratch: `templates/_cover-prototype/`, `templates/_bg-comparison-prototype/`.

### Multi-subject probe (2026-05-29) — PARKED, nothing wired in

ONE question, cheaply: does minting a reference sheet for a NON-protagonist subject hold it on-model the way the protagonist's sheets do? **Stage A (non-human, easy case): YES.** Minted a fixed-design sheet for Bolt (Søren's cardboard/tin-can robot), rendered 3 varied scenes with **3 Søren sheets + 1 Bolt sheet = the 4-reference ceiling**. Findings:
- Bolt held on-model across close/wide/mid + 3 different actions (vs the page-to-page wobble + cover≠interior drift WITHOUT a sheet). **One sheet sufficed** for a visually-distinct subject.
- **No cost to the protagonist** — Søren as tight as in single-protagonist renders (even the rocket-tee held). Two distinct subjects, no texture bleeding.
- **Fine-detail drift + the emphasis lever:** Bolt's curled-wire antennae drifted straight on one scene; making them a "defining feature, always curled" in the per-page prompt pulled them back curled — BUT the lever is BLUNT (over-corrected to fuller spirals). No other Bolt detail measurably lost when emphasizing one.
- **OPEN — Stage B (two HUMAN children), NOT run:** the real test (face cross-contamination, multi-feature emphasis competing for weight, 4-ref budget splitting e.g. 2+2, subject-count fidelity). Pre-scoped; run only when multi-character becomes a real feature ask. Non-human multi-subject (pets/toys/robots) is effectively proven; two-human is the one unresolved question.
- All artifacts throwaway in `templates/_multisubject-probe/`; `renderPageWithTemplate` untouched.

### Week 4 housekeeping (deferred items)

Items surfaced during Week 3 prep that don't block current work but must be addressed before Week 4+ deliverables ship.

1. **PNG/JPEG extension mismatch in [src/gemini.js](src/gemini.js) (deferred 2026-05-17).** Gemini's image model returns JPEG bytes (signature `FF D8 FF E0 ... JFIF` confirmed on all 30 image files); `src/gemini.js` saves them with `.png` extension without format conversion. Functionally fine in current pipelines (image viewers + `pdfkit` content-sniff), but breaks anything that trusts the extension — most importantly **web serving with correct MIME types in Week 4**. Fix options: (a) sniff first bytes, save with truthful extension (simpler; requires updating all path consumers); (b) transcode to actual PNG via `sharp` (preserves PNG everywhere, adds dependency). Lean (a). **DO NOT TOUCH in Week 3** — `src/gemini.js` is shared by every active pipeline and must not be perturbed mid-stream.

2. **Resumable book generation — Phase 2 backlog item (after Phase 1 validates, 2026-05-20).** [scripts/generate-book.js](scripts/generate-book.js) should detect pre-existing `pages/page-NN.pdf` files and skip re-rendering those scenes. Useful for partial-failure recovery (avoid re-generating 5 successful pages when only 7 failed) and for iterative development. Estimated work: ~50 lines; needs a skip-vs-regenerate flag plus state-aware merge. Deferred until Phase 1 of Stream 3 (Type-B image-gen bug fix + cost-tracking fix) validates the architecture end-to-end.

3. **npm audit warnings — 2 moderate-severity vulnerabilities in pdf-lib transitive deps (deferred 2026-05-19).** Reported by `npm audit` after installing pdf-lib for the Stream-3 multi-template book merge. Likely in pdf-lib's older internal upng-fork. Functional risk: none in current Node-side usage; concern surfaces if dependencies are exposed to untrusted PDF input or served to browsers. **Pre-customer-shipping hygiene item, not blocking.** Address via `npm audit fix` once we're ready to ship to friendly testers (Week 6 per roadmap).

---

## 3. Spend tracker

| Bucket | Cap | Spent | Remaining |
|---|---|---|---|
| Replicate (Phase 2, carried over) | $10 | $1.74 | $8.26 |
| Anthropic (MVP, free credit) | $5 | **~$3.8** | **~$1.2 ⚠ low** |
| Gemini (paid tier, on AI Studio account) | informal | **~$9.4 cumulative** (… + 2026-05-28 robustness batch + cover system + multi-subject probe) + Phase 1/2 (untracked) | (informal tracking) |

**Project total ≈ $14.9** (Replicate $1.74 + Anthropic ~$3.8 + Gemini ~$9.4, + untracked Phase 1/2 spike). **⚠ Anthropic free credit ~$1.2 left — will need a paid Anthropic plan before/at website launch.** 2026-05-25→29 sessions added ≈ $5.7: **robustness batch** ~$4.56 (Phase-1 6 story-gens ~$0.88 Anthropic + Phase-2 6 book renders $3.68 Gemini) + **cover system** ~$0.98 (title/cover_concept regens ~$0.70 Anthropic + cover heroes $0.28 Gemini) + **multi-subject probe** $0.20 Gemini. 2026-05-24 added $1.08 (catalogue-expansion + four-template integration test). 2026-05-23 added $0.43 (count-drift probe). 2026-05-22 added ~$0.93 (anti-repetition probe + 1333 book + p9 regen). (Recent per-item costs are approximate — reconciled from chat, not instrumented.)

Replicate breakdown (frozen — Phase 2 closed):
- Filter test: $0.025
- Training-set generation (12 Gemini calls, billed to Gemini, not Replicate — but logged here for completeness): $0.48
- LoRA training (~21 min on H100): $1.08
- LoRA scene generation (Step 4, 12 calls): $0.16
- **Total: $1.745**

Anthropic breakdown:
- 2026-05-16 — Sample 1 / Mateo / kite-search (story-only test): $0.0517 (1579 in + 3128 out, 87s wall). 4/4 pass.
- 2026-05-16 — Sample 2 / Sage / preschool nerves, attempt 1: ~$0.05 (failed at max_tokens=4096 ceiling — still billed for tokens consumed).
- 2026-05-16 — Sample 2 / Sage / preschool nerves, retry at max_tokens=8192: ~$0.05. 4/4 pass.
- 2026-05-17 — Run 1 / Mateo book / story portion: $0.06.
- 2026-05-17 — Run 2 / Sage book / story portion: $0.10.
- 2026-05-20 — Iris story-gen attempt 1 (failed at MAX_TOKENS=8192 truncation): ~$0.05.
- 2026-05-20 — Iris story-gen retry at MAX_TOKENS=16384: ~$0.113.
- 2026-05-21 — Tier-3 template-selection probe: $0.047.
- 2026-05-21 — Tier-3 story-gen iris-1021 (first 3-template story): $0.1005.
- 2026-05-21 — story-gen iris-1032 + iris-1037: 2× failures, 13-scene drift, aborted by shape validation (no story.json written, tokens billed): ~$0.30 total (estimate — no usage data captured for these two; the capture mechanism was added afterward).
- 2026-05-21 — story-gen iris-1051: shape-retry rescued (attempt-1 13-scene fail + retry, both billed): ~$0.31.
- 2026-05-21 — story-gen iris-1104 (shooting-star story): $0.1623.
- 2026-05-22 — anti-repetition probe run 1 (iris-1333, shape-retry rescued): $0.1390.
- 2026-05-22 — anti-repetition probe run 2 (iris-1338, shape-retry rescued): $0.1552.
- **Total: ~$1.68**

Gemini breakdown (informal):
- 2026-05-17 — Run 1 + Run 2 image generation: ~$1.20 (30 image calls across 2 books, at ~$0.04/call — 3 sheets + 12 scenes per book).
- 2026-05-17 to -18 — Stage 1 + Stage 1.5 template-spike work: ~$0.16 (4 image regens × $0.04). Breakdown: Stage 1 v1 baseline $0.04; Stage 1.5 variations v2/v3/v4 for prompt-2-iter-2 $0.12.
- 2026-05-19 — Stage 2 Stream 1 + Stream 2 padding-test work: ~$0.24 (6 image regens × $0.04). Breakdown: v5_prompt3_clearing first attempt $0.04; v5a_untouched_paper iteration $0.04; text-aware-zone v1 $0.04; text-aware-zone v2 (PADDING_VERTICAL=0.8) $0.04; text-aware-zone v3 (PADDING_HORIZONTAL=2.0) $0.04; text-aware-zone v4 (PADDING_VERTICAL=2.5) $0.04. **No Gemini spend in Stream 2 page-pipeline work** — integration test used v4 image override.
- 2026-05-20 — Stream 3 Iris book generation: $0.52 (12 scene-image calls + 1 transient-500 retry, all at $0.04/call). 3 character sheets re-used from disk, no API call.
- 2026-05-20 — prompt-4-iter-1 iteration cycle: $0.20 (v1 + v2 + v3 + v4 + v5, each one fresh image call × $0.04). Part 1 mechanical tests via imagePathOverride were $0. Color-correction post-process tests (binary + feathered) were $0 (used existing v5 PNG). Iteration cycle concluded **deferred indefinitely** after v5 confirmed Gemini cream drift; see Section 2 "Color-matched substrate..." and "Full-bleed wins where inset-on-cream loses".
- 2026-05-20 — prompt-6-iter-1 first-attempt validation: $0.04 (one fresh image call). Third production template shipped on first attempt — contrast with prompt-4 informs the full-bleed design heuristic banked in Section 2.
- Phase 1 + Phase 2 spike work: not formally tracked.

**Total 2026-05-20 Gemini spend: $0.76.** ($0.52 Iris book + $0.20 prompt-4 v1-v5 + $0.04 prompt-6 v1.)

- 2026-05-21 — prompt-6 render-robustness test (3 climactic scenes): $0.12.
- 2026-05-21 — Iris 1104 full book render: $0.76 (19 Gemini calls: 3 character sheets + 12 scene images + 4 escalation re-renders).
- 2026-05-21 — prompt-3 hardening renders: $0.24 ($0.04 decoration-fix verify + $0.16 Phase-2 4-scene region-detection measurement + $0.04 Type-C fresh-prompt validation). Type-C $0-override validations + color-correction tests were $0.

**Total 2026-05-21 Gemini spend: $1.12.** ($0.12 prompt-6 robustness + $0.76 1104 book + $0.24 prompt-3 hardening.)

- 2026-05-22 — 1333 Shimmer book full render (foundation integration test): $0.60 (15 calls: 3 sheets + 12 scenes, **0 escalations** — Type C structural reliability proven in practice; the 1104 book had 4 prompt-3 escalations, this one had 0).
- 2026-05-22 — 1333 page 9 climax regen (augmented-action camera-orientation nudge): $0.04. Original preserved at `pages/page-09-original.{png,pdf}`.

**Total 2026-05-22 Gemini spend: $0.64.** ($0.60 1333 book + $0.04 p9 regen.)

Per-book cost (Week 2 baseline): ~$0.66-0.70 — $0.06-0.10 Anthropic (story portion) + $0.60 Gemini (15 image calls). Anthropic credit at $4.69 remaining; Gemini is the dominant cost lane going forward.

---

## 4. Files on disk that matter

### Source (active MVP)

- [src/gemini.js](src/gemini.js) — Phase 1 image-gen wrapper. Untouched. Will be consumed by the Week 2 image pipeline.
- [src/anthropic.js](src/anthropic.js) — **NEW Week 1 Day 2.** Story-gen wrapper. Locked to `claude-sonnet-4-6`. Structured output via `output_config.format`. Custom selective retry. Brand constants inlined (sourced from `test-script.json`).
- [src/pipeline.js](src/pipeline.js) — Phase 1 image-gen pipeline. Reusable in Week 2.
- [src/index.js](src/index.js) — Phase 1 entry point.

### Scripts (active MVP)

- [scripts/generate-story.js](scripts/generate-story.js) — **Week 1 Day 2.** CLI to call `generateStory()` from `src/anthropic.js`. Named-flag args (`--name`, `--age`, `--theme`, `--appearance`), confirmation gate, writes `output/stories/<run-id>/{story,meta}.json`. First paid call gated through this script.
- [scripts/generate-book.js](scripts/generate-book.js) — **Week 2 orchestrator.** End-to-end book generation: `generateStory()` → 3 character-sheet image calls → 12 scene image calls → writes `story.json` + `meta.json` + `character-sheets/sheet-NN.png` + `pages/page-NN.{png,txt}` to disk. Both 2026-05-17 books produced via this script. ~23 min runtime, ~$0.66-0.70/book.
- [scripts/generate-pdf.js](scripts/generate-pdf.js) — **Week 3 PDF assembler, 716 lines.** pdfkit-based; three layout variants (Classic + Cinematic + Asymmetric) with position-based dispatch via `PAGE_LAYOUT_BY_POSITION`. **STATUS: HISTORICAL ARTEFACT — DO NOT ITERATE.** Three rounds of layout work on this file did not pass the bland-feeling gut test (see "Pivot — Template architecture" in Section 2). Design layer pivoted to HTML/CSS templates via Puppeteer (Architecture-B spike pending). Preserved on disk; will be replaced if architecture spike succeeds.

### Research notes (active reference)

- [research-notes/layout-research.md](research-notes/layout-research.md) — survey of layout candidates that drove Layout v2 scope. Three-style framework (Classic / Cinematic / Asymmetric) is now superseded by the Recraft-driven template-library approach, but the research record is preserved for the design vocabulary it established.
- [research-notes/layout-diagnostic.md](research-notes/layout-diagnostic.md) — geometric diagnosis of the variance-test output (page-05 L-shape, page-9-feels-like-page-1). Triggered Fix A + Fix D in the post-diagnostic round. Both fixes shipped, neither rescued the gut-test verdict — final evidence that pdfkit iteration was the wrong design surface for this problem.

### Template / measurement work (Stage 1-2 spike, 2026-05-17 to -19)

**Production primitives (src/, all live as of 2026-05-19):**

- [src/text-measurement.js](src/text-measurement.js) — `measureText()` Puppeteer-based dimensional prediction (~140 lines, shipped 2026-05-18).
- [src/region-detection.js](src/region-detection.js) — `detectCleanRegion()` finds largest cream rectangle in an ROI using RGB-Euclidean classifier with `creamDistance` threshold (default 30). Uses `sharp` for image loading + monotonic-stack largest-rectangle-in-histogram algorithm. (~280 lines, shipped 2026-05-19.)
- [src/auto-fit.js](src/auto-fit.js) — `fitTextToRegion()` iterates fontSize from `maxFontSize` to `minFontSize`, returns largest size at which text wraps within the region. Wraps measureText. (~75 lines, shipped 2026-05-19.)
- [src/page-pipeline.js](src/page-pipeline.js) — `renderPageWithTemplate()` the per-page orchestrator. Loads config → image gen (or override) → region detect → pixel-to-page-pt conversion → auto-fit → dynamic CSS injection → PDF render. (~290 lines, shipped 2026-05-19.)

**Spike scripts (scripts/):**

- [scripts/render-pdf-template.js](scripts/render-pdf-template.js) — Puppeteer-based PDF renderer for HTML/CSS templates. Takes `--template-path`, `--book-dir`, `--page-number`; optional `--image-override`, `--output-name`. Used in Stream 1; page-pipeline.js does its own rendering for Stream 2.
- [scripts/regen-image-template-aware.js](scripts/regen-image-template-aware.js) — one-off image regen with VARIATIONS map. Each variation has a `template_dir` field. Used in Stage 1.5 / Stream 1.
- [scripts/test-text-aware-zone.js](scripts/test-text-aware-zone.js) — Stream 1 integration script. Reads Mateo p9, calls measureText, computes cream-zone dimensions, builds Gemini prompt with placeholders, generates image, renders PDF. Used for the v1-v4 padding iterations.
- [scripts/test-measure-text.js](scripts/test-measure-text.js), [scripts/diagnose-measure-text.js](scripts/diagnose-measure-text.js) — measureText validation + bug-diagnosis from 2026-05-18.
- [scripts/test-region-detection.js](scripts/test-region-detection.js) — region-detection validation (v2/v3/v4 images, writes overlay PNGs). New 2026-05-19.
- [scripts/test-auto-fit.js](scripts/test-auto-fit.js) — auto-fit validation (Mateo p9 at v4 region, Mateo p9 at v2 region, Mateo p5 at v4 region). New 2026-05-19.
- [scripts/test-page-pipeline.js](scripts/test-page-pipeline.js) — Stream 2 integration test. Runs the full page-pipeline against Mateo p9 + v4 image override. New 2026-05-19.

**Template artefacts (templates/):**

- [templates/prompt-2-iter-2/template.html](templates/prompt-2-iter-2/template.html) — first validated template (split-spread). User verdict on v2_painted_edges image: "looks like a real children's book page." **Missing `config.json`** — to be built in Stream 3.
- [templates/prompt-3-iter-2/template.html](templates/prompt-3-iter-2/template.html) — second template (image-on-top + cream-clearing-below + painted three-side framing). Currently `top: 82%` text-layer default; page-pipeline overrides at runtime.
- [templates/prompt-3-iter-2/config.json](templates/prompt-3-iter-2/config.json) — **first complete template config (2026-05-19).** Typography, regionDetection, imageGeneration (with placeholder prompt template), rendering blocks.
- [templates/prompt-3-iter-2/page-09.pdf](templates/prompt-3-iter-2/page-09.pdf) — **first end-to-end page-pipeline output (2026-05-19), 815.0 KB, user-validated.**
- `templates/prompt-2-iter-2/spike-output-*.pdf` — variation outputs (v2/v3/v4) for visual side-by-side judgment.
- `templates/prompt-3-iter-2/test-image-page-09-text-aware-zone-v{1,2,3,4}.png` — Stream 1 padding-iteration images (preserved for comparison).
- `templates/prompt-3-iter-2/spike-output-text-aware-zone-v{1,2,3,4}.pdf` — Stream 1 padding-iteration PDFs (preserved).
- `templates/prompt-3-iter-2/_region-detection-v{2,3,4}.png` — region-detection validation overlays.
- `output/measurement-validation/test{2,3}-*.pdf` — measureText validation PDFs with red-dashed predicted-bottom markers.
- [recraft-spike/](recraft-spike/) — Recraft reference images used as visual targets.

### Scripts (Phase 2 FLUX-era, archived but still on disk)

- [scripts/filter-test.js](scripts/filter-test.js)
- [scripts/generate-training-set.js](scripts/generate-training-set.js)
- [scripts/train-lora.js](scripts/train-lora.js)
- [scripts/generate-flux-scenes.js](scripts/generate-flux-scenes.js)

Ran successfully in Phase 2 and kept for reproducibility. Not used by MVP. Safe to leave; safe to move to `archive/` if clutter becomes a problem.

### State + inputs

- [test-script.json](test-script.json) — Phase 1/2 test input. Now also the **source of truth** for the brand-style constants (`STYLE`, `COMPOSITION_RULES`, `NEGATIVE_PROMPT`) inlined in `src/anthropic.js`. Keep until multi-style becomes a feature.
- [training-script.json](training-script.json) — Phase 2 training-set generation input. Inactive in MVP.
- [output/lora/trained-model.json](output/lora/trained-model.json) — LoRA handoff state from Phase 2. Retain for now; Replicate model `adro-rosso/dabookting-testchild-v1` still exists on their side.
- [.env](.env) — holds `GEMINI_API_KEY`, `REPLICATE_API_TOKEN`, `ANTHROPIC_API_KEY`. Never commit, never paste.
- [.env.example](.env.example) — placeholders for all three keys.

### Generated artefacts

**Week 1 (closed; samples that validated v1 of the system prompt):**
- [output/stories/2026-05-16-mateo-0002/](output/stories/2026-05-16-mateo-0002/) — Sample 1 / Mateo / kite-search adventure. 4/4 pass.
- [output/stories/2026-05-16-sage-2302/](output/stories/2026-05-16-sage-2302/) — Sample 2 / Sage / preschool nerves emotional. 4/4 pass.

Both contain `story.json` (5-field test-script.json shape: character + style + composition_rules + negative_prompt + 12 scenes) + `meta.json` (run-id, timestamps, model, inputs, token usage, estimated cost).

**Week 2 (active; first paid end-to-end book runs that validated the pipeline):**
- [output/books/2026-05-17-mateo-0002/](output/books/2026-05-17-mateo-0002/) — Run 1 / Mateo / adventure. 23.2 min, 16/16 succeeded, $0.66.
- [output/books/2026-05-17-sage-0036/](output/books/2026-05-17-sage-0036/) — Run 2 / Sage / emotional. 23.2 min, 16/16 succeeded, $0.70.

Both contain `story.json`, `meta.json`, `character-sheets/sheet-NN.png` (×3), and `pages/page-NN.{png,txt}` (×12) per the locked Week 2 output structure.

**Phase 1/2 (reference only):**
- `output/scenes/page-01..12.png` — Gemini Run 3 scene outputs. The winning baseline.
- `output/flux-scenes/flux-page-01..12.png` — FLUX-LoRA outputs from Phase 2 Step 4. The losing baseline.
- `output/character-sheet/sheet-01..03.png` — Phase 1 character references.
- `output/training-set/train-01..12.png` — LoRA training set.
- `output/flux-filter-test/test.png`, `output/prompts.json` — misc.
- `output-run1/`, `output-run2/`, `output-run3-character-sheet/`, `.sixth/` — older iteration snapshots; safe to leave or clean up.

### Package state

- `@anthropic-ai/sdk@^0.96.0`, `@google/genai@^1.52.0`, `replicate@^1.4.0`, `dotenv@^17.4.2`, `jszip@^3.10.1`, `undici@^8.2.0`.

---

## 5. Phase history (closed work — for reference)

### Phase 1 — Gemini character-consistency spike (DONE, validated)

**Spike question:** "Can we generate 12 images of the same child consistently enough that a parent would pay for it?"
**Answer:** YES.

- Project scaffolded: Node ESM (`type: "module"` in `package.json`), `.env` / `.env.example` / `.gitignore` created.
- Dependencies: `@google/genai`, `dotenv`, `undici`.
- [src/gemini.js](src/gemini.js): thin wrapper around the GenAI SDK; selective retry (5xx + ECONNRESET/ETIMEDOUT: 2 retries; UND_ERR_HEADERS_TIMEOUT / UND_ERR_BODY_TIMEOUT / "fetch failed": 1 retry; **never** on 429); undici dispatcher set to 10-min headers/body timeout via `setGlobalDispatcher`; `MODEL` exported as `gemini-3.1-flash-image-preview`.
- [src/pipeline.js](src/pipeline.js): 6s pacing between calls, slow-call warning at >60s, per-image prompt log.
- [src/index.js](src/index.js): ESM entry, top-level await, full stack trace on error.
- **Phase 1 Run 3 succeeded.** 3 character-sheet PNGs + 12 scene PNGs in `output/`. Visual verdict: same kid across all 12, sandals consistent.

### Phase 2 — FLUX LoRA comparison (DONE, Gemini won)

**Question:** "Can FLUX-LoRA beat Gemini on quality, consistency, or economics?"
**Answer:** NO. Gemini wins.

| Step | Action | Outcome |
|---|---|---|
| 0 | Install `replicate`, configure `REPLICATE_API_TOKEN` | ✅ Done |
| 1 | `scripts/filter-test.js` — single base-flux-dev safety check | ✅ Passed |
| 2 | `scripts/generate-training-set.js` — 12 plain-background portraits | ✅ Done |
| 3 | `scripts/train-lora.js` — train custom LoRA on Replicate | ✅ Trained as `adro-rosso/dabookting-testchild-v1`, version `ac5c775ca7ad...`, trigger `DBTK1` |
| 4 | `scripts/generate-flux-scenes.js` — 12 comparison scenes | ✅ Ran 2026-05-06, all 12 succeeded, $0.16 actual |

**Visual verdict (Gemini Run 3 vs FLUX-LoRA Step 4):**

| Dimension | Gemini | FLUX-LoRA |
|---|---|---|
| Same kid across 12 scenes | Yes | Varied |
| Clothing locked | Yes | Drifted |
| Sandals preserved (in-prompt for Gemini, in-LoRA for FLUX) | Yes | Inconsistent |
| Age (~6 y/o) | Correct | Drifted older |
| Watercolour style | Strong | Patchy |

**Decision: Path 1 — commit to Gemini for MVP.** FLUX work archived but kept on disk (model still hosted on Replicate; scripts still in `scripts/`). Could be revisited if Gemini cost becomes a bottleneck at scale, or if the LoRA-per-character economic model becomes attractive with a different inference path.

### Decisions still standing from Phase history

- Model for images: `gemini-3.1-flash-image-preview` (paid tier).
- Pacing: 6s between Gemini calls.
- 3 character-sheet PNGs are passed as references for every scene call (Gemini path).
- Custom selective retry layered on top of disabled SDK auto-retries — mirrored in `src/anthropic.js` for the text path.

---

## 6. Phase 3 — Deep personalisation (post-launch backlog)

This is a backlog of post-launch ambitions, captured to keep the long-term vision visible while staying disciplined about MVP scope. Phase 3 only begins after ~20-50 paying customers have used the MVP and we have real signal on which personalisation levers parents actually value.

Deep-personalisation dimensions:

- **Secondary characters:** siblings, pets, friends, parents — with their own traits and roles in stories.
- **Family and relationship context:** grandparents, beloved homes, places that matter to the child.
- **Art style choice:** watercolor / Pixar-ish / Ghibli-ish / line drawing / others to be discovered.
- **Palette and mood:** warm / dreamy / vibrant / muted.
- **Character personality:** shy/bold, curious/cautious, sporty/bookish, etc. — driving story behaviour, not just appearance.
- **Story arc type:** bedtime calm / exciting adventure / emotional resonance / silly.
- **Tone of voice:** funny / tender / epic / classic / contemporary.
- **Reading level / age-tuning:** 3-5, 5-7, 7-9, 9-12.
- **Layout style as user choice:** advanced setting; pick template per book or per page. Added 2026-05-17 once template-library architecture became the active path.
- **Portrait orientation as user option:** advanced setting; flips entire book to portrait format. Each template would need a portrait variant alongside its landscape default. Added 2026-05-17.

All of these are buildable on the current architecture. Prioritisation happens post-launch, driven by customer signal, not by guesses.

---

## 7. How to resume

1. **Read this file end-to-end.**
2. Open project in VS Code: `File → Open Folder → C:\Users\Adrian\Desktop\DaBookTing`.
3. Open a terminal at project root.
4. Sanity-check filesystem (the listings in Section 4 are authoritative as of 2026-05-16):
   ```
   Get-ChildItem src
   Get-ChildItem scripts
   Get-ChildItem output\stories
   ```
5. Confirm `.env` still has all three keys:
   ```
   Get-Content .env
   ```
   Expect lines for `GEMINI_API_KEY`, `REPLICATE_API_TOKEN`, `ANTHROPIC_API_KEY`. **Never paste contents into chat.**
6. Resume the next concrete action in Section 1 — Stream 3 multi-template integration with [scripts/generate-book.js](scripts/generate-book.js). Add `layout_intent` field to story-gen schema, update story-gen system prompt, modify generate-book.js to call `renderPageWithTemplate` from [src/page-pipeline.js](src/page-pipeline.js) per scene, build [templates/prompt-2-iter-2/config.json](templates/prompt-2-iter-2/config.json) (the missing second template config), test against Mateo by re-tagging scenes manually. Performance prerequisite: shared-browser refactor of [src/text-measurement.js](src/text-measurement.js) (~5-line change) to cut auto-fit overhead 5×.

### If something has changed

- **Anthropic key rotated:** generate a new one at console.anthropic.com → API Keys, paste into `.env` (replacing existing line; never paste in chat). Same `sk-ant-` prefix.
- **`@anthropic-ai/sdk` missing from `node_modules/`:** run `npm install` from project root.
- **Replicate LoRA deleted from their side:** retrain via `node scripts/train-lora.js` (would cost ~$1.08 again). Not needed for MVP — FLUX is archived.

---

_End of session notes._
