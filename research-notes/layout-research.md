# Layout research for picture-book PDF generation

_Compiled 2026-05-17 for the DaBookTing project. Goal: identify three layout patterns to implement, with variance across pages, that pass the "looks like a real children's book" gut-feel test._

---

## 1. Reference children's books (ages 4-7)

Seven widely-recognised modern picture books from the target age range. Notes focus on **layout patterns**, not artwork or story.

### 1.1 _Where the Wild Things Are_ — Maurice Sendak (1963)

- **Pattern: dynamic image-scaling across the book.** Opening pages have small framed images with wide white margins and prominent text. As Max's journey escalates, the image **grows progressively** page-by-page until the "wild rumpus" — three spreads of **pure full-bleed image with no text at all** ("Let the wild rumpus start!").
- **Takeaway:** layout itself can carry emotional escalation. The most intense moments shed text entirely. Quiet moments use traditional framed-with-margin.

### 1.2 _The Snowy Day_ — Ezra Jack Keats (1962)

- **Pattern: full-bleed collage-style images with text positioned in the negative space.** The snow itself often provides the white margin where text sits — text appears _within_ the illustration, not in a separate band.
- **Takeaway:** when an image has natural empty/light regions, text can live inside them rather than below.

### 1.3 _Goodnight Moon_ — Margaret Wise Brown / Clement Hurd (1947)

- **Pattern: alternating spread types.** Wide full-colour spreads of the "great green room" alternate with **single-object black-and-white close-ups** (a comb, a brush, etc). Text on colour spreads always at bottom in a horizontal band.
- **Takeaway:** alternation is a layout strategy — varied page types create rhythm and let the reader linger.

### 1.4 _Last Stop on Market Street_ — Matt de la Peña / Christian Robinson (2015)

- **Pattern: mixed layouts within one book.** Some pages full-bleed urban-scene paintings with text overlaid (white text on darker areas, or in a treated panel). Others framed with text below. Quiet moments use asymmetric whitespace.
- **Takeaway:** picture books don't pick one layout and stick to it. Layout variation _across_ a single book is normal and expected.

### 1.5 _Each Kindness_ — Jacqueline Woodson / E.B. Lewis (2012)

- **Pattern: watercolour full-page paintings with text overlaid on the lighter regions of the painting itself.** Text treated like a caption nested inside the artwork. Quiet emotional pacing.
- **Takeaway:** for watercolour illustrations specifically (our case), text can sit on the lightest part of the painting without panels or bands. The painting absorbs the text.

### 1.6 _The Day the Crayons Quit_ — Drew Daywalt / Oliver Jeffers (2013)

