# Review Station

A local operator app for reviewing a generated book page-by-page and re-rolling
bad pages with an optional note. Runs entirely against local `src/` — **no worker
deploy needed to use it.**

## Launch

**Local book** (generated on this machine, present under `output/books/`):

```bash
node tools/review-station/server.js --dir output/books/<id>
# then open http://localhost:4600
```

**Prod book** (generated on the Fly worker; its per-page artifacts live in Storage under
`orders/<id>/review/` while the job is `awaiting_review`):

```bash
node tools/review-station/server.js --order <orderId>
```

`--order` **materialises** that order's `review/` tree from Supabase Storage to a
**transient temp dir** and runs against it exactly like a local book. The temp dir is
deleted when you close the station (see *Transient sessions* below), so a customer's page
illustrations and character portraits never persist locally past the review.

Flags:

| flag | default | meaning |
| --- | --- | --- |
| `--dir` | *(one of)* | book directory under `output/books/` (local book) |
| `--order` | *(one of)* | order id (prod book — materialise from Storage) |
| `--port` | `4600` | HTTP port |
| `--env-file` | `worker/.env.local` | env-file: pipeline API keys on re-render **and** the Supabase creds (`NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`) that `--order` reads to reach Storage |

**Credentials:** `--order` authenticates with the service-role key read from your local
`--env-file` (gitignored, never embedded in code). Point `--env-file` at the environment
whose books you're reviewing (prod for real orders).

## Transient sessions (`--order` only)

A materialised prod book is a copy of a real child's illustrations on the local machine, so
it must not outlive the review. Three guarantees:

