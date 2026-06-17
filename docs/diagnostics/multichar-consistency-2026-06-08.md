# Multi-character consistency diagnostic — Adrian's book (order 28d052b6)

**Date:** 2026-06-08 · **Cycle:** B.7 (pure diagnostic; no production code changes)
**Subject:** the first real multi-character production book — protagonist **Adrian** (8)
+ tier-2 human secondary **Rob** (father). **Gemini spend:** $0.02.
**Output:** this document → input to B.8 (first fix cycle).

---

## 1. Methodology

### What we examined
- **The actual Fly book pages** (ground truth for the observed issues). The worker's
  scratch dir is ephemeral — only the final `book.pdf` was uploaded to Storage — so
  the Fly book's *sheets / story / prompts are gone*. The 12 page images were
  recovered by **extracting the embedded JPEGs directly from the PDF** (no PDF
  rasterizer was available locally). 11/12 pages came out clean; page-11's extraction
  truncated (irrelevant — it's a transitional page).
- **Same-input representative artifacts** for origin tracing (since the Fly
  intermediates are gone):
  - **Character sheets** from the B.6 local replication (`output/_diag/adrian-local/`):
    Adrian ×3, Rob ×2 — same inputs, same pipeline, same model.
  - **A fresh story** generated for Adrian's exact inputs ($0.02, story-only, no
    images) to read Sonnet's prose tendencies + per-scene template assignment.
  - **Pipeline code**: the story-gen system prompt (`src/anthropic.js`), the per-page
    prompt builder (`src/page-pipeline.js` `buildScenePrompt`), and the template
    configs (`templates/*/config.json`).

### Methodology caveat (important)
The **observed issues** are read off the **actual Fly book**. The **origin tracing**
uses **representative same-input artifacts**, because the Fly book's intermediates no
longer exist and Sonnet is non-deterministic (a re-run produces a different story +
different per-page outfit invention). This is sound for origin mapping — the origins
are *structural properties of the pipeline*, not of one specific generation — but
page-specific forensics (e.g., "Fly's exact page-8 template") are **inferred** from
the representative run, where the climactic beat landed on the same dramatic template
that explains the observed drift. Where a finding is inferred vs directly observed,
it is marked.

> **Banked infra follow-up (not this cycle):** the worker should upload intermediate
> artifacts (sheets, story.json, per-page prompts) to Storage alongside the PDF for
> shipped books, so future diagnostics aren't reconstructive. This cost us the ability
> to forensically inspect the exact Fly generation.

---

## 2. Artifact inventory

| Artifact | Source | Status |
|---|---|---|
| Fly book pages 1–12 | extracted from `tuatale-books/orders/28d052b6/book.pdf` | ✅ 11/12 (p11 truncated) |
| Adrian sheets ×3 | `output/_diag/adrian-local/character-sheets/sheet-0{1,2,3}.png` | ✅ |
| Rob sheets ×2 | `…/companion-1-0{1,2}.png` | ✅ |
| Sheet meta (fingerprints) | `…/{protagonist,companion-1}-meta.json` | ✅ |
| Adrian story (representative) | fresh $0.02 generation | ✅ |
| Fly story.json / per-page prompts | ephemeral worker scratch | ❌ gone (reconstructed) |

---

## 3. The six observed issues (confirmed on the actual Fly book)

| # | Issue | Evidence on the Fly pages |
|---|---|---|
| 1 | **Outfit changes nearly every page (both chars)** | Adrian's tee: blue→green→blue→blue/white-stripe→green→blue→white→green across pages. Rob's top: grey→green/blue-stripe→olive→blue→**green plaid button-shirt (p10)**→blue. (Also bike color drifts red→blue→green→red.) |
| 2 | **Mole drifts to the wrong cheek** | The mole follows whichever cheek faces camera rather than staying anatomically left. |
| 3 | **Mole on both cheeks (≥1 scene)** | Near-frontal pages 4, 6, 9 show a mole on **both** cheeks flanking the nose. |
| 4 | **Mole on whichever cheek the camera reveals** | Same root as 2/3 — the mole is rendered on the visible cheek regardless of side. |
| 5 | **Page 8 style + age drift** | Adrian rendered **much older** (pre-teen, elongated face) in a **looser/painterly** style vs the clean storybook line elsewhere. Dramatic full-bleed hero composition (Adrian large foreground, Rob tiny background). |
| 6 | **Helmet inconsistency** | Helmet present on p1 (held) and p10 (worn); **absent on the riding pages between** (p3, p4, p6, p8). |

---

## 4. Sheet-level findings (B.7.2)

