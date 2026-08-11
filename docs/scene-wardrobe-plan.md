# Scene-Aware Wardrobe — Workstream Plan (2026-07-08)

**Status: PROBE PASSED. Plan, not built.** Lets a character wear a **situational outfit only in the scenes where it fits** (e.g. Grayson in goalkeeper kit when he's in goal, casual clothes otherwise) — reliably, because the outfit is decided at the **sheet** level (where consistency lives), not fought per-page.

## Probe result — the reliability question is answered ✅
`output/_wardrobe-probe/` (~$0.24, 6 gens, painterly):
1. Minted a **casual base sheet** (green tee / navy shorts / trainers).
2. Minted a **keeper-kit sheet CHAINED from the casual sheet** (the casual sheet passed as the reference).
3. Rendered 4 pages — 2 casual, 2 keeper — each from the **matching** sheet.

**Findings (Adro to confirm with his eye):**
- **Same face across both outfit sheets** — the chained mint held Grayson's face/hair/skin identical while fully swapping casual → keeper kit. *This was the core risk; it held.*
- **Outfit switches cleanly per scene** — casual pages rendered casual, keeper pages rendered the kit, **no bleed** either way.
- **Face consistent across all 4 pages** within each outfit.

So the mechanism — **base sheet → chained variant sheet → per-page sheet selection by scene** — is reliable at probe scale. That satisfies the "provided it's reliable" condition.

## The build (once green-lit) — three pieces
1. **Story schema: a per-scene wardrobe tag.** Each of the 12 scenes gets an `outfit` field (e.g. `"default" | "keeper"`). Sonnet sets it from the scene action (goalkeeping beats → `keeper`), constrained to the variants the input declares. (Anthropic story-gen prompt + schema addition.)
2. **Multi-variant sheet minting.** The protagonist's outfit input gains a **base** + one/more **situational variants**. Mint the base sheet set, then **chain each variant from the base** (likeness-anchored, exactly as the probe did). Store per-variant (`sheet-NN.png`, `keeper-NN.png`). (character-sheets + book-pipeline sheet-gen loop.)
3. **Per-page sheet selection.** When rendering a page, book-pipeline picks the sheet set matching that scene's `outfit` tag and passes it as the reference. (One selection step in the page loop — the rest is unchanged.)

## Reliability & scope guardrails
- **Chained-from-base is mandatory** — never mint variants independently (they'd drift into different-looking kids). The probe proved the chained path holds; the build must use it.
- **Cost scales with variants** — each variant adds ~N sheet mints (N views). 1 situational variant ≈ +$0.10–0.20/book. Keep it to **base + 1–2 situational** initially.
- **Protagonist-first.** Start with variants on the **protagonist only**. Secondaries × variants multiplies the multichar-consistency risk (the known weak spot) — add later if needed.
- **Photo interaction.** For a photo-driven base, the photo sets the base outfit; the variant chains from the photo-anchored base. So for wardrobe control, the **base photo should be the everyday look** and the kit is the variant (aligns with the earlier photo-vs-composed note).
- **Tag accuracy.** Sonnet's per-scene tagging is testable/cheap; a wrong tag is a per-page cockpit re-roll fix, not a systemic failure.

## Input / UX (website — later phase)
The wizard needs a way to declare variants: a base outfit + "add a special outfit for certain scenes" (e.g. goalkeeper kit), and optionally *which* moments (or let Sonnet infer from the theme). This is the polished-UI phase — the pipeline half can be validated first with seeded inputs (as the photo probe was).

## Sequencing
1. **Pipeline half, flag-gated** — schema `outfit` tag + variant chained-minting + per-page selection. Validate on a **full Grayson book** (some pages casual, some keeper) with seeded variant inputs. *(This is the real go/no-go — the probe was sheet-level; the full book confirms it across 12 pages + the tag logic.)*
2. **Website UI** — declare variants in the wizard.
3. **Photo/legal gate** — only if the base is photo-driven (ties to the parked photo workstream).

## Open decisions for Adro
1. **How many variants** — base + 1 situational (simplest), or N?
2. **Who** — protagonist-only (recommended first), or secondaries too?
3. **Scene assignment** — Sonnet auto-infers "which scenes get the kit" from the theme, or the parent explicitly picks moments?
4. **Base source** — composed appearance (clean wardrobe control) vs photo-driven (needs an everyday base photo).

Probe images: `output/_wardrobe-probe/{1-sheet-casual, 2-sheet-keeper, 3..6-page-*}.png`.
