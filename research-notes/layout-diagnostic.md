# Layout diagnostic — Path 3 (internal-geometric analysis)

_Compiled 2026-05-17. Source: precise measurements from `scripts/generate-pdf.js` constants + page narrative text on disk. No reference-book comparisons (Path 3 — see chat history for why)._

Three pages analysed:

1. **Mateo page-05** — asymmetric layout. User complaint: "half empty and broken."
2. **Mateo page-09** — cinematic layout. User complaint (combined with Sage page-09): "feels like page 1 again."
3. **Sage page-09** — cinematic layout. Same complaint pattern as Mateo page-09.

---

## Section 1 — Measurements

All dimensions in PDF points (1 pt = 1/72 in) with inch equivalents in parentheses. All measurements derived from constants in `scripts/generate-pdf.js` and the actual `pages/page-NN.txt` content on disk. Char-width estimate for wrap math: 8.5 pt avg at 18pt Times-Roman (English prose).

### 1.1 Shared constants (apply to all pages)

| Constant | Value |
|---|---|
| `PAGE_WIDTH` | 792 pt (11.000 in) |
| `PAGE_HEIGHT` | 612 pt (8.500 in) |
| `MARGIN` | 36 pt (0.500 in) |
| `PAGE_BACKGROUND_COLOR` | `#F8F4ED` |
| `BODY_FONT_SIZE` | 18 pt (Times-Roman) |
| `BODY_LINE_GAP` | 6 pt |
| Effective line spacing | ~26.7 pt/line (18 × 1.15 natural + 6 gap) |
| `IMAGE_BORDER_COLOR` | `#B8A99A` |
| `IMAGE_BORDER_WIDTH` | 1.5 pt |

### 1.2 Mateo page-05 [asymmetric]

**Narrative content (322 chars / 60 words):**
> "The path splits into two. The left trail is steeper and rockier. The right trail is easier but bends away from the wind. Mateo chews his lip and pushes his glasses up. Then, just above the left-hand ridge, the kite's orange-and-blue corner blinks into view for one second, and that is enough. Mateo takes the steep path."

**Image:**
- Region: `ASYMMETRIC_IMAGE_REGION` at (X=281, Y=36) pt → (3.903, 0.500) in
- Region size: 475 × 245 pt → 6.597 × 3.403 in
- Native source: 1408 × 768 (landscape)
- Fit-to-box scale: 0.319 (height-constrained: 245/768)
- Rendered image bounds: 449.2 × 245.0 pt → 6.239 × 3.403 in
- Rendered position: centred in region at (293.9, 36.0) pt → (4.082, 0.500) in
- Image fit whitespace inside region: 12.9 pt (0.179 in) on left + right (no top/bottom — height-fills)
- Edge treatment: 1.5 pt border at `#B8A99A`, drawn at rendered bounds (not region)

**Text:**
- Region: `ASYMMETRIC_TEXT_REGION` at (X=36, Y=311) pt → (0.500, 4.319) in
- Region size: 540 × 265 pt → 7.500 × 3.681 in
- Font: Times-Roman 18pt, lineGap 6pt
- Alignment: left
- Line count (wrap at 540 pt): ~5 lines
- Rendered text height: ~133.5 pt (1.854 in)
- Text utilization: 50% of region (133.5 / 265)
- Position relationship to image: image right-anchored at upper-right (X=281, right edge at X=756 = MARGIN-anchored); text left-anchored at lower-left (X=36 = MARGIN-anchored). Image and text **do not share a horizontal alignment axis**. Vertically separated by `ASYMMETRIC_IMAGE_TEXT_GAP` = 30 pt (0.417 in).

**Negative space (page-05):**

Map of empty regions, content-relative coords (content area = 36..756 × 36..576):

