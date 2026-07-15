# Pet Branch (pet-as-hero) — Workstream Plan (2026-07-09)

**Status: PIPELINE HALF VALIDATED END-TO-END (2026-07-09). ✅ Website wiring is next.**

**Full-book render PASSED** (`output/books/pet-hero-test/`, 12/12 pages, 0 failed, 17 Gemini calls, $0.68). Biscuit's likeness held across solo AND pet+owner multichar pages / different poses / scenes; the owner (Sam) rendered consistently as a co-star (the pet+human multichar path — the one thing the probe didn't cover — works); the lost puppy rendered as a distinct text-anchored animal; drop cap + emphasis markup rendered. Non-human HERO is proven end-to-end. Notes: pet reads slightly idealized vs real (storybook translation); a real-owner photo would flow via the same multi-photo path if wanted.


**Build state (flag `FEATURES_PET_HERO`, default off = byte-identical):**
- **Render engine** — `book-pipeline.js` (protagonist can be `non_human`: gender not required, raw pet description + coat text, "a pet <kind>" sheet label, multi-photo `photoPaths` anchor, pet-specific photo/chain wording, fixed hardcoded render-meta `subjectType`) + `page-pipeline.js` (single-subject "a pet animal" label). 9 unit tests (`worker/tests/pet-hero.test.js`); full worker suite 192/192.
- **Story-gen** — `anthropic.js` `{{PROTAGONIST_KIND_OVERRIDE}}` (const `PET_PROTAGONIST_OVERRIDE`) flips the human CHARACTER DESCRIPTION / pronoun / gender-styling sections for a pet protagonist; `formatUserMessage` emits a Pet block (no gender). **Validated end-to-end** ($0.02 Sonnet): *Biscuit and the Lost Puppy* — correct physically-concrete pet description, no gender styling, owner as context-relevant co-star (~8/12 scenes), coherent arc. Story at `output/books/pet-hero-test/story.json`; harness `scripts/_pet-story-gen.mjs`.
- **Owner role decision (Adro):** context-relevant — Sonnet decides the owner's presence per story/scene from the inputs (leans on existing companion machinery), not hardcoded.

**LAST STEP:** paid full-book render (~$0.72) from the generated story + the 3 doodle photos, to confirm the engine holds the pet hero across 12 rendered pages. Then: website wiring (adapter `subject_type`/`animal_kind`/`photo_paths`, wizard) + `bookType` hardening for the adult branch.

---


**Go/no-go probe result ✅** (`output/_pet-probe/`, ~$0.20, 5 gens, real chocolate doodle,
3 owner photos incl. a flat-light whole-body shot). Multi-photo view-0 anchor + chained
views 2–3 + 2 pages. **Likeness held across sheets AND pages** — same individual dog
(tan beard, amber eyes, floppy ears, curled tail) through 4 poses / 3 scenes; coat stayed
chocolate (no grey drift). **Key finding:** the breed-prior weakness is beatable with
(a) multiple photos covering all features + (b) a **text colour-anchor** so a flat-light
photo can't average the palette toward grey (mirrors production: appearance field + photos
together). Harness: `scripts/_pet-probe.mjs` + `_pet-probe-pages.mjs`.

---

