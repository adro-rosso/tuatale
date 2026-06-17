# Art-style wiring — $0 design (thread the chosen style through preview + book)

_2026-06-16. No build, no gen. All 6 styles committed; this designs how the parent's
chosen style flows into BOTH the instant preview and the book pipeline. Key finding:
watercolour is hardcoded in TWO places, not one (see §2)._

## 1. Single source of truth — `src/art-styles.js` (new, like `character-features.js`)

```js
export const COMPOSITION_RULES = "full body, centered subject, clean uncluttered background, consistent framing, face clearly visible";
export const NEGATIVE_PROMPT   = "photorealistic, scary, dark, blurry, deformed hands, extra fingers, text, watermark";

// ONE rich style string per art style, used EVERYWHERE (preview sheet + book sheet
// + book page). watercolour = the Sophie-Blackall page vocab currently in the
// template styleOverrides (preserves book quality); the other 5 are the
// probe-validated strings (enriched for page quality before book-grade — see §5).
export const ART_STYLES = {
  watercolour:        "watercolor on cold-press paper, wet-on-wet wash… Sophie Blackall… warm earthy palette",
  coloured_pencil:    "soft children's-book coloured pencil illustration…",
  painterly:          "classic golden-age storybook painting…",
  ink_wash:           "loose ink-line-and-watercolour-wash, Quentin Blake…",
  flat_modern:        "warm modern flat illustration…",
  cutpaper:           "cut-paper collage, Eric Carle…",
};
export const DEFAULT_STYLE = "watercolour";
export const STYLE_VALUES = Object.keys(ART_STYLES);            // wizard options + Zod enum + DB guard

export function resolveStyle(key) {
  const style = ART_STYLES[key] ?? ART_STYLES[DEFAULT_STYLE];
  return { style, composition_rules: COMPOSITION_RULES, negative_prompt: NEGATIVE_PROMPT };
}
```
`src/anthropic.js:358-360` (`STYLE`/`COMPOSITION_RULES`/`NEGATIVE_PROMPT`) move here; anthropic imports them.

## 2. Injection map — where the style string enters each render (file:line)

| Site | Today (hardcoded watercolour) | Change |
|---|---|---|
| **Book — character SHEET mint** | `anthropic.js:358` `STYLE` const → `anthropic.js:839` `style: STYLE` on the story → `book-pipeline.js:182` `Style: ${story.style}` | `generateStory` sets `style: resolveStyle(input.style).style`. Then `story.style` flows to the sheet prompt **unchanged**. ✅ clean |
| **Book — PAGE render** ⚠️ | **Every template `config.json` hardcodes** `imageGeneration.styleOverride` = a rich watercolour string (`prompt-2…8`, `cover-iter-1`). `page-pipeline.js:577` = `styleOverride \|\| sceneStyle` → **the override WINS**, so `sceneStyle` (=`story.style`, `book-pipeline.js:910`) is currently dead. | **The gotcha.** Remove/neutralise the per-template `styleOverride` so `sceneStyle` (the chosen style) reaches the page. Options in §5. Until this changes, pages stay watercolour regardless of the parent's choice. |
| **Preview** | `character-preview.js` `PREVIEW_STORY.style` (hardcoded watercolour) | `generateCharacterPreview(inputs)` reads `inputs.style` → `resolveStyle(inputs.style)`. |
| **Cover render** | `cover-iter-1/config.json` `styleOverride` (watercolour) | Same fix as page render. |
| _(ignore)_ `src/pipeline.js:51-57` | legacy spike path, not the book pipeline | no change |

**The single configurable knob is the style string in `resolveStyle`.** The book reads it via
`story.style` (sheet) and `sceneStyle` (page, *once the template override is removed*); the preview
reads it directly. Threading it in is just: order → adapter → `input.style` → `generateStory`.

## 3. Schema / storage (additive, mirrors `child_features`)

- Migration `add_art_style.sql`: `drafts.art_style text` + `orders.art_style text`, nullable, default `'watercolour'` (back-compat: existing rows render watercolour). No DB CHECK (validate in app, like `child_features`).
- **Adapter** `worker/src/adapter.js:88` `adaptOrderToPipelineInput`: read `order.art_style` → `input.style` (validate against `STYLE_VALUES`, fall back to `DEFAULT_STYLE` — the hard boundary, like `validateChildFeatures`).
- **Draft→order copy** `website/lib/checkout/create-order.ts:89-90` (next to `child_features`): copy `art_style`.
- **Zod** mirror in `schemas.ts` (`STYLE_VALUES` enum) + drift-parity test (like the features contract).

## 4. Wizard UI — style picker comes FIRST