| Region | Coords (content-relative) | Size (pt) | Size (in) | Area (sq.in.) |
|---|---|---|---|---|
| A: Upper-left rectangle | (0,0)–(245,245) | 245 × 245 | 3.403 × 3.403 | 11.581 |
| B: Strip below image, above text | (0,245)–(720,275) | 720 × 30 | 10.000 × 0.417 | 4.167 |
| C: Right of text region (below image) | (540,275)–(720,540) | 180 × 265 | 2.500 × 3.681 | 9.201 |
| D: Below rendered text inside text region | (0,408.5)–(540,540) | 540 × 131.5 | 7.500 × 1.826 | 13.698 |
| E: Image side whitespace (fit-to-box) | (245,0)–(257.9,245) + mirror | 2 × (12.9 × 245) | 2 × (0.179 × 3.403) | 1.219 |
| **Total empty** | | | | **39.866 sq.in.** |

Page total area: 93.500 sq.in.
**Empty fraction: 42.6%** (39.866 / 93.500)

### 1.3 Mateo page-09 [cinematic]

**Narrative content (497 chars / 92 words):**
> "The last loop comes free, and Mateo stands up. He is at the very top of the hill. The wind rushes past his ears. And what Mateo sees stops him completely still. The whole valley is laid out below him like a map his grandmother might draw — rooftops and river and road, and right in the middle of it all, one small house with a curl of smoke rising from its chimney. That is Grandma Elena's house. That smoke means bread is nearly ready. The wind brought him all the way up here just so he could see this."

**Image:**
- Position: (0, 0) pt — full-bleed, no margin
- Region size: 792 × 612 pt → 11.000 × 8.500 in (entire page)
- Native source: 1408 × 768 (landscape)
- Fit-to-box scale: 0.5625 (width-constrained: min(792/1408, 612/768) = min(0.5625, 0.7969) = 0.5625)
- Rendered image bounds: 792 × 432 pt → 11.000 × 6.000 in
- Rendered position: centred in page, image at (0, 90) pt → top + bottom whitespace 90 pt each (1.250 in each)
- Edge treatment: **no border** (full-bleed cinematic)

**Panel:**
- `CINEMATIC_PANEL_WIDTH` = 554 pt (7.694 in)
- `CINEMATIC_PANEL_PADDING` = 16 pt
- Inner text width: 522 pt (7.250 in)
- Line count for 497 chars at 522 pt width: 8 lines
- Rendered text height: ~214 pt (2.972 in)
- Panel height = 214 + 32 = 246 pt (3.417 in)
- `CINEMATIC_PANEL_X` = 36 pt (0.500 in) — fixed bottom-left
- Panel Y = PAGE_HEIGHT - panel_height - MARGIN = 612 - 246 - 36 = **330 pt** (4.583 in)
- Panel occupies: (36, 330) to (590, 576) pt → bottom-left region of page
- `CINEMATIC_PANEL_RADIUS` = 8 pt
- `CINEMATIC_PANEL_OPACITY` = 0.85
- `CINEMATIC_PANEL_COLOR` = `#F8F4ED` (matches non-existent page background; only image is below it)
- Text utilization: 78% of MAX cap (214 / 274 inner max)

### 1.4 Sage page-09 [cinematic]

**Narrative content (354 chars / 63 words):**
> "Inside, the classroom is warm and full of color. There are paintings on the walls, a big bin of building blocks, and a cozy corner with cushions in every shade of blue. The other children are busy with their morning things — talking, laughing, deciding what comes next. Sage stays close to the doorway, watching, her hand tucked in her pocket."

**Image:** same as Mateo page-09 — full-bleed, no border, native 1408×768 fit-to-box.

**Panel:**
- Line count for 354 chars at 522 pt width: ~6 lines
- Rendered text height: ~160 pt (2.222 in)
- Panel height = 160 + 32 = 192 pt (2.667 in)
- Panel X = 36 pt (bottom-left, same as Mateo)
- Panel Y = 612 - 192 - 36 = **384 pt** (5.333 in)
- Panel occupies: (36, 384) to (590, 576) pt
- Text utilization: 58% of MAX cap (160 / 274)

