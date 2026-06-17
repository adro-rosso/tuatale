# Whole-character preview generation — $0 design (retire the cut-out builder)

_2026-06-16. No build, no gen. Direction (Adro): drop the cut-out/composite builder. The
preview becomes WHOLE-CHARACTER GENERATION — selections (and/or a photo) → "Generate my
character" → progress bar → one seamless Gemini-painted character, from the SAME inputs that
feed the book. Reuses the proven engines (photo-likeness + structured `composeAppearance`); no
extraction/compositing._

## 1. Reuse audit — a preview is a bounded slice of the existing pipeline

A single character preview = **one sheet-mint**, nothing else. Reuse map:

| Piece | Where | Reuse? |
|---|---|---|
| `composeAppearance(features, freeText)` | `src/character-features.js` | **As-is.** structured axes + free text → the appearance "spine" (the exact string the book uses). |
| `buildSubjectSheetBasePrompt(subject, story)` | `src/book-pipeline.js` (private) | **Reuse** — needs `export` (or a ~20-line copy in the wrapper). Builds `Subject/Appearance/Style/Composition/Avoid`. |
| `generateImage(prompt, refs, opts, ctx)` | `src/gemini.js` | **As-is.** ONE call. Wall-ceiling/retry already built in. |
| Photo view-0 path (`refs=[photoBuf]` + `PHOTO_COND`) | `scripts/_photo-probe.mjs` pattern | **Reuse** the conditioning line + ref insertion (proven). |
| Front view prompt | `CHARACTER_SHEET_PROMPTS[0]` (exported) | **Reuse** (or a custom "friendly front-facing full body" preview view). |
| `formatMarkers`, style constants | `src/` | reuse if marks ever return (wizard dropped them → pass `[]`). |

**NOT needed for a preview** (this is the bounded slice): the multi-view sheet loop, `chainedSheetRefs`
(single view), marker-fingerprint reuse, page rendering, PDF assembly, Inngest book orchestration.

**Thin wrapper to write (~30 lines), `generateCharacterPreview(inputs)`:**
```
inputs = { features, freeText, photoBuf?, age, gender }
appearance = composeAppearance(features, freeText)           // reuse
subject = { age, isProtagonist:true, character_description: appearance, markers: [] }
story   = PREVIEW_STORY                                       // FIXED style const (the canonical
                                                              //   watercolour style/composition/negative)
base    = buildSubjectSheetBasePrompt(subject, story)         // reuse
prompt  = `${base}\n\nView: front-facing, friendly, full character.` + (photoBuf ? PHOTO_COND : "")
return generateImage(prompt, photoBuf ? [photoBuf] : [], {}, { callKind:"preview_mint" })
```

**"What you see ≈ what you get":** the preview uses the **same `composeAppearance` + style + photo-
anchor** as the book's character sheet (view 0). So the preview's identity ≈ the book's character.
Honest caveat to set in copy: the preview is a **character portrait**; the book places that same
character into story scenes — identity matches, scene context differs. (Use a FIXED `PREVIEW_STORY`
style so previews are consistent run-to-run; the book's per-book Sonnet style only adds scene flavour,
not identity.)

## 2. Serving architecture — where the one mint runs

**Constraint:** `GEMINI_API_KEY` + `src/` gen code live on the **Fly worker**, not Vercel. The worker
is **Inngest-Connect** (outbound; only `/health` is public). So the gen must run worker-side.

**Recommended: a new Inngest preview function on the existing worker.**
- New event `preview/requested` (mirrors `pipeline/job.requested`); new `runPreview` Inngest function
  on the worker calls `generateCharacterPreview`, uploads the PNG to a Supabase `previews` bucket,
  writes the URL + status to a `preview_jobs` row (or `preview_events`).
- Website **server action**: hash inputs → cache hit? return stored URL. Else create the row + send
  the event + **poll** the row (1–2s) until `done|failed` → show the image. Progress bar runs during
  the poll. ~10–15s.
- **Reuses everything:** Inngest-Connect plumbing, the worker's Gemini access, Supabase storage, the
  job-status-poll pattern we already run for books. **Zero new public surface, key stays put.**

**Alternatives (noted, not recommended):**
- *Public `POST /preview` on the worker http server* — synchronous/faster (no poll), but adds a new
  authenticated public endpoint + CORS to a worker that today exposes only `/health`. Reach for it
  only if the Inngest+poll latency feels sluggish.