| Feature axis | Adrian (3 sheets) | Rob (2 sheets) | Cross-char |
|---|---|---|---|
| **Outfit consistency** | ✅ Consistent — red striped tee + dark shorts + grey sneakers in all 3 | ✅ Consistent — grey tee + green long pants | — |
| **Asymmetric mole** | ⚠️ On the **left cheek in all 3** — but all 3 views are **left-favoring** (front, ¾-left, **left**-profile). **No right-side view exists.** | n/a | — |
| **Style** | ✅ Consistent clean child watercolor | ⚠️ **Inconsistent** — sheet-01 semi-realistic adult portrait; sheet-02 softer storybook | ⚠️ **Seam present** — Adrian child-watercolor vs Rob more adult-realistic |
| **Age** | ✅ Consistent ~8yo | ✅ Consistent adult | — |

**Key sheet-level takeaways:**
- The sheets **agree on each character's outfit** — so the book's outfit drift is **not** because the references disagree.
- The book **never renders either sheet outfit** (Adrian's red striped tee / Rob's grey-tee-green-pants never appear) — the render path discards the sheet wardrobe.
- The mole is correct in every sheet, but **every sheet is a left-favoring view**, so the model never sees a "clean right cheek" — no negative reference for where the mole should be *absent*.
- A real **style seam** exists between the child (watercolor) and the adult (more realistic), even within Rob's own two sheets.

---

## 5. Story-level findings (B.7.3)

From the representative $0.02 generation of Adrian's exact inputs:

- **Outfit IS committed in prose.** `character_description` → Adrian: *"a boy's
  navy-and-white striped tee, grey athletic shorts, and scuffed white trainers"*;
  Rob: *"a plain grey t-shirt, dark jeans rolled once at the ankle, and worn
  trainers."* Because the **input specified no outfit**, Sonnet **invents** one — and
  it differs run-to-run (this run = navy; the `adrian-local` sheet run = red). So the
  story commits *one* outfit per book, but there's **no customer-anchored ground
  truth**, and it's non-reproducible.
- **Mole prose is correct + specific:** *"a small mole sits on his left cheek, just
  below the outer corner of his eye."* The story does **not** cause the mole failure.
- **Age prose is correct:** *"eight years old … sturdy, stocky boyish build."* The
  story does **not** cause the page-8 aging.