### 1.5 Comparison between Mateo and Sage page-09

| Field | Mateo page-09 | Sage page-09 | Δ |
|---|---|---|---|
| Image treatment | full-bleed, no border | full-bleed, no border | identical |
| Panel X | 36 pt | 36 pt | identical |
| Panel width | 554 pt | 554 pt | identical |
| Panel height | 246 pt | 192 pt | 54 pt (0.750 in) |
| Panel Y | 330 pt | 384 pt | 54 pt (0.750 in) |
| Panel right edge | 590 pt | 590 pt | identical |
| Panel bottom edge | 576 pt | 576 pt | identical |
| Panel color/opacity/radius | identical | identical | identical |
| Font / size / alignment | identical | identical | identical |

Only differentiator between the two cinematic page-09 instances: panel **vertical extent** (taller on Mateo by 54 pt because the narrative is longer). Bottom edge of panel is the same on both. Position, treatment, framing — all identical.

---

## Section 2 — Geometric diagnosis

### 2.1 Mateo page-05 [asymmetric] — "half empty and broken"

**Finding A: Empty space is split into two visually-disconnected zones.**

Geometric truth (from Section 1.2 negative-space map): empty regions A (upper-left, 11.6 sq.in.) and C (lower-right, 9.2 sq.in.) are the two largest empty zones on the page. They are connected only by region B (the 0.417 in tall strip below the image / above the text — too thin to perceive as flowing negative space). Effectively the eye sees two disconnected empty quadrants surrounding a diagonal of content (image upper-right, text lower-left).

Composition principle violated: **Gestalt closure / continuity**. Negative space in an asymmetric layout works when it reads as ONE continuous region that frames the content. Two visually-disconnected empty zones read as two HOLES, not as deliberate framing.

Code-level change: expand `ASYMMETRIC_TEXT_WIDTH` from 540 pt to 720 pt (full content width = `PAGE_WIDTH - 2 * MARGIN`). Region C (lower-right empty) disappears. Region A (upper-left) remains as the single intentional negative space, balanced against the image in upper-right.

Worst-case fit check at 720 pt text width: Sage page-10 (491 chars) wraps to 6 lines → 160 pt rendered → 60% of 265 pt budget. Still under the 90% warning threshold. Mateo page-05 (322 chars) wraps to ~4 lines → 107 pt rendered → 40% utilization.

**Finding B: Image and text do not share an alignment axis.**

Geometric truth: image left edge at X=281 pt, image right edge at X=756 pt (MARGIN-aligned to page right). Text left edge at X=36 pt (MARGIN-aligned to page left), text right edge at X=576 pt. Image and text share **no edge alignment** — image-right aligns to page-right-margin, text-left aligns to page-left-margin. The two content regions are anchored to opposite page edges with no shared invisible grid line connecting them.

Composition principle violated: **Alignment**. In asymmetric layouts where two content blocks sit in opposite quadrants, at least one shared alignment axis is conventional to bind them into one composition (e.g., image-left edge aligns to text-left edge, or image-bottom aligns to a text-top horizontal). Without a shared axis, the two blocks feel like independent floating elements.

Code-level change: combined with Finding A's fix (text width = 720), text becomes full content width. Text-left = 36 (page-margin), image-right = 756 (page-margin). Image-right edge then aligns with text-right edge (both at content-area right boundary) — invisible vertical alignment line. Composition coheres without further changes.

**Finding C: 50% of the text region is empty below the rendered text.**

Geometric truth: text region is 540 × 265 pt (143,100 sq.pt budget). Mateo page-05's 322-char narrative renders ~133.5 pt tall = ~50% of the budget. The remaining 131.5 pt × 540 pt = 13.7 sq.in. of empty space is inside the text-region frame but below the rendered prose.

Composition principle considered: this is in tension with the runtime overflow warning system. The text region is sized for **worst-case** narratives (Sage page-10 at 81% utilization). Short narratives like Mateo page-05 leave large under-text empty space.