- *Vercel runs the mint directly* — **rejected**: duplicates the key + gen code into Vercel and hits
  serverless duration limits (a 12–15s mint + retries vs Vercel's function ceiling). Don't split the
  key across two surfaces.

## 3. Progress UX (Gemini gives no true %)

- **Time-estimate bar:** animate 0 → ~90% over the expected ~12s (ease-out), **hold at ~90%**, snap to
  100% on completion. Never let it stall at 100% before the image is ready.
- **Staged messaging** (rotates on a timer, reads as craft): "Mixing the paints…" → "Sketching their
  face…" → "Adding colour…" → "Almost ready…".
- **Graceful long-run (the API-incident reality):** after ~20s switch copy to "Taking a little longer
  than usual — hang tight ✨". Hard **preview timeout ~60–90s** (shorter than the book's 300s
  wall-ceiling) → friendly "That one got stuck — try again" with a re-roll, **no user charge** (it's
  COGS). Reuse the fatal-stop / wall-ceiling / `onSlowCall` thinking already in `generateImage`
  ([[project_stage1a-shipped]]).
- The `preview_jobs` row carries `queued|running|done|failed` for the poll to drive all of the above.

## 4. Cost control (funnel COGS — must be bounded)

Previews are ~$0.04 + a wait, and users re-roll. Levers:
1. **Button-triggered, not live** (the big one): gen fires only on an explicit "Generate my character"
   press — never on each chip change. A user sets all features, then generates once.
2. **Cache by input hash:** key = hash(`composeAppearance` output + photo content-hash + style). Same
   inputs → return the stored image, **no regen, no spend**. Re-opening the draft or re-selecting the
   same combo is free. Store in the `previews` bucket + a cache index (reuse `preview_events`).
3. **Bounded free previews per draft/session:** N **distinct-input** generations (start ~3–5), counted
   in `preview_events`. Cache hits don't count; only genuinely new combos spend. After N → gate
   ("You've used your free previews — sign in / purchase to keep refining") .
4. Net COGS ≈ $0.04 × (distinct combos, capped at N) per draft — bounded and observable.

## 5. UI — keep the selection window, swap the canvas for the generated result

- **KEEP** (Adro liked it): the interactive window — chips, in-place picker (popover/drawer), part
  hotspots, paper card. The chips still set the features.
- **REPLACE** the live-composite `CharacterCanvas` with a **`GeneratedPreview`** area: shows the last
  generated image, or a placeholder ("Pick their features, then ✨ Generate") + the **"✨ Generate my
  character"** button + the **progress bar** during gen + a **re-roll** after.
- **Photo mode folds in as an input:** "✨ Generate from a photo" → upload → the photo becomes an input
  to the SAME gen (the photo view-0 path). "Generate" uses features AND/OR photo. One result surface,
  two ways to fill it (the §5/§6 of the earlier exploration, now unified under one Generate button).
