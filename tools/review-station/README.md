# Review Station

A local operator app for reviewing a generated book page-by-page and re-rolling
bad pages with an optional note. Runs entirely against local `src/` — **no worker
deploy needed to use it.**

## Launch

```bash
node tools/review-station/server.js --dir output/books/<id>
# then open http://localhost:4600
```

Flags:

| flag | default | meaning |
| --- | --- | --- |
| `--dir` | *(required)* | book directory under `output/books/` |
| `--port` | `4600` | HTTP port |
| `--env-file` | `worker/.env.local` | env-file passed to the pipeline on re-render (API keys + gated flags) |

Zero dependencies beyond what the repo already has (Node built-in `http` +
`pdf-lib`). No `npm install`, no Express.

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