Code-level change: **no change recommended.** Sizing the text region to fit the average rather than the worst case would push long narratives over the threshold. The under-text empty space is the cost of a uniform text region. Note for future: if we go to adaptive text-region height like Cinematic's adaptive panel, this disappears — but that's a larger refactor.

### 2.2 Mateo page-09 + Sage page-09 [cinematic] — "feels like page 1 again"

**Finding D: All cinematic pages share identical panel position, size constraint, opacity, color, and corner radius.**

Geometric truth (from Section 1.5 and 1.3-1.4 measurements): Mateo page-09 and Sage page-09 differ from each other only in panel vertical extent (54 pt — driven by narrative length). Panel X (36 pt), panel width (554 pt), panel right/bottom edges (590/576 pt), color (`#F8F4ED`), opacity (0.85), radius (8 pt), padding (16 pt), font (Times-Roman 18 pt) — all identical. Same holds for page-01 of either book (cinematic, same renderer).

The result: every cinematic page has its panel anchored at the same screen position (bottom-left, with bottom edge always at Y=576 pt). The eye pattern-matches across pages 1, 9, 12 and reads them as the "same type" of page — which is technically what the layout-tag intends, but the visual repetition flattens the story arc differentiation (page 1 = establishing, page 9 = climactic, page 12 = closing should each carry distinct visual weight).

Composition principle violated: **Position-as-information / variance within type**. When a recurring visual element repeats at the exact same position multiple times in a sequence, the eye reads it as "the same thing" rather than "different instances of a type." A real picture book with three full-bleed pages typically varies SOMETHING (panel position, panel treatment, image crop, text length) across them so the recurrence reads as theme-and-variation rather than repetition.

Code-level change: cycle panel position across cinematic occurrences. Introduce a `CINEMATIC_PANEL_POSITIONS` array (e.g., `["bottom-left", "bottom-right", "top-left"]`) and an index counter that increments per cinematic page rendered. Inside `renderCinematicPage`, compute (panelX, panelY) based on the position name for this occurrence:

- `bottom-left`: X = MARGIN, Y = PAGE_HEIGHT - panelHeight - MARGIN (current behaviour)
- `bottom-right`: X = PAGE_WIDTH - CINEMATIC_PANEL_WIDTH - MARGIN, Y = PAGE_HEIGHT - panelHeight - MARGIN
- `top-left`: X = MARGIN, Y = MARGIN
- `top-right`: X = PAGE_WIDTH - CINEMATIC_PANEL_WIDTH - MARGIN, Y = MARGIN

With the 3-element cycle, page 1 = bottom-left, page 9 = bottom-right, page 12 = top-left. Each cinematic page has a visibly different panel anchor. The "feels like page 1 again" pattern-match is broken at the position-recognition level before the eye even reads the content.

**Finding E: No layout-level differentiation between establishing-shot and climactic-beat cinematic pages.**

Geometric truth: page 1 (establishing) and page 9 (climactic) use the same renderer with the same parameters. The story-arc difference between them is carried entirely by image content + narrative content — not by layout. A real picture book climax often gets visual emphasis through layout choices (less text, larger image impact, different treatment) that mark "this is the big moment."

Composition principle considered: **Climactic emphasis**. In sequential design (books, films, slide decks), the climax beat is conventionally marked by a visual shift — not just content change. Without that shift, the climax doesn't read as a peak; it reads as a continuation.

Code-level change: this is layered ON TOP of Finding D's position-cycle fix. Two paths:

- (a) Treat Finding D as sufficient — position cycling provides the variance, and the user judges whether story-arc emphasis emerges from that alone. Smallest change.
- (b) Add per-position panel-treatment variation: e.g., reduce `CINEMATIC_PANEL_OPACITY` for the 2nd occurrence (climactic page) from 0.85 to 0.60 — image dominates more on the climax beat. Adds a `CINEMATIC_OPACITY_BY_OCCURRENCE` array.