The first alternative "book maker" branch: a personalized book where **the pet is the
hero** and the owner co-stars. Adro's green-light: *pet branch first; the pet is the
hero.* Art/tone/templates stay **close to the kids book** (his call: "more similar to
the children's book"). The adult branch (broad, flagship) plugs into the same
`bookType` abstraction later — see bottom.

## The architecture insight — the engine is already branch-agnostic
The expensive half of the pipeline does not care what *kind* of book it is:
character-sheet minting (humans **and** non-humans — pets are first-class subjects
today), page composition, PDF assembly, the reliability cluster (R1/R2/R3),
photo-anchoring, scene-aware wardrobe. "Children's book" is a **thin top layer**:
story-gen prompt/schema, the art-style set, page templates, wizard flow, pricing.

**A branch = swap that top layer, keep the engine.** So the real work of the pet
branch is small *except* for one thing the engine is genuinely weak at (below).

## The ONE reliability risk — non-human likeness as the HERO
Our diagnostics already characterized it: non-human subjects lean on a **breed prior**
(the model draws *a* golden retriever, not reliably *this* one). As a **co-star** that's
fine. As the **hero** — on every page, the likeness IS the product — it is unproven and
is the whole go/no-go. Text alone ("a golden retriever named Biscuit") will render a
generic dog that drifts page to page.

### Probe (go/no-go, ~$0.20–0.30) — run BEFORE building the branch
Mirror the wardrobe/photo probes. Using a real pet photo:
1. **Photo-anchor a pet sheet** — feed a pet photo as the view-0 anchor (the mechanism
   proven for humans), mint a 3-view pet character sheet.
2. **Chain views 2–3** from view-1 (the consistency mechanism).
3. **Render 2–3 pages** from the sheet in a kids-book style (watercolour/painterly).

**Pass = the SAME specific pet holds across the pages** (face, markings, proportions),
not a generic breed. **Fail** ⇒ non-human hero likeness isn't ready; either (a) pursue
a stronger anchor (multi-photo, breed+markings structured input) or (b) reframe the pet
branch as **owner-hero + pet co-star** (ships on today's engine) until likeness is solved.

**Bonus:** a **pet photo carries no child-photo legal/safety gate** — so photo-anchored
likeness can ship for the pet branch *before* the parked human-photo workstream.

## The build (once the probe passes) — top layer + one engine generalization
1. **Engine: protagonist-can-be-non-human.** Today `buildSubjectListForSheetGen` assumes
   the protagonist is human (reads `child.gender`, `subject_type: "human"`). Generalize
   the protagonist path to accept `non_human`: no gender, species/breed appearance,
   default age, pet-appropriate sheet prompt. Secondaries already do all of this — mostly
   lifting that treatment to the protagonist slot. **Flag-gated (`FEATURES_PET_HERO`).**
2. **Story-gen: pet-hero variant.** A Sonnet prompt/schema tuned for a pet's story
   (pet + owner relationship, pet-scale adventures) instead of the child reading-level
   framing. This is the seed of the `bookType` split — parameterize the system prompt by
   book type rather than forking `anthropic.js`.
3. **Art: reuse.** Same `ART_STYLES` set as the kids book (Adro: keep it similar). No new
   style design needed — the cheapest part.
4. **Templates: reuse/lightly adapt** the kids-book page templates.
5. **Wizard: pet-capture flow.** Species, breed, name, appearance, **photo** + the owner
   (name/appearance/relationship, optional photo). Pricing TBD.

## Guardrails
- **Photo-anchor is likely mandatory for the hero** — text-only pet likeness is generic.
  The probe decides whether photo-anchor is sufficient.
- **Owner is a tier-2 human co-star** — rides the known multichar-consistency limit, but
  as a co-star that's acceptable (same as today's kids-book secondaries).
- **Asymmetric pet markings** (a patch over one eye, one white paw) are the same failure
  class as the mole / pencil-on-ear — expect them to duplicate/wander; treat distinctive
  asymmetric marks carefully (structured note, not relied upon).
- **Flag-gated throughout** — off = byte-identical to today's kids book.

## Sequencing
1. **Likeness probe** (go/no-go — the real decision). ~$0.20–0.30.
2. **Pipeline half, flag-gated** — protagonist non_human + pet-hero story-gen; validate on
   a full pet book with seeded inputs (like the wardrobe/photo validations).
3. **Wizard + pricing** (website phase).
4. **`bookType` abstraction hardened** — so the adult branch plugs in cleanly.

## The adult branch (broad flagship — later)
Adro: *"literally all of the above — the most broad branch of tuatale"* (romantic gift,
milestone/celebration, humorous roast, general adventure). This is a genuinely new
product line on the same engine: adult story-gen (tone/length/structure, not kids'
reading levels), a **new adult art-style set** (design + probe — the W-E machinery makes
*adding* styles cheap, but the styles must be designed), adult templates, a different
wizard, different pricing. Because it's broad, it likely wants a **sub-type/occasion
selector** driving tone + art. It is scoped *after* pets precisely because the pet branch
builds the `bookType` abstraction the adult branch will exploit instead of forking.