- Hotspots/chips still open pickers and edit features; the image updates **only on Generate** (cost
  control #1). Honest "≈ the book" microcopy near the result.

## 6. Teardown — what retires vs stays (reversible via git)

**RETIRE (the cut-out/composite path):**
- `website/public/builder/watercolor/` (272 layer assets) + any flat library.
- `website/lib/builder/resolve.ts` (layer resolver) + `app/start/child/CharacterCanvas.tsx`.
- `scripts/_cv/build_library.py` + the extraction scripts (mediapipe/diff/matte) + `manifest.json`.
- Builder tests: `tests/lib/builder-resolve.test.ts`, `tests/app/start/character-canvas.test.tsx`,
  `tests/app/start/builder-library.test.ts`.

**KEEP:**
- `CharacterBuilder.tsx` shell (window, chips, in-place picker, hotspots) — repointed at `GeneratedPreview`.
- The feature schema + `composeAppearance` contract (it now feeds the gen instead of the compositor).
- `ImagePicker` thumbnails + `public/feature-thumbs/*` (the option swatches shown inside the pickers).
- Hidden-inputs → server-action wiring (the selections still flow to the order, unchanged).

Reversible via git (the cut-out builder is fully on record). Do the removal in S-F, after the new
path is live, as a clean deletion.

## 7. Staging (each spend gated)

| Stage | What | Spend |
|---|---|---|
| **S-A** | This design pass | **$0** (done) |
| **S-B** | **Preview-gen PROOF** — write `generateCharacterPreview`; run a few previews from (a) structured-only, (b) structured+free-text, (c) photo. Judge look + "≈ the book" + latency. *Validate before any serving/UI.* | **~$0.04 × 3–5** (gated) |
| **S-C** | Serving — `preview/requested` Inngest fn + `runPreview` on the worker + Supabase `previews` bucket + cache + website server action + poll | small gen (test mints) |
| **S-D** | UI — `GeneratedPreview` + Generate button + progress bar + photo upload; repoint `CharacterBuilder` | test mints |
| **S-E** | Cost control — input-hash cache + rate-limit + bounded free count (`preview_events`) | $0 |
| **S-F** | Teardown — remove the cut-out builder (assets/code/tests) | $0 |

**Next after approval:** S-B only — the preview-gen proof (~$0.04 × a few), to confirm a single mint
from the real inputs looks good and matches the book before building any serving/UI. Pause for Adro.

---

## S-C built (2026-06-16) — serving layer (no UI, no teardown; nothing applied to prod)

Built, unit-tested, NOT deployed (migration not applied; UI is S-D).

**Flow:** website `requestPreview(inputs)` → input-hash cache lookup → **hit:** return stored
URL (no spend) · **miss:** insert `preview_jobs` row (`queued`) + `inngest.send('preview/requested')`
→ Fly worker `runPreviewJob` → `generateCharacterPreview` (one mint) → upload to `tuatale-previews`
bucket → mark row `done`/`failed`. Website `getPreviewStatus(previewId)` polls the row.

**Files:**
- `src/character-preview.js` — shared `generateCharacterPreview` + fixed `PREVIEW_STORY` (+ exported `buildSubjectSheetBasePrompt` from `book-pipeline.js`).
- `worker/src/preview.js` — `runPreview` (mint→upload→mark, deps-injectable) + `tuatale-previews` storage + `preview_jobs` row helpers.
- `worker/src/server.js` — `runPreviewJob` Inngest fn (`preview/requested`, retries 1, concurrency 3) registered in `connect({ functions: [runPipelineJob, runPreviewJob] }})`.
- `website/lib/inngest/events.ts` — `previewRequested` event type.
- `website/lib/preview/{types,hash,preview-jobs}.ts` — input hash + cache/create/get/count.
- `website/app/start/_actions/preview.ts` — `requestPreview` + `getPreviewStatus` server actions.
- `website/supabase/migrations/20260616120000_create_preview_jobs.sql` — table + bucket (**not applied**).
- Tests: `worker/tests/preview.test.js` (3), `website/tests/{lib/preview-hash,app/start/preview-action}.test.ts` (9). Website 299, worker 115 green.

**Cost control status:** input-hash **cache wired** (same inputs → no spend); per-draft free-count
**scaffolded** (`draft_id` stored, `countPreviewsForDraft` helper) but **not enforced** — S-E.

**Deploy checklist (when S-C/S-D ship):** apply the migration to tuatale-test + prod; the worker
already has `GEMINI_API_KEY` + `src/`; Vercel needs no key (it only sends the event + reads the row).

## UI feedback pass (2026-06-16, post-W-F live demo)

Adro walked the live builder and called these. Shipped (test-wiring level, no deploy):

1. **PHOTO UPLOAD BUG — fixed.** Cause was two-part: (a) the chosen photo was re-encoded to a
   *full-resolution* PNG and POSTed through the `uploadPhoto` Server Action, which exceeds Next 16's
   default **1MB** `serverActions.bodySizeLimit` → the action rejected it; (b) the resulting error was
   **invisible** (the error `<p>` was gated on `phase==='failed'`, but uploads run while `phase==='idle'`),
   so it read as "nothing happens". NOT a W-F regression, NOT the bucket. Fix: client **downscales to
   ≤640px** before upload (`CharacterBuilder.toPngBlob`), `next.config.ts` raises `bodySizeLimit` to
   `'4mb'` (belt-and-suspenders), and upload errors now surface in `PhotoHero` regardless of phase.
   Still test-wiring only — the privacy/safety workstream stays banked.
2. **Cut-out part-hotspots REMOVED** (S-F teardown pulled forward for the hotspots): the hover
   area-selections on the character were vestigial from the abandoned cut-out builder, meaningless
   with whole-character generation. `GeneratedPreview` no longer takes `onHotspot`; the `HOTSPOTS`
   overlay is gone. (The rest of the S-F asset/library teardown still pending.)
3. **Reorder + distinct controls:** the attribute selectors now sit ABOVE the (empty) preview box;
   flow is *photo (hero) → set features → Generate → see preview*. The feature chips are restyled as
   distinct `border-2` controls under an "or set their features" divider.
4. **Photo = HERO** (Adro's call): the photo path is the most prominent option — a new `PhotoHero`
   card at the top with the primary CTA. Keeps the "test only, privacy review pending" flag.

**BANK (do NOT build now) — visual-reference thumbnails on the attribute controls.** Re-integrate the
`public/feature-thumbs/*` swatches as inline previews on each attribute control chip (and/or show the
current selection's thumb on the collapsed chip), not just inside the opened picker popover. Today the
thumbs render only in the `PickerPanel`/`Swatch` grid; surfacing them on the chips themselves is a
later polish pass. The assets already exist (kept per §6), so this is UI-only when picked up.

## Revisitable (flag, do NOT action) — lift skin_tone "held label-only"
Whole-gen renders coherent characters of **any heritage** (the gen paints a cohesive face, not a
"Caucasian base + pigment"), so the [[project_structured-inputs-contract]] skin_tone "held
label-only until heritage" limitation can **likely be lifted** — skin_tone (and a future heritage
input) can feed `composeAppearance` and the gen will render it faithfully. Validate with a small
gen sweep when the heritage workstream is picked up; not now.