Recommendation: ship Finding D first; observe; layer Finding E only if position-cycling alone doesn't differentiate cinematic pages enough.

### 2.3 Findings count: 5 (3 actionable for page-05, 2 actionable for page-09)

If we were stuck on 1-2 findings only, that would suggest page-05's problem isn't primarily geometric. Five findings with concrete code-level fixes suggest the geometric story is real on both pages. (Finding C is "no change recommended" — surfaced for completeness but doesn't add to the action list.)

---

## Section 3 — Diff table

| # | Geometric issue found | Code-level change | Expected effect |
|---|---|---|---|
| A | Page-05: empty space split into two disconnected zones (upper-left + lower-right) violates Gestalt closure | `ASYMMETRIC_TEXT_WIDTH`: 540 → 720 (full content width = `PAGE_WIDTH - 2 * MARGIN`) | Lower-right empty zone disappears. Empty space consolidates into one continuous upper-left region (~3.4 × 3.4 in). Asymmetric balance maintained via image upper-right + text-band lower (full width). |
| B | Page-05: image and text share no alignment axis (image right-anchored, text left-anchored, no shared edge) | Resolved by fix A (text width = 720 means text-right edge = 756 = page right margin, aligning with image right edge) | Invisible vertical alignment line at page right margin binds image and text into one composition. No additional code change beyond A. |
| D | Page-09 (and all cinematic pages): identical panel position across multiple cinematic pages reads as repetition rather than theme-and-variation | Introduce `CINEMATIC_PANEL_POSITIONS = ["bottom-left", "bottom-right", "top-left"]` + occurrence counter. In `renderCinematicPage`, compute panelX/panelY from the position name. | Page 1 = bottom-left, page 9 = bottom-right, page 12 = top-left. Position-recognition pattern-match breaks before the eye reads content. Each cinematic page reads as its own beat. |
| E | Page-09: no layout-level emphasis distinguishing climactic page from establishing page | (Conditional — only if D alone is insufficient.) Add `CINEMATIC_OPACITY_BY_OCCURRENCE = [0.85, 0.60, 0.85]` and use the array-indexed opacity in `drawCinematicPanel` | Climactic-beat cinematic page (occurrence 2) has more-transparent panel; image dominates more. Establishing and closing cinematic pages keep the current 0.85 opacity. |

Findings not in the diff (intentionally):

- **Finding C (under-text empty in page-05 text region)**: no recommended change. Text region is sized for worst case; the trade-off is inherent.
- **Side whitespace inside asymmetric image region (12.9 pt strips)**: 1.2 sq.in. total — too small to be the source of the "broken" perception. Skip.
- **Strip between image and text on page-05 (30 pt gap)**: surfaced during analysis. Could tighten `ASYMMETRIC_IMAGE_TEXT_GAP` from 30 → 12. Effect is small (saves 0.4 sq.in. of empty space). Not in diff because impact is marginal vs. the L-shape consolidation in fix A.

---

## Decision needed

Diff table has four rows; two of them (A, B) collapse into one code change (just `ASYMMETRIC_TEXT_WIDTH`). The other two (D, E) are about cinematic position-variance, with E gated on D being insufficient.

Three independent decisions:

1. **Ship fix A (asymmetric text width = 720)?** Single-line constant change. Addresses the page-05 "half empty and broken" finding directly.
2. **Ship fix D (cinematic panel position cycle)?** ~15-line refactor: new array constant + occurrence counter in scene loop + (panelX, panelY) computation in renderer. Addresses the page-09 "feels like page 1 again" finding directly.
3. **Add fix E (per-occurrence opacity)?** Cheap addition if D ships, but only worth doing if D alone doesn't differentiate the cinematic pages enough on next-session visual inspection. Default: hold off; ship D, observe, decide on E later.

All decisions are reversible by reverting the constant or restoring the single-position renderer. No data on disk affected. Existing books would need re-running `node scripts/generate-pdf.js --book-dir output/books/...` to re-render with new layouts.