- **Per-scene composition:** 9 of 12 scenes place **both subjects** together; several
  are **foreground-subject + background-watcher** (dad watches kid ride) — the exact
  multi-focal-distance composition the system prompt itself flags as breaking marker
  fidelity ([anthropic.js:730](../../src/anthropic.js#L730)).
- **Page 8 → `prompt-6-iter-1`** ("climactic, dramatic, peak-emotion, cinematic-scale,
  full-bleed"), both subjects. *(Inferred match to the Fly book's observed dramatic
  page-8 composition.)*
- **Helmet appears in only some scenes' prose** (≈ p1/6/9/12) — the pipeline has no
  concept of a **persistent prop** that, once introduced, recurs every relevant scene.

---

## 6. Render-level findings (B.7.4)

- **Per-page prompt** ([page-pipeline.js `buildScenePrompt`](../../src/page-pipeline.js#L283))
  closes with *"Use the provided reference images … to keep each one's appearance,
  clothing, and proportions consistent."* But it:
  - does **not restate the specific outfit** as a hard lock (relies on the reference
    image + whatever the masked `Appearance` block carries);
  - has **no asymmetric-feature / orientation directive** (nothing like "mole only on
    the left cheek; do not render it on the right");
  - concatenates **5 reference images** (Adrian 3 + Rob 2) for N=2 → **reference
    dilution** vs the single-subject case.
- **All templates share an identical watercolor `styleOverride`** (Sophie-Blackall
  wet-on-wet). So **page 8's style drift is not a template-style difference** — it's
  the model drifting *within* the same style prompt, **driven by composition**.
- **`prompt-6-iter-1`** (climactic/dramatic/cinematic-scale/full-bleed) + the
  **foreground-hero / background-watcher** layout pushes the model toward a more
  realistic, **older** subject — the dramatic-realism bias.

**Why Elena held and Adrian didn't (the load-bearing contrast):** Elena's *input
specified a rich, distinctive outfit* (denim overalls + white tee w/ butterfly patch +
yellow rain boots) and she is **single-subject (N=1)**. Her book renders that outfit
rock-solid (verified in the B.6 controlled regen). Adrian's outfit was **invented from
a sparse input** and rendered at **N=2**. Both knobs moved against him.

---

## 7. Issue → origin map (B.7.5)

Origins ranked by likelihood. **2/3/4 are a single root cause.**

| # | Issue | Primary origin | Compounding | Notes |
|---|---|---|---|---|
| 1 | Outfit drift (both chars) | **RENDER-LEVEL** — no per-page outfit lock; model reinvents per scene | **ARCHITECTURE** (N=2 reference dilution) + **INPUT** (sparse → invented, non-reproducible outfit) | NOT sheet-level (sheets agree), NOT story-level (story commits one outfit). Elena (rich input, N=1) proves the contrast. |
| 2 | Mole → wrong cheek | **MODEL-LEVEL** — asymmetric feature can't be placed per head-orientation | **SHEET-LEVEL** (all sheets left-favoring; no clean-right reference) | One root with 3/4. |
| 3 | Mole on both cheeks | **MODEL-LEVEL** — model encodes "has a cheek mole," renders on every visible cheek | SHEET-LEVEL | " |
| 4 | Mole on whichever cheek shown | **MODEL-LEVEL** | SHEET-LEVEL | " |
| 5 | Page-8 style + age drift | **RENDER-LEVEL** — dramatic template (`prompt-6-iter-1`) + foreground-hero/bg-watcher composition biases toward realistic/older | (composition class the system prompt already warns about) | Style is uniform across templates → this is model drift on dramatic composition, not a style swap. |
| 6 | Helmet inconsistency | **STORY-LEVEL** — helmet only in some scenes' prose; no persistent-prop concept | **RENDER-LEVEL** (props unanchored) | Same class as the bike-color drift. Also a child-safety optics issue (riding un-helmeted). |

**Not an origin:** model regression (ruled out in the 2026-06-08 controlled regen);
Fly environment (ruled out by local replication); the character sheets' outfit/age
(consistent); the story's mole/age prose (correct).

---

## 8. Fix-hypothesis menu (B.7.6) — options, NOT decisions

**INPUT-LEVEL (issue 1 root)**
- Capture **outfit explicitly** in the wizard (or require a richer appearance with
  clothing) → Elena-grade anchoring + reproducibility.
- (Track C structured builder — separate workstream.)

**RENDER-LEVEL — outfit (issue 1)**
- **Restate the exact outfit string in every page prompt** + a hard directive
  ("identical outfit on every page; do not change colors or garments").
- Mint and pass a single **canonical full-body wardrobe sheet** and emphasize it.
- Reduce N=2 reference dilution (see architecture).

**MODEL/SHEET-LEVEL — mole (issues 2/3/4, one fix)**
- Add a **right-side sheet view** so the model sees a clean right cheek (cheapest
  partial mitigation; +1 mint).
- Add an explicit render directive: "the mole is on the LEFT cheek only; the right
  cheek is clear."
- **Accept the residual** as a known generative limit (single small asymmetric marks
  may mirror) and/or de-emphasize sub-pixel markers in customer guidance.
- Multi-pass face correction (expensive).

**RENDER-LEVEL — page-8 (issue 5)**
- Add a **child-anchor reinforcement** to the dramatic templates' composition prompt
  ("a young child with storybook proportions; do not age the subject").
- Strengthen the existing anti-multi-focal-distance guidance, or **exclude the most
  dramatic template** from child-subject / multi-character books.

**STORY-LEVEL — props (issue 6)**
- **Persistent-prop tracking**: once a prop (helmet, bike) is established, instruct
  Sonnet to include it in every relevant scene's prose (mirrors the existing
  tier-1-entity "markers in every scene" rule).

**ARCHITECTURE-LEVEL (issue 1 + general multichar)**
- **Per-character rendering + composition** (render Adrian and Rob separately, compose)
  — removes N=2 reference dilution.
- **Photo conditioning** (Phase 3.A) — stronger anchor than invented text.
- **Structured input** (Track C).

---

## 9. Recommendation — highest leverage first

**Two levers cover five of the six issues with no architectural change:**

1. **Outfit anchoring (issue 1 — every page, both characters: the highest-frequency
   defect).** Combine **input capture** (specify the outfit) with a **per-page
   render outfit-lock** (restate + hard-constrain the exact garments). Elena is the
   existence proof that a specified, anchored outfit renders consistently. Biggest
   visible quality jump for the least structural change. **Best first fix cycle (B.8).**

2. **The mole cluster (issues 2/3/4 — one root).** Cheapest meaningful win: **add a
   right-side character-sheet view** (one extra mint) + a "left-cheek-only" render
   directive, then **accept the residual** as a documented model limit. Don't over-
   invest — this is fundamentally a generative-model asymmetry limit.

**Secondary, targeted:**
- **Page 8 (issue 5):** a small render-prompt tweak to the dramatic template (child-age
  reinforcement) — low effort, contained.
- **Helmet (issue 6):** a story-gen persistent-prop rule — low effort, also improves
  the safety optics.

**Do NOT** chase sheet-level outfit fixes (the sheets are already consistent) or
story-level mole/age fixes (the prose is already correct) — those aren't the origins.

**Suggested B.8 scope:** outfit anchoring (lever 1), single origin + single
intervention, measured against an Elena-style consistent baseline.
