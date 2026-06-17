# Live compositing character builder — Cycle 1 design

_2026-06-15. $0 design doc. No build, no gens, no spend yet — Adro approves the plan;
each gen-spend stage stays separately gated. Follows the coherence + recolour probes
(both PASSED): mediapipe hair segmentation viable on watercolour, registration free
(±1-2px), glasses diff-mask clean, LAB recolour viable across all 8 colours, composites
read as one painting. Hard finding driving this design: **overlay can add hair but never
shorten the base's own hair → bald bases required.**_

## Cycle 1 scope (bounded)
- **Single heritage** — the existing Caucasian base. Heritage expansion = separate banked
  workstream; we do NOT multiply by heritage here.
- **Single art style** — `watercolor`.
- **Layers in scope:** hair (style real-gen'd, colour via proven recolour), glasses,
  eye-colour overlay.
- **skin_tone:** **HELD (label-only) for Cycle 1.** Within a single Caucasian base, varying
  skin tone is the "Caucasian face with darker pigment" problem (fails on quality AND
  representation — see the heritage note in the structured-inputs contract). Real skin
  variation belongs to the heritage workstream, where base *features* change authentically.
  So Cycle 1 = one skin tone per gender. (Architecturally skin is a **base-changing**
  attribute, not an overlay — see §1.)
- **build:** stays a simple non-visual select; passed to the pipeline as text only, not
  visualized in the compositor v1. (Also a base-changing attribute — body shape — deferred.)

---

## 1. The generic, data-driven layer stack (extensibility core)

The compositor and asset model are a **generic ordered layer stack**, NOT hardcoded
per-attribute slots. Everything is described by a **manifest** the compositor reads at
runtime. Adding a new visual attribute later (hat, freckles, accessory, mole) =
**append a layer definition + drop its assets + add a wizard control** → zero compositor
rework.

A **layer definition** (manifest entry):
```jsonc
{
  "id": "hair-front",
  "z": 40,                       // stack order (paint low→high)
  "driver": "hair_style",        // which wizard field selects the asset
  "recolour": "hair_colour",     // optional: field whose value picks a colour swatch
  "assets": "hair/{gender}/{hair_style}-front-{hair_colour}.png",  // resolved per selection
  "kind": "overlay"              // "overlay" | "base"
}
```
The compositor: read manifest → for each layer (sorted by `z`), resolve its asset from the
current selections + gender → paint with its alpha. Done. No attribute-specific code.

### Two attribute classes (state how each future-extends)
- **Overlay-type attributes — cheap, additive.** hair, glasses, eye-colour, and any future
  hat/freckles/accessory/mole. Each is one (or a few) layer def(s) + a transparent asset
  set. Adding one is purely additive — the library grows by that attribute's asset count,
  **nothing multiplies**. This is the default path for new features.
- **Base-changing attributes — multiply the library.** skin_tone, heritage, build. These
  alter the BASE canvas itself (pigment, facial structure, body shape) → require **new base
  gens**, and every overlay layer must be re-validated/registered against each new base. The
  library multiplies by their cardinality. This is the **heritage workstream's** cost and is
  deliberately out of Cycle 1. The manifest models a base as `base/{gender}/{heritage}/{build}.png`
  so the base dimension can grow later without touching the overlay layers.

---

## 2. Bald bases (the coherence-probe finding)

**Why:** overlay can't remove the base's own hair; any style smaller than the base hair
lets it peek (proved in the stress test). So the base must be **bald / minimal-hair**, and
hair is always supplied as a layer.

- **Count: 2** — boy, girl (non_binary uses the girl set, per existing convention).
- **How:** ref the *existing* base + "remove the hair — show a clean bald/shaved head;
  keep the face, expression, framing, body, and EVERYTHING else identical." Ref'ing the
  existing base preserves registration (±1-2px), so the **already-extracted hair layers land
  correctly** on the bald base.
- **Transparent figure:** the bald base is bg-removed (cream background → threshold/grabcut,
  or mediapipe body classes) so **hair-back** can paint *behind* the figure (§3).
- **Risk:** a watercolour bald child head must read naturally (not odd/medical). Gen + **Adro
  judges**; budget a couple retries. ~2–4 gens (~$0.08–0.16).

---

## 3. Hair front/back z-order

Long hair sits **behind and in front** of the figure. With a bald, bg-removed base the split
is clean:
- **hair-back** = hair pixels OUTSIDE the figure silhouette (sides, falling past shoulders) →
  painted **under** the base so they show in the background region.
- **hair-front** = hair pixels OVER the head/face/body (crown, bangs, strands over shoulders)
  → painted **on top** of the base.

Split is computed **at extraction**: `front = hairMask ∩ figureSilhouette`,
`back = hairMask − figureSilhouette`. Short styles → `back` is empty (single front layer).

**Default z-order (data-driven, from the manifest):**
```
10 hair-back  →  20 base (bald head+face+body)  →  30 eye-overlay  →  40 hair-front  →  50 glasses
```
(eye-overlay sits on the base face but UNDER hair-front, so bangs can fall over the eyes;
glasses on top of everything.)

---

## 4. Layer-extraction pipeline

Per asset: **gen → segment → feather alpha → register → store transparent PNG**.
- hair → mediapipe SelfieMulticlass (hair class), split front/back, gaussian-feathered alpha.
- glasses → diff-mask (base vs base+glasses), feathered.
- eye-overlay → YuNet eye centres → a small iris-tint layer per eye-colour (tint, not a gen).
- base figure → cream-bg removal → transparent.
- recolour → LAB transfer (proven), **pre-baked** per colour at extraction (deterministic,
  $0) so the runtime compositor just swaps `src` — no runtime colour math. (Alt: runtime
  recolour to cut file count; pre-bake chosen for a simpler, faster compositor.)

**Storage — `public/builder/<style>/...` (mirrors the thumbnail convention):**
```
public/builder/watercolor/
  manifest.json
  base/{gender}.png                                  # bald, transparent
  hair/{gender}/{style}-back-{colour}.png            # omitted when back is empty
  hair/{gender}/{style}-front-{colour}.png
  glasses/{gender}.png
  eye/{gender}/{colour}.png                          # iris tint overlay
```

**Gen count + cost for the FULL Cycle-1 library:**
- **Hair styles — $0 new gens.** The style raws **already exist** from the thumbnail sweep
  (`output/_photo-thumbs/.../hair_style/<gender>/`, plus the default style = the base image
  itself). Layers are *extracted* from those; the 8 colours are *recoloured* locally. boy 6 +
  girl 12 = 18 styles × 8 colours = 144 small PNGs, **all $0** (extraction + recolour).
- **Bald bases — ~$0.08–0.16** (2–4 gens incl. retries).
- **Glasses — ~$0.04** (girl glasses already gen'd in the probe; +1 boy gen).
- **Eye overlays — $0** (runtime/extraction tint, no gens).
- **Full library total ≈ $0.20 in new Gemini spend.** Cheap because the hair-style raws are
  already in hand.

---

## 5. Browser compositor

- A **client React component** that reads `manifest.json`, takes the wizard selections +
  gender, resolves the ordered layer list, and paints stacked transparent PNGs (absolutely-
  positioned `<img>`/`<canvas>`), reactive + instant + free at runtime.
- Replaces/augments the current `ImagePicker` preview: the user picks hair/colour/glasses/
  eyes and sees the **assembled character** update live.
- Produces the reference image via `canvas.toBlob()` → the composite PNG (for §6).
- Fully data-driven: a new attribute appears in the build by editing the manifest + adding
  assets + a wizard control — no compositor changes.

---

## 6. Composite-as-reference — DROPPED (Adro, 2026-06-15 Stage-B review)

**The builder is a CUSTOMER-FACING PREVIEW ONLY. The composite does NOT feed generation.**
Reasoning: the free-text appearance note changes what the character should be, so a
structured-only composite can't be a faithful generation anchor (feeding it as view-0 would
fight or drop the text details). The book keeps generating from the **text path**
(`composeAppearance` = structured features + free text, the proven `FEATURES_COMPOSE` flow).
The pickers already populate `child_features`, so **there is no pipeline wiring to do** — the
preview is a pure visual layer over the existing data flow. Confirmed (grep) nothing in
`src/` or the website actions consumes the composite.

`CharacterCanvas.toBlob()` is retained (cheap) in case we later want to store the preview
image per order as a record — but it is NOT wired to anything and does NOT inform generation.
(Could be revisited only if composite + text ever *jointly* form a reference — not now.)

---

## 7. Staged, separately-gated increments

| Stage | What | New gen spend | Adro judges |
|-------|------|---------------|-------------|
| **A — POC** | 2 bald bases; extract ~3 hair styles (incl. one long, for front/back) + recolour to 2–3 colours; minimal manifest-driven compositor that composites base + hair(+colour) live | **~$0.08–0.16** (bald bases only) | A real composited build: do bald bases read naturally? front/back on the long style? recolour in context? coherence on the bald base? |
| **B — Full library + wizard** | Extract ALL styles (boy+girl) front/back, pre-bake all colours, boy glasses gen, eye overlays, full manifest; wire the live compositor into the wizard; tests; local review | **~$0.04** (boy glasses) | The full wizard preview, local |
| ~~C — Pipeline wiring~~ | **CANCELLED** (composite-as-reference dropped — §6) | — | — |

Each stage is reviewed before the next. Stages A + B shipped (local); **Stage C cancelled**.

### Banked future base-work (NOT overlays)
`build` (slight/average/sturdy) and `skin_tone`/heritage are **base-changing** attributes:
they alter the body/face itself, so reflecting them in the preview needs new **base canvases**
(e.g. full-body bases per build), not overlay layers. They stay non-visual selects for now;
showing them in-preview is future base-work, tied to the heritage workstream.

### Total Cycle-1 spend
- Asset library (Stages A+B): **~$0.20** in new gens (hair = $0, reusing sweep raws).
- ~~Validation books (Stage C)~~ — cancelled.
- Everything else (extraction, recolour, compositor, wiring) = engineering, **$0 gens**.

---

## 8. Edge fringe — assets MUST be shown on the paper colour (Stage-B fix)

The cut-out watercolour layers carry a **~3–5px fringe of the original paper colour**
(≈`#fdfbef`, RGB 253,251,239) at every silhouette edge — watercolour edges are a soft
paint-into-paper blend, so a near-binary alpha can't avoid including paper-blended pixels.
Diagnosed at pixel level (alpha ramp: ~4px of light paper pixels before the real painted
edge; visible as a white ring when composited on magenta).

Consequence: on a background that ISN'T the paper colour, that fringe reads as a **seam ring**
around the whole figure. The app page cream (`--color-cream` #fbf3ee, RGB 251,243,238) is
pinker/darker than the paper, so the figure showed a light halo. Proof: the same composite on
the matched paper colour is seamless (no asset change needed) — so this is a display/matte
issue, NOT a fundamental compositing wall.

**Rule:** these assets MUST be displayed on the paper colour `#fdfbef` (or be edge-
decontaminated first). The builder preview is therefore framed as a deliberate **paper card**
(`CharacterCanvas`: paper-colour background + warm border + soft shadow) so the lighter-than-
page background reads as intentional. **If these assets are ever rendered elsewhere** (a
different surface, a stored preview baked onto another bg, an email), either put them on
`#fdfbef` or run an alpha-decontamination pass first — otherwise the seam returns.