1. **Delete-on-close** — `SIGINT` (Ctrl+C) / `SIGTERM` / `SIGBREAK` delete the temp dir and
   **verify** it is gone (via `existsSync`, not the unlink's own success).
2. **Orphan sweep on startup** — before doing anything else, the station removes temp dirs
   left by any previously-**crashed** session (SIGKILL / power loss / panic, where no
   handler runs). A session is orphaned when its owning PID is gone **or** its heartbeat
   (`.heartbeat`, touched every 30 s) is stale — the latter catches PID reuse. A live
   concurrent station keeps a fresh heartbeat and is spared.
3. **Location** — temp dirs live under the OS temp dir
   (`<tmp>/tuatale-review-sessions/session-pid<PID>-<rand>`), **never** under
   `output/books/`, so a materialised prod book can't be mistaken for a durable local book.

The sweep is what makes "transient" true even for a hard crash: the delete-on-close handler
is an optimisation on top of it. (Residual: a station killed and never restarted leaves its
temp dir until the next startup's sweep — or the OS's own temp cleanup.)

Zero dependencies beyond what the repo already has (Node built-in `http` +
`pdf-lib`). No `npm install`, no Express.

## Customer inputs panel

A collapsible panel above the pages shows **what the customer actually asked for**, so
likeness and accuracy can be judged against the brief instead of from memory. Two columns,
deliberately separated:

- **Customer provided** — their own words and choices, read from `meta.json` `inputs`:
  name, age, gender, book type, art style, reading level, age band, vibe, animal kind,
  appearance text, background/heritage, theme, dedication, plus a block per secondary
  (age, gender, relationship, subject type, appearance markers).
- **Pipeline generated** — what the pipeline wrote *from* that: the title, the resolved
  style string, and the Sonnet-authored protagonist/companion descriptions.

Keeping these apart is the whole point: the question is "did we honour the input", which
is unanswerable if given and derived values are mixed. Comparing the two columns makes a
divergence visible immediately (e.g. a customer's "tousled brown hair" rendered by the
physically-concrete rule as "straight brown hair in a blunt fringe").

**Reference photos** are shown at the top of the panel, served from `GET /photo/:key`.
Keys are whitelisted from `meta.json`, so no caller-supplied path is ever read.

**Explicit absence.** A field the pipeline never recorded renders as *"not captured"*, and
a photo whose file is not on this machine renders as *"reference photo not available
locally"* — never a blank. Silent absence would read as "the customer didn't say", which is
a different and review-corrupting claim. The panel header tallies both counts.

> **Older books show more "not captured".** `book_type`, `art_style`, `vibe` and
> `dedication_message` were added to `buildMetaObject` on 2026-07-22; books generated
> before that never recorded them. This is reported honestly rather than hidden.

## What you can do

Per page you see the **rendered image** (`pages/page-NN-rendered.png`), an
**editable narrative**, the **page number**, **template id**, **subjects**, and a
**strip of prior rolls**. Then:

- **✓ Approve / Un-approve** — toggles the page's status in `review-state.json`.
- **↻ Re-render image (~$0.04)** — shells the pipeline for that page only:
  ```
  node --env-file=<envFile> scripts/generate-book.js --book-dir <dir> --only-pages N --yes
  ```
  Re-rolls **only page N**, reuses the other 11. The image-render **note** (free
  text) is threaded into the prompt (see "Note-injection" below).
- **Save & re-lay text ($0)** — edit the narrative textarea and re-lay it over the
  **existing image** — no Gemini call:
  ```
  … --only-pages N --text-only --yes
  ```
  A live char counter validates against the template's `max_narrative_chars` and
  warns (doesn't block) on overflow.
- **Regenerate text (~1¢)** — Sonnet rewrites the narrative from an optional steer
  ("shorter / more playful / less repetitive"), respecting the age band + template
  char cap, then re-lays it over the existing image ($0 render). Needs the
  `--env-file` loaded (see below).
- **Prior rolls** — before every re-render (image **or** text) the page's current
  artifacts + narrative are snapshotted into `_history/page-NN/<id>/`. Click any
  thumbnail to **restore** it (swaps image + narrative back; the current version is
  snapshotted first so nothing is lost). Capped at ~10/page.
- **Finalize → stitch book.pdf** — enabled only when all 12 pages are approved.
  Merges the per-page PDFs (`pages/page-NN.pdf`) + any front-matter PDFs into
  `book.pdf` with `useObjectStreams:false` (**$0** — reuses the on-disk cover).

State lives in `<dir>/review-state.json` and is **resumable** across sessions.

### Text re-lay path (how $0 text updates render)

The re-lay reuses the pipeline's existing `resolveImageOverride` seam. The new
`--text-only` flag (with `--only-pages N`) makes `generate-book.js` return the
page's **existing raw image** (`pages/page-NN.png`) as the override, so
`renderPageWithTemplate` **skips the Gemini call** and just re-runs layout +
screenshot + PDF against the current `story.json` narrative. Additive and inert:
no flag → override stays `null` → byte-for-byte unchanged. It errors (never
silently pays for a Gemini roll) if `--only-pages` is missing or a raw image is
absent. The single pipeline-side change lives in `scripts/generate-book.js`; the
core render code is untouched.

### Text regen (Sonnet)

`src/anthropic.js` exports `rewriteNarrative({ currentText, note, age, maxChars })`
— a small plain-text Sonnet call (no story schema) that preserves the page's
events, matches the age band, obeys the char cap (one stricter retry if the first
draft overruns), and drops em/en dashes. The server loads the `--env-file` into
its own process at startup so this call has `ANTHROPIC_API_KEY`; if it can't, text
regen is disabled and the UI shows a banner (image + text-relay still work).

## Note-injection mechanism (how a note reaches the render)

The note is **not** a new CLI flag. It flows through a file the pipeline already
looks for, so the coupling is additive and inert when unused:

```
review station  ──writes──▶  <dir>/review-state.json   { "review_notes": { "7": "crisper faces…" } }
      │
      └─ shells ─▶  scripts/generate-book.js --book-dir <dir> --only-pages 7 --yes
                          │
                          ├─ reads review-state.json (if present)
                          ├─ builds pageDirectives = { 7: "crisper faces…" }   ← ONLY for pages being rendered
                          │
                          ▼
                   generateBook({ …, pageDirectives })
                          │  reviewNoteForPage(7) → "crisper faces…"
                          ▼
                   renderPageWithTemplate({ …, reviewNote })
                          ▼
                   buildScenePrompt({ …, reviewNote })
                          └─ appends, LAST in the prompt:
                             "REVISION NOTE FOR THIS PAGE (operator feedback — apply it…): crisper faces…"
```

Properties:

- **Opt-in / inert.** No `review-state.json`, no `review_notes`, or a note only
  for a page not being rendered → `pageDirectives` stays `null` → the prompt is
  byte-for-byte the pre-feature prompt. Safe to ship even undeployed.
- **Scoped to the pages being rendered.** Notes are only injected for pages in
  `--only-pages`, so an old note can't silently affect an unrelated re-roll.
- **Appended last** so it's the most recent instruction the model reads, framed
  explicitly as page-scoped operator feedback (it does not replace the wardrobe /
  reference-authority / crowd-framing directives — it rides after them).

The pipeline-side diff is small and additive: a `reviewNote` param on
`buildScenePrompt` + `renderPageWithTemplate` (`src/page-pipeline.js`), a
`pageDirectives` param on `generateBook` (`src/book-pipeline.js`), and the
review-state read in `scripts/generate-book.js`.

## Provenance guard (stale detection)

`review-state.json` stores an **image-provenance hash** per page: sha256 of the
scene's **image-relevant fields only** — `action`, `subjects_present`,
`template_id`, and `style` — and **excludes `narrative_text`**. If the current
image hash ≠ the stored hash, the page shows an **"image stale — re-render"**
chip. Excluding the narrative is deliberate: a **text edit/regen must not flag the
image stale** (the image didn't change). Editing image-relevant fields (action,
subjects, template) does flag it. Pages seen for the first time are baselined to
the current hash, so a freshly generated, unedited book shows no false flags.

## review-state.json shape

```json
{
  "book_dir": "2026-06-30-fishing-trio",
  "updated_at": "2026-07-02T…Z",
  "pages": {
    "1": { "status": "approved", "image_hash": "a1b2c3d4e5f6a7b8", "history": [] },
    "6": {
      "status": "pending",
      "image_hash": "eac5a98c1a873748",
      "keeper": "1782966824529-0",
      "history": [
        { "id": "1782966847822-1", "source": "pre-restore", "chars": 143, "template_id": "prompt-3-iter-2", "created_at": "…" },
        { "id": "1782966824529-0", "source": "text-edit",   "chars": 223, "template_id": "prompt-3-iter-2", "created_at": "…" }
      ]
    }
  },
  "review_notes": { "7": "crisper faces, characters larger in frame" },
  "rerolls": 3,
  "text_regens": 1,
  "est_cost_usd": 0.13
}
```

Per-history-entry artifacts live at `_history/page-NN/<id>/{page.pdf, rendered.png, entry.json}`
(the `entry.json` holds the full narrative for restore). `_history/` is under
`output/` and already gitignored.