- **Pattern: page-as-letter.** Each page is conceptually a written note from a crayon. Handwritten-style text on lined notebook paper; illustration accompanies as if drawn on the same page. Layout serves the conceit.
- **Takeaway:** strong conceit can drive an unusual layout. _Not applicable to our pipeline_ (we don't generate handwritten text), but worth knowing as a category.

### 1.7 _Press Here_ — Hervé Tullet (2010)

- **Pattern: alternating image-only and text-only pages.** Image pages: minimal colored dots on white. Text pages: instructions in playful typography, no image at all.
- **Takeaway:** image-only and text-only pages can coexist. _Mostly not applicable_ for us (we always have both per scene), but informs the idea that "image dominates" or "text dominates" pages are valid.

---

## 2. Common layout patterns (named + described)

Distilled from the references above plus broader picture-book conventions. Some apply to our pipeline, some don't — viability assessed in the next section.

| # | Pattern | Description |
|---|---|---|
| 1 | **Full-bleed image** | Image fills the entire page edge-to-edge. Text either overlaid with treatment, or on the facing page. |
| 2 | **Framed image + text band** | Image bordered by white margin. Text in a separate band below (or beside). Traditional, calm, predictable. |
| 3 | **Half-page image** | Image occupies top or one side half. Text the other half. Magazine-like. |
| 4 | **Vignette text-in-image** | Image extends to edges; text sits in a deliberately-light region inside the image (Snowy Day technique). |
| 5 | **Text-treated overlay** | Text directly on the image with a contrast treatment (translucent panel, drop shadow, outline). |
| 6 | **Asymmetric off-centre** | Image and text positioned off-centre with deliberate negative space. Modern/designerly. |
| 7 | **Colour-band text** | Text in a solid coloured band (matching palette) below or above the image. |
| 8 | **Sequential frames** | Multiple smaller images on one page, comic-strip-like. |
| 9 | **Image-only / text-only** | Page carries one or the other, not both. Wild Things rumpus pages, Press Here. |
| 10 | **Image growth across pages** | Image size escalates page-by-page to mirror story intensity (Wild Things technique). |

---

## 3. Constraints from our pipeline

Hard constraints that filter which patterns we can use:

1. **One landscape image per scene.** Gemini returns 1408×768 (~1.83:1 landscape). We don't generate multiple images per scene, can't do double-page spreads, and don't have hand-cropped variants.
2. **Watercolour painterly style** (locked from Phase 1 brand constants). Edges are soft; light regions exist naturally; the image absorbs overlaid text more gracefully than a hard-edged digital illustration would.
3. **3-5 sentence narrative_text per page** (locked from system prompt). Real measured range: 258-491 chars (Sage book), 4-6 lines at 16pt Helvetica with 720pt width.
4. **No image regeneration based on layout decision.** Layout picks happen after the image exists. We can't ask the image generator to "leave a corner light for text" — the image is what it is.
5. **Landscape letter (11×8.5") page** locked. PDF output, no print-on-demand.
6. **Helvetica body font** for v1 (locked, but trivially swappable). Sans-serif, not handwritten.
7. **No per-page user choice** in v1 — system picks layout. Web UI will surface an "advanced" choice later (Week 4+ work).

### Patterns immediately disqualified

- **#8 Sequential frames** — we have one image per scene, not multiple.
- **#9 Image-only / text-only** — we always have both per scene.
- **#10 Image growth across pages** — we don't have control over image sizing variance from the generator side; could do it client-side at PDF build time, but it's a feature not a layout per se.
- **#6 Crayons-style letter format** — requires handwritten text generation we don't have.

### Patterns viable for our pipeline

- **#1 Full-bleed image** with text overlay (treated, or in vignette region)
- **#2 Framed image + text band** (this is our v1 layout — keep as one of the three)
- **#3 Half-page image + text below** (essentially what v1 is; #2 vs #3 differ mainly in how much room each gets)
- **#4 Vignette text-in-image** — works specifically because we have watercolour images with natural light regions
- **#5 Text-treated overlay** — works on full-bleed; needs a treatment (panel/shadow) for legibility
- **#6 Asymmetric off-centre** — works on a landscape page, gives breathing room
- **#7 Colour-band text** — works, requires picking a band colour

---

## 4. Three candidate layouts to implement

Picked for **maximum visual variance** across the three: one calm, one cinematic, one asymmetric. Each works for a different mood; together they give the system a palette to draw from per-scene.

### Candidate A — "Classic framed"

**Sketch (in words):**
```
+-----------------------------------+
|                                   |
|          [image area]             |
|       (image, fit-to-box,         |
|        centred, ~5" tall)         |
|                                   |
+-----------------------------------+
|                                   |
|   Body text, 16pt Helvetica,      |
|   left-aligned, with line gap.    |
|                                   |
+-----------------------------------+
```

- Image at top, 720pt wide × 360pt tall (current v1 layout from `scripts/generate-pdf.js`).
- Text below in a clean band, left-aligned, 16pt Helvetica.
- 0.5" margins all around.
- **Tone:** calm, predictable, comforting. Reads like a traditional storybook page.
- **Best for:** most scenes; the safe baseline. Setup pages, quiet moments, default-when-uncertain.
- **Worst for:** climactic or atmospheric moments where the layout itself should escalate.

### Candidate B — "Cinematic full-bleed"

**Sketch (in words):**
```
+-----------------------------------+
|                                   |
|  [image fills entire page, edge   |
|   to edge — no margins around it] |
|                                   |
|    +---------------------+        |
|    | Body text in soft   |        |
|    | cream/white panel,  |        |
|    | bottom-left corner, |        |
|    | semi-translucent    |        |
|    | so image shows      |        |
|    | through subtly      |        |
|    +---------------------+        |
|                                   |
+-----------------------------------+
```

- Image fills entire 792×612 pt page (no margin, full bleed).
- Text in a cream/white **vignette panel** in the bottom-left (or bottom-right, alternating across the book for rhythm).
- Panel: ~60% page width × ~30% page height. Soft alpha (~85% opacity) so the underlying image shows through faintly. Rounded corners (or no corners — pure soft alpha edge).
- 12pt padding inside the panel; 16pt Helvetica text inside.
- **Tone:** cinematic, atmospheric, big-feeling. The whole page IS the moment.
- **Best for:** establishing shots (page 1 of the story); climactic moments (typically page 8-9 in our 12-page arc); closing scenes where the world matters as much as the character. Any moment where the environment is the protagonist.
- **Worst for:** scenes where the protagonist's specific action is the point (action gets visually buried by environment).

### Candidate C — "Asymmetric breathing"

**Sketch (in words):**
```
+-----------------------------------+
|                                   |
|             +-----------+         |
|             |           |         |
|             |   image   |         |
|             |  ~60% of  |         |
|             |  page,    |         |
|             |  upper-   |         |
|             |  right    |         |
|             +-----------+         |
|                                   |
|   Body text in lower-left,        |
|   ~40% of page, generous          |
|   whitespace around it.           |
|                                   |
+-----------------------------------+
```

- Image positioned in the upper-right quadrant of the page — roughly 60% of page width × 60% of page height. Fits a 1408×768 image at smaller-than-full-bleed size.
- Text in the lower-left quadrant, with deliberate whitespace separating it from the image.
- Page composition is asymmetric: the eye moves diagonally from upper-right (image) to lower-left (text).
- Margin around everything is larger than usual (0.75" or more).
- **Tone:** modern, designerly, contemplative. The whitespace gives breathing room.
- **Best for:** intimate character beats; reflective transitions; emotional resolution moments. Pages where the kid is alone with their feelings.
- **Worst for:** fast-paced action moments (the asymmetric breathing-room slows tempo too much).

---

## 5. How the system chooses per scene (sketch — not for implementation yet)

Out of scope for this research doc, but worth sketching so the three candidates make sense as a set:

- **Default everything to Classic (A).** Safe baseline.
- **Pick Cinematic (B)** for: page 1 (establishing), page closest to story climax (typically page 8 or 9 in our arc), page 12 (closing). Roughly 3 of 12 pages.
- **Pick Asymmetric (C)** for: pages that feel reflective/intimate based on simple narrative-text heuristics (short text, emotion words, or just specific page positions like a turning-point page). Roughly 2-3 of 12 pages.
- **Remaining 6-7 pages** stay Classic.

Across a 12-page book, that produces a rhythm: roughly **5-7 classic, 3 cinematic, 2-3 asymmetric** — varied enough to feel curated, predictable enough to feel coherent.

The exact selection logic is an implementation question for the next step. The point of choosing _three_ patterns (not two, not five) is to give the system enough vocabulary to vary the rhythm without becoming chaotic.

---

## 6. Open questions (to resolve in implementation)

- **Cinematic vignette panel: rounded corners or soft alpha-edge?** Pdfkit can do both. Rounded looks more "designed", soft alpha looks more "watercolour-organic." Pick on phone-screen test.
- **Asymmetric: image upper-right or upper-left?** Probably alternate across the book for rhythm — or pick per scene direction.
- **Cinematic panel position: bottom-left always, or alternate?** Alternating L/R across pages is a real picture-book convention (forces the eye to keep moving).
- **Cover page:** which of the three layouts? Probably Cinematic — covers should be atmospheric. To be confirmed when implementation starts.
- **What happens when a Cinematic page's image is the rare portrait outlier (sheet-01 case)?** Vignette panel placement might need to adapt.

---

## 7. Verdict

Three candidates that span the visual range:

1. **Classic framed** — the safe default; calm; works for everything.
2. **Cinematic full-bleed** — big feeling; works for atmospheric/climactic beats.
3. **Asymmetric breathing** — modern designerly; works for intimate/reflective beats.

Picking these three means **per-page variance is meaningful** (different layout = different mood) and **the system has decision-making latitude** without chaos.

Whether this matches "looks like a real children's book" — that's the gut-test that runs once we have a sample PDF in hand.
