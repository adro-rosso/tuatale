# Animated interactive character builder — $0 exploration (Option A)

_2026-06-15. No real art, no Gemini spend. Includes a throwaway tech spike (placeholder
shapes) that PROVED the core interaction in our stack. Frame: the animation tech is
industry-solved; the real risk is OUR constraints — solo non-dev team, strong at
Gemini image-gen, weak at vector-art authoring._

## TL;DR / recommendation
**GO**, bounded. Build the animated builder as an **incremental upgrade of the compositor we
already shipped** — not a new tech stack. Stay **raster (Gemini-generated flat-style layered
parts) + web animation (CSS transitions + idle keyframes, React state-driven)**. **Do NOT adopt
Rive or Lottie** — both move the bottleneck onto vector/After-Effects authoring, which is
exactly our skill gap. The spike (below) proves the swap-on-click + animated transition + idle
"alive" motion works in Next 16 / React 19 with **zero new dependencies**.

---

## 1. Art-production paths (vs our actual constraints)

| Path | How art is MADE | How it's MAINTAINED / extended | Within a solo-non-dev + AI team's reach? |
|---|---|---|---|
| **(a) True vector** (Rive/SVG in an editor) | Hand-authored in Rive/Illustrator/Figma — drawing + rigging vector shapes | New part = author + rig a new vector asset in the editor | **No (honest).** Cleanest/tiniest/most animatable output, but it's a **vector-art authoring** discipline we don't have. Would require hiring/commissioning or months of skill-building. The tech isn't the blocker — the art-making is. |
| **(b) Gemini flat-raster layered parts + web animation** ⭐ | Generate each part with Gemini in a **flat style**, segment/extract to transparent layers (our existing mediapipe / diff-mask / matte pipeline) | New part = gen it + extract + add a manifest entry — **the additive pattern we already run** | **Yes.** Uses our proven strength. **Flat art cuts cleaner than watercolour** — hard, even edges → the paper-fringe/seam saga largely disappears. Raster tradeoffs: bigger files than vector (mitigated — our 272-layer watercolour set is 5.8 MB as WebP), not infinitely crisp on zoom (fine at preview size), can't deform/rig like vector (we don't need lip-sync; swap + transform is enough). |
| **(c) Hybrid** (Gemini-gen → auto-vectorize, e.g. potrace) | Gen flat parts, trace to SVG paths | New part = gen + trace + cleanup | **Maybe later, not now.** Buys crispness + tiny files + true vector animation, but the trace step adds fragility/cleanup and we'd still hand-fix paths. Reach for it only if (b)'s raster crispness ever bites. |

**Recommend (b).** It's the only path whose art-production step we've *already executed at scale*
(the watercolour builder). The flat style is a **net simplification** of the seam problem, not a
new risk. We keep our generate-then-extract muscle and avoid the vector-authoring wall.

A note on style: flat parts would be a **new art style** (the picker/manifest is already
style-keyed — `ACTIVE_STYLE`). So this is additive: the watercolour set stays; a `flat` set is a
parallel style folder. Whether the product ships flat, watercolour, or both is a separate call.

## 2. Animation tech in our stack (Next 16 / React 19, client-side)

| Option | Installs/runs clean? | Drives swappable parts from React state? | "Alive" feel | Size / maintainability | Verdict |
|---|---|---|---|---|---|
| **Layered DOM/SVG + CSS** (transitions + `@keyframes`) | **Yes — zero deps** (proven in the spike) | Trivially — it's just React state → re-render | Swap cross-fade/pop, idle bob, blink — all done in the spike | **0 KB added.** Maximally maintainable (plain React + CSS) | **Use now.** |
| **+ Framer Motion** (`motion`, ~30–50 KB) | Yes (React 19 compatible) | Yes | Adds spring physics, gesture drag, layout animations — nicer polish | One dep, well-maintained | **Add only if** a specific interaction needs springs/gestures. Don't add preemptively. |
| **Rive** (`@rive-app/react-canvas`) | Yes, runtime runs fine | Yes (state machines → inputs) | Best-in-class (true rigs) | Small `.riv` files | **No** — requires authoring `.riv` in the Rive editor (vector skill gap). Tech ≠ blocker; art is. |
| **Lottie** (`lottie-react`) | Yes | Limited — Lottie is for pre-baked animations, not a large swappable part library driven by arbitrary selections | Good for scripted motion | JSON can get heavy | **No** — needs After Effects authoring; wrong shape for a combinatorial part library. |

