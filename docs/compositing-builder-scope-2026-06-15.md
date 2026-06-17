# Live layer-compositing character builder — scope

_2026-06-15. Follows the coherence probe (PASSED): mediapipe hair segmentation viable on
watercolour, registration free (±1-2px), glasses diff-mask clean, composites read as one
painting. Key finding: **overlay can add hair but never shorten the base's own hair → bald
bases required.**_

## What the system is
A base canvas + swappable watercolour feature layers, composited **in the browser** — instant,
free, no per-preview Gemini call. The parent picks hair / colour / glasses / eyes and sees the
character assemble live. Three parts: an **asset library** (generate-once), a **layer-extraction
pipeline** (build-time), and a **browser compositor** (runtime).

## A. Asset library (the dominant cost — generate-once)
A matrix:
- **Bald base canvases** — gender × heritage. The base carries the bald head, face, skin tone,
  neck/shoulders, body/build, clothes. v1 single heritage = 2 bald bases (re-gen boy + girl
  bald; the current bases have hair). Skin tone is baked into the base (can't be overlaid);
  **heritage multiplies this dimension** and is its own sensitive cycle (see the heritage
  workstream in the structured-inputs contract).
- **Hair layers** — colour × style. Full matrix = 8 colours × (boy 6 + girl 12 styles) = **144
  gens per heritage**. Mitigation to probe: generate each style once in a neutral brown and
  **recolour in-browser** (HSV/hue shift) → drops to ~18 gens. Recolour on watercolour is
  UNPROVEN (black→blonde changes luminance, not just hue) — needs a mini-probe before we commit.
- **Glasses layer** — 1-2. Cheap, diff-mask extraction proven. Registration-shared, so one layer
  works across same-gender bases.
- **Eye-colour overlay** — 6 tints at the registered iris positions (YuNet gives eye centres).
  Likely an in-browser tint overlay, not 6 gens.

## B. Layer-extraction pipeline (build-time tooling — proven)
Batch: generate variant → segment (mediapipe hair / diff-mask glasses / YuNet eye positions) →
feather alpha → save registered transparent PNG. All tooling validated in the probe. One-time
per asset, like the thumbnail sweep.

## C. Browser compositor (the new runtime build)
Stack registered PNGs by z-order: **base (bald head+face+body) → eye-colour overlay → hair
(on top, face cavity transparent) → glasses**. Canvas or layered elements; instant, client-side.

**Key product decision — what is the composite FOR?**
1. **Preview-only** — eye-candy in the wizard; the book is still generated from the text
   features by the existing pipeline. Lower stakes, but the preview must roughly MATCH the
   gen'd book or it over-promises.
2. **Composite-as-reference** — the assembled character image is passed to the pipeline as a
   likeness reference (like the photo path), so the preview literally IS the character. Higher
   value, needs production-quality composites + pipeline plumbing.

## D. Risks / unknowns
1. **Hair recolour** on watercolour (to avoid the 144-gen matrix) — mini-probe needed.
2. **Front/back hair layering** — bangs/very-long styles that fall in front of the face; the
   probe used a single layer (worked for the long case). A known cosmetic risk, not a v1 blocker.
3. **Heritage matrix** — multiplies bases; the sensitive workstream, not bald-base-trivial.
4. **Preview-vs-book fidelity** — decision C above.
5. **Bald base quality** — a watercolour bald kid head must read naturally; re-gen + judge.

## Honest size
Multi-cycle, not one sprint. Rough shape:
- **Cycle 1** — 2 bald bases + recolour mini-probe (decides colour strategy) + extract hair/
  glasses/eye layers for ONE heritage + build the browser compositor + wire the wizard preview.
  Gen cost ≈ $1 (recolour path) or ≈ $6 (full colour×style), one heritage.
- **Cycle 2** — heritage expansion (its own deliberate, representation-reviewed cycle).
- **Cycle 3** — composite-as-reference into the pipeline, if chosen (decision C).

## Decisions needed before Cycle 1
- **D1. Composite purpose:** preview-only vs composite-as-reference (changes the quality bar).
- **D2. Colour strategy:** recolour-in-browser (probe first, ~$1) vs full colour×style matrix (~$6).
- **D3. Cycle-1 heritage:** confirm v1 = the current single heritage, heritage expansion deferred.