The previews are rendered IN the chosen style, so **style selection must precede the character step**:
- A new **"Choose your art style"** step (or a prominent selector at the top of the character step) — 6 visual swatches (reuse the probe portraits as the swatch thumbnails: `output/_style-probe/<style>/portrait.png`). Writes `art_style` to the draft.
- The character step's `GeneratedPreview` passes the draft's `art_style` into `requestPreview` → the preview renders in that style. Changing the style after some previews exist → new input-hash → new gen (the cache keys on style; `STYLE_VERSION`/style already belong in the hash — add `style` to `computeInputHash`).
- Default selected = watercolour (the validated control), so the flow works if the parent skips the choice.

## 5. Consistency — the chained-ref machinery is style-AGNOSTIC (confirmed), but two flags

- **Character consistency is style-agnostic.** The book holds a character across pages via the chained-ref mechanism (page refs the character sheet; `book-pipeline.js` sheet anchor + `chainedSheetRefs`). The art-style probe proved this engages in all 6 styles (6-page runs held for the 2 risk styles). Swapping the *style string* doesn't touch the *ref* mechanism. ✅
- **FLAG 1 — the template `styleOverride` (the §2 gotcha).** This is the real wiring blocker: page render must stop hardcoding watercolour or the chosen style never reaches the page. Cleanest: drop `styleOverride` from template configs and let `sceneStyle` flow; keep the rich watercolour vocab alive by putting it in `ART_STYLES.watercolour`. (Alt: make `styleOverride` resolve from the chosen style — more plumbing.)
- **FLAG 2 — page-grade vocab parity.** The probe validated the 5 new styles' *short* strings for *character consistency*, not full-page *scene* quality at book resolution. Watercolour has a long-tuned rich page vocab (the Sophie-Blackall override); the 5 new styles don't yet. They likely need a richer per-style page string before book-grade — a gen-gated tuning pass per style.
- **Per-style identity nuance (from the probe, carry into copy/QA):** cut-paper carries identity via outfit/hair (abstract faces); ink-wash has looser per-page faces. Both shippable; cut-paper is the "stylised" option.

## 6. Staging (each gen-spend gated)

| Stage | What | Spend |
|---|---|---|
| **W-A** | This design | $0 (done) |
| **W-B** | `src/art-styles.js` source of truth + `resolveStyle`; thread `input.style`→`generateStory`; `generateCharacterPreview(inputs.style)`; preview hash includes style. **No template change yet** (watercolour still wins on pages). Unit-tested. | $0 |
| **W-C** | Schema migration (drafts/orders `art_style`) + adapter + create-order copy + Zod/parity. Test-only migration first. | $0 |
| **W-D** | **Remove template `styleOverride`** so `sceneStyle` flows; verify a watercolour book still matches (1 book, gated) — the back-compat check. | ~$0.70 (1 book) |
| **W-E** | Page-grade vocab tuning for the 5 new styles (gen-gated per style) — bring each to book quality on real pages. | ~$0.70 × styles tested |
| **W-F** | Wizard style-picker step (first step, before character) + style threaded into the live preview (cache-keyed per style); see §7 purchase-gate bank note. **Build = $0 done**; live demo spends preview gens (~$0.04/style, gated). | preview gens |

**Recommended first:** W-B + W-C (pure plumbing, $0) so the knob exists end-to-end behind the
still-watercolour default; then W-D (the template-override removal + 1 back-compat book) before any
per-style page tuning. Pause before W-D's book spend.

## 7. RULE — previewable ≠ purchasable until W-E (banked, 2026-06-16, W-F)

A style being **previewable** in the wizard (W-F shipped: pick it → the live character
preview mints in that style) does **NOT** make it **purchasable**. The 5 non-watercolour
styles still carry the *short probe string* on `.page` (`ART_STYLES[k].page === .sheet`);
only watercolour has the long-tuned Sophie-Blackall page vocab. Until each style's W-E
page-grade tuning lands, a *book* ordered in that style would render its pages with the
unproven short vocab — **not book-grade**.

- **Today: no enforcement needed.** There is no buy path wired off the style picker, so a
  customer cannot purchase a book in an un-tuned style. The gate is informational for now.
- **Before a real buy path exists:** gate purchase on a per-style "page-tuned" flag.
  Watercolour = tuned (purchasable). The other 5 = previewable-only until their W-E pass
  flips them tuned. Candidate mechanism: a `PURCHASABLE_STYLES` allow-list (or a
  `pageTuned: boolean` on `ART_STYLES`) checked at checkout / order-create.
- Watercolour remains the safe default end-to-end, so the default purchase path is unaffected.