**Recommend:** layered DOM/SVG + CSS now; `motion` later if needed. Both Rive and Lottie are
rejected on the **authoring-skill** axis, not the runtime axis.

## 3. Tech spike — RESULT: PASSED (zero new deps)

Throwaway route `website/app/spike/page.tsx` (placeholder geometric shapes). Captures in
`output/_coherence-probe/_spike/`. Proven in Next 16 / React 19, **no dependencies added**:
- **Swappable z-ordered parts** — head / eyes / mouth / hair as separate layers (the exact slot a
  raster `<img>` layer would occupy in production).
- **Click a part → in-place picker popover** anchored at the part (`02_hair_popover.png`).
- **Selection changes the part, state-driven** — same `selections` state pattern as the real
  compositor (`03b_long_green_settled.png`: long hair + green eyes).
- **Animated swap** — `pop` keyframe (scale+fade) on change, not a hard cut.
- **Idle "alive" motion** — gentle `bob` on the whole face + periodic `blink` (CSS keyframes).
  (Aside: Playwright couldn't auto-click because the element was *never stable* — the bob is
  genuinely, continuously moving. Good sign.)
- Desktop + mobile both render (`05_mobile.png`).

De-risks the mechanism **before any art investment**: the interaction model is sound and cheap.

> Note on blink with RASTER parts: needs either an eyes-closed frame per character (one extra
> gen) or an overlaid eyelid shape. Idle bob is free (transform the whole layer stack). Per-part
> motion (e.g. hair sway) = a CSS transform on that one layer — doable, not free.

## 4. UX of the interactive "window" (replaces the long scrolly form)

```
DESKTOP                                   MOBILE
┌───────────────────────────┐            ┌───────────────────┐
│  ✎ Build your character    │            │ ✎ Build character │
│ ┌───────────┐  ┌────────┐  │            │ ┌───────────────┐ │
│ │           │  │ chips: │  │            │ │   character    │ │  ← sticky
│ │  CHARACTER│  │ Hair ▸ │  │            │ │   (tap a part) │ │
│ │  (tap a   │  │ Eyes ▸ │  │            │ └───────────────┘ │
│ │   part)   │  │ Skin ▸ │  │            │  Hair Eyes Skin … │  ← chip row
│ │           │  │ …TBD   │  │            │ ┌───────────────┐ │
│ └───────────┘  └────────┘  │            │ │ picker drawer  │ │  ← slides up
│  ↑ click part = open its   │            │ │ (swatches)     │ │
│    picker in-place         │            │ └───────────────┘ │
└───────────────────────────┘            └───────────────────┘
```
- **Primary interaction:** click/tap a part *on the character* → its picker opens **in place**
  (popover on desktop, bottom drawer on mobile) → choose → character updates live with a
  transition. No scrolling through a form.
- **Secondary affordance:** a compact **chip/tab row** lists every editable axis (Hair, Eyes,
  Skin…) for discoverability + a11y (not every axis is obvious to click, and the chips are the
  keyboard/screen-reader path). Selecting a chip highlights+opens that part.
- **Extensible by design — clean TBD slots.** The chip row + manifest are data-driven: a new
  design choice (outfit, background, accessory, name, story-theme…) is **one more chip + (if
  visual) one more layer**. Reserve the chip row for *all* the choices the wizard collects, not
  just visual ones — non-visual choices (age range, theme) become chips that open a normal
  control, so the whole "About your child" step can collapse into this one window over time.
- Reuses what we have: the data-driven layer stack (`lib/builder/resolve.ts`), the paper-card
  framing, the gender-gated option lists.

## 5. "Generate the real me" (photo/text likeness) alongside the instant builder

The proven photo/text→watercolour likeness engine ([[project_photo-likeness-probe]]) is a
**different promise** from the instant builder, so keep them as **two clearly-labelled modes**, not
a blended control:
- **Instant builder (default):** "Build a character" — free, instant, preset parts. The window above.
- **Generate the real me (opt-in step):** "Make it look like *them*" — upload a photo or describe
  in words → a few seconds, a few cents (Gemini) → a likeness portrait. Surfaced as a distinct CTA
  *inside the same window* ("✨ Generate from a photo instead"), which **replaces the composited
  preview with the generated likeness** in the same paper card — so the user sees one character
  surface, two ways to fill it.
- **No confusion rule:** never mix a half-built preset with a half-applied photo silently. Switching
  modes swaps the whole preview and says which mode is active. The builder's structured selections
  still flow to the **text generation path** (unchanged); the photo path carries the likeness. They
  inform generation separately — we already decided the composite itself does **not** drive
  generation (preview-only), so there's no contradiction.
- Privacy: the photo path keeps its **banked child-photo privacy/safety gate** before real ship;
  the instant builder has none (synthetic), so it can ship first.

## 6. Staging, honest effort, GO/NO-GO

**We are ~70% there already.** The hard, de-risked parts are done: data-driven layer stack,
extraction pipeline, recolour, paper-card framing, the live compositor wired into the wizard. This
exploration's spike de-risks the *remaining* novel bits (click-in-place + motion).

| Stage | What | Effort (this team) | Gen spend |
|---|---|---|---|
| **S0 — interaction shell** | Swap the scrolly pickers for the click-the-part + chip-row window; CSS swap transition + idle bob/blink; reuse current watercolour assets | Small (UI; spike already proves it) | **$0** |
| **S1 — flat style set (optional)** | Generate a flat-style part library (cleaner edges) as a parallel `ACTIVE_STYLE`; same extraction pipeline | Medium (gen + extract sweep, like the thumbnail/builder sweeps) | ~$1–6 (style × parts, recolour reused) |
| **S2 — extensible choices** | Fold non-visual wizard choices into the chip row (collapse the step); add slots for future design choices | Small–medium | $0 |
| **S3 — "generate the real me"** | Wire the photo/text likeness mode into the window as a second fill-mode | Medium + the **banked privacy gate** for the photo path | cents/char at runtime |

**GO / NO-GO: GO**, with guardrails:
- **Buildable by this team?** Yes — it's the *same architecture we already shipped*, plus a UI
  reshape and CSS motion the spike just proved. No new framework, no vector authoring.
- **Maintainable by this team?** Yes — adding a part/choice stays the additive manifest pattern.
  The only ongoing cost is generating + extracting new parts, which is our core competency.
- **The honest caveat:** raster + CSS gives a "Mii-style swap + gentle idle" alive-ness, **not** a
  fully-rigged character (no squash/stretch, no lip-sync). If the vision later demands that level of
  motion, that's the Rive/vector path — and a different (hire-or-commission) conversation. For the
  preview's job ("looks alive and fun while you build"), raster + CSS clears the bar.
- **Don't:** adopt Rive/Lottie now (skill gap), or block S0 on the flat-style gen (S0 works with
  today's watercolour assets).

**Recommended first move:** S0 only — reshape the existing builder into the click-in-place animated
window using current assets. Bounded, $0, reversible. Decide flat-style (S1) after seeing S0 feel.

---

## Decisions update (2026-06-15) — animation DROPPED; STATIC interactive builder

After S0, the live CSS idle-motion (bob/sway + the placeholder eyelid-overlay blink) on cut-out
**watercolour** layers **looked bad** — CSS-nudging painted cut-outs fights the medium (the same
wall as the edge seams), so it won't read as premium. **Decision: drop live animation entirely.**

- **The builder is an interactive but STATIC click-in-place window.** Click a part → in-place
  picker → **instant static update**. Kept: part hotspots, chip row, popover/drawer, paper card,
  `resolve.ts`. Removed: bob/sway + eyelid blink (the `CharacterBuilder` is now cleanly static).
- **S1 art is SIMPLER now.** No blink ⇒ S1 flat art **no longer needs eyeless faces or open/closed
  eye frames** — just plain static layered parts. (Supersedes the "animation-ready parts" rule.)

### "Generate the real me" (photo/text mode) — REQUIREMENT for when it's wired (not now)
The likeness generation takes **~10–15s+** (longer during API-latency incidents). When this stubbed
mode is wired, it **must** show a **progress bar / engagement UI** during the wait (staged status
copy, a playful loader) so the wait reads as "painting your character," not a hang. Design the slot
for it now; build with the mode.

### "Bring it to life" — FUTURE, SEPARATE, PAID flourish (not part of this builder)
The "alive" feeling is re-homed as an **optional, paid, post-build flourish**: an **AI image→video**
clip (Runway / Kling / Luma / Pika) of the **final character only** — one render, bounded cost,
slow/paid, and it can warp stylised art convincingly. Judged on its own merits, later.
- It **cannot BE** the live builder: image→video makes fixed clips, not interactive per-selection
  updates — the combinatorial/cost wall rules it out as the builder's motion. It's a finishing touch
  on the chosen character, nothing more.
