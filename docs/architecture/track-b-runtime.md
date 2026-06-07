# Track B Runtime Architecture

**Status:** Design spike (Cycle B.2). No code, no deployment.
**Author:** Claude Code session, 2026-06-07.
**Supersedes:** the runtime question raised in the B.1 audit, §6.
**Audience:** the spec that Track B coding cycles (B.3–B.5) build against.

---

## 0. Context and source-of-truth notes

This document resolves *where and how the DaBookTing pipeline executes* once it is
wired to the live website. It assumes the decisions Adro already made (see
Decision summary) and does not relitigate them.

### Grounding read in B.2.1

- `website/app/api/inngest/route.ts` — current serve endpoint (Vercel).
- `website/lib/inngest/client.ts` — Inngest client, app id `tuatale`.
- `website/lib/inngest/events.ts` — the two pipeline events.
- `website/lib/inngest/functions/run-pipeline-job.ts` — the current stub.
- `website/db/pipeline-jobs.ts` — the transition helpers.
- `website/lib/pipeline-constants.ts` — `STUB_PDF_URL`, `STUB_SLEEP_MS`.
- `website/lib/supabase.ts` — service-role client factory.
- The B.1 audit (in-conversation).

### Contradictions surfaced against the Track A contract

The Track A closing memo is canonical. Two things in it are now **out of date**
because of the Fly.io decision, and one path in the prompt is wrong:

1. **"The only website-side change is to replace the body of
   `runPipelineJobHandler`. Everything else stays."** — No longer true. With a
   separate Fly.io host, the function does not get its *body* swapped in place;
   it **moves off Vercel entirely**. The Vercel `/api/inngest` route and the
   `run-pipeline-job.ts` stub are **deleted**, and the function is
   re-implemented in the worker. Everything *downstream* of the function (the
   transition matrix, `pipeline_jobs` helpers, admin dashboard, ship email)
   genuinely does stay. This document treats that move as the central
   transition (§2, §6).

2. **The Inngest event does not carry the draft.** B.1 sketched
   `runPipeline({ orderId, draft })`, but the event payload
   (`pipeline/job.requested`) carries only `{ jobId, orderId }` (see
   `events.ts`). The worker therefore **fetches the order row** (the permanent
   draft snapshot) from Supabase by `orderId` and passes it in as `draft`. The
   B.1 signature is preserved; the *source* of `draft` is a DB read inside the
   handler, not the event. (§2, §3.)

3. **The memo file is not where the prompt says.**
   `project_tuatale-phase4-track-a-shipped.md` is not in `website/`; it lives
   only in the agent memory store. Cosmetic — the contract content is intact —
   but noting it so nobody hunts for a file that isn't there.

---

## 1. Decision summary

**Runtime host:** [Fly.io](https://fly.io), a **single Docker container**
(one Fly Machine), **Sydney region (`syd`)**. The container runs a small
long-lived Node HTTP server that exposes an Inngest serve endpoint and executes
the existing `src/` + `scripts/` pipeline in-process.

### Why Fly.io (recap)

The B.1 §6 blocker was that the pipeline cannot run in Vercel's serverless
runtime: it needs **headless Chromium (Puppeteer)** and **sharp** native
binaries, and a single book runs **~25–35 min** — well past serverless
function-duration ceilings, and a hostile place for a 200 MB Chromium layer.

Fly.io fits because it gives us:

- **A persistent, long-running process** — no per-invocation duration ceiling.
  A 30-minute book is just a long-running function on a normal server.
- **Full control of the OS image** — we install Chromium's system libraries and
  sharp's deps in a Dockerfile, the same way the pipeline already runs on a dev
  machine.
- **Sydney region** — co-located with the customer base and low-latency to the
  Supabase project (assuming Supabase is also AU/Sydney; confirm in B.5).
- **Cheap at launch volume** — a single small machine is single-digit to low
  double-digit dollars/month (§7).
- **A well-trodden Puppeteer-in-Docker path** — the Fly community has standard
  recipes; we are not inventing anything (§11).

Alternatives considered and rejected (briefly): **Vercel** (the blocker
itself); **AWS Lambda / container Lambda** (15-min hard ceiling, heavier ops);
**a Supabase Edge Function** (Deno, no Chromium, short ceiling); **a generic VPS**
(works, but we'd hand-roll deploy/secrets/restart that Fly gives us for free).

### Tradeoffs and known limitations

- **Serial throughput.** One machine processes one book at a time (§8). Fine at
  launch (1–10 books/week); revisit at volume.
- **Cross-package boundary.** The worker is a *third* package in the repo
  (`worker/`), separate from both the root pipeline (ESM JS) and `website/`
  (Next/TS). It imports the pipeline directly from `../src` but **cannot**
  import the website's TypeScript `db/pipeline-jobs.ts` (different tsconfig,
  `@/` path aliases, build step). The worker re-implements the *three*
  transitions it needs in plain JS against the same table (§3, `worker/src/db.js`).
  This is deliberate duplication; the transition matrix is small and stable.
- **A second deploy target.** We now operate Vercel **and** Fly. Two dashboards,
  two secret stores, two logs streams (mitigated by sending both to one Sentry
  project, §4).
- **Inngest step-duration ceiling still applies.** Moving off serverless removes
  the *platform* duration limit, but Inngest itself caps how long a single step
  may run. We keep steps coarse-but-bounded and confirm the ceiling in B.5
  (§11). This is the one remaining "unknown" in the long-run model, and it is an
  Inngest-config question, not a host question.

---

## 2. End-to-end request flow

### The "where does each Inngest function live" question (the interesting part)

Inngest has two halves, and only one of them moves:

| Capability | Needs | Today | After Track B |
|---|---|---|---|
| **Send** events (`inngest.send(...)`) | `INNGEST_EVENT_KEY` only — no HTTP endpoint | Vercel (Stripe webhook, admin retry) | **stays on Vercel** |
| **Serve / execute** the function (`/api/inngest`, runs `runPipelineJob`) | An always-reachable HTTP endpoint + heavy deps | **Vercel** `app/api/inngest/route.ts` | **moves to Fly.io** `worker/src/server.js` |

So: the website keeps `lib/inngest/client.ts` and `lib/inngest/events.ts` purely
to **send** events. The **execution** of `run-pipeline-job` — the handler and its
`onFailure` — is deleted from Vercel and re-implemented on the Fly worker, which
serves the same app (`tuatale`) and the same function id (`run-pipeline-job`)
from its own `/api/inngest` endpoint. Inngest Cloud is told the app's endpoint
URL is now the Fly URL (§6). Because events are addressed by **name**
(`pipeline/job.requested`), the website's send code does not change at all — only
the endpoint that receives them does.

### Full flow (text diagram)

```
  Customer completes Stripe Checkout
        │
        ▼
  Stripe → POST /api/stripe/webhook        ┐
        • verify signature + idempotency   │
        • createOrderFromDraft()           │  VERCEL (website) — unchanged
        • pipelineJobs.createJob(orderId)  │  (Cycle A.3)
        • inngest.send('pipeline/job.requested', { jobId, orderId })
        │                                  ┘
        ▼
  INNGEST CLOUD  (app: tuatale, keypair unchanged)
        • durably queues the event
        • invokes the function endpoint over HTTP
        │
        ▼
  FLY.IO worker  POST /api/inngest         ┐
   run-pipeline-job handler:               │
     step "mark-running":                  │
        db.markRunning(jobId, {evt,run})   │  ← writes pipeline_jobs (service role)
     step "run-pipeline":                  │
        order  = db.getOrderById(orderId)  │  ← fetch draft snapshot
        input  = adapter(order)            │  ← §B.1.4 mapping
        story  = generateStory(input)      │  ← src/anthropic.js  (Sonnet)
        result = generateBook({story,...}) │  ← extracted from generate-book.js
                                           │     (Gemini + Puppeteer + sharp + merge)
        pdfUrl = storage.upload(orderId,…) │  ← Supabase Storage
     step "mark-awaiting-review":          │  WORKER (Fly) — new in Track B
        db.markAwaitingReview(jobId,{pdfUrl, generationMetadata})
   onFailure (after retries exhausted):    │
        db.markFailed(jobId, {message,details})
        │                                  ┘
        ▼
  ADMIN dashboard (Vercel) — unchanged (Cycle A.4)
        • job appears in "awaiting review" with the real pdf_url
        • admin reviews the PDF, clicks Ship
        • shipJobAction → markShipped + sendEmail (Resend)   (Cycle A.5)
        │
        ▼
  Customer receives ship-notification email with a signed PDF link
```

Everything in the **VERCEL** and **ADMIN** boxes already exists and is untouched
by Track B. Track B builds the **FLY.IO worker** box and re-registers the
endpoint.

---

## 3. Repository structure

A new `worker/` folder at the repo root, a sibling of `src/`, `scripts/`, and
`website/`. The worker has its **own** `package.json` and `node_modules`, the
same isolation pattern `website/` already uses (shared git, separate package).

```
DaBookTing/
├── src/                 # EXISTING pipeline core — unchanged, imported by worker
├── scripts/             # EXISTING; generate-book.js gets its orchestration
│                        #   EXTRACTED into src/ in B.3 (see note below)
├── templates/           # EXISTING; required at runtime, copied into the image
├── website/             # EXISTING Next app (Vercel) — sends events only
└── worker/              # NEW (Track B)
    ├── package.json
    ├── Dockerfile
    ├── fly.toml
    ├── .dockerignore
    └── src/
        ├── server.js        # HTTP server + /api/inngest endpoint
        ├── inngest.js        # worker's Inngest client + function definition
        ├── run-pipeline.js   # runPipeline({ orderId, draft }) → { pdfUrl, metadata }
        ├── adapter.js        # order/draft → pipeline-input mapping (§B.1.4)
        ├── storage.js        # Supabase Storage upload helper
        └── db.js             # service-role Supabase client + the 3 transitions
```

> **Where does `generateBook()` live?** B.1 found the sheet-mint / per-page /
> merge orchestration lives **inline in the module body** of
> `scripts/generate-book.js`. B.3 extracts it into an importable function. The
> cleanest home is a **new module in the root `src/`** (e.g.
> `src/book-pipeline.js`, exporting `generateBook(...)`), because it belongs to
> the pipeline, not the worker, and keeps `worker/` thin (worker = transport +
> glue, `src/` = pipeline). `scripts/generate-book.js` then becomes a thin CLI
> shim over the same function (preserving the manual `--story-path` workflow).
> The worker imports `generateBook` from `../src/book-pipeline.js`. Final
> placement is B.3's call; this document only requires that it be importable.

### `worker/package.json`

Its own dependency set. Production deps:

- `inngest` — serve the function (uses `inngest/express` or `inngest/node`).
- `express` — the HTTP server (smallest, best-documented Inngest adapter path).
- `@supabase/supabase-js` — service-role DB writes + Storage upload.
- `@sentry/node` — error reporting.
- The **pipeline's existing deps**, because the worker runs the pipeline
  in-process: `@anthropic-ai/sdk`, `@google/genai`, `puppeteer`, `sharp`,
  `pdf-lib`, `pdfkit`, `undici`, `dotenv`.

Two viable dependency strategies (decide in B.5):

- **(a) Duplicate the pipeline deps in `worker/package.json`** and let the
  worker resolve `../src/*` imports against its own `node_modules`. Simple,
  self-contained image; the pipeline deps are listed in two places.
- **(b) npm workspaces** at the repo root so `worker/` and the root pipeline
  share one install. Cleaner dependency story; adds a root-level workspace
  config that touches the existing root `package.json`.

Recommendation: **(a)** for v1 — it keeps the Dockerfile build context simple
(`worker/` + `src/` + `templates/`) and avoids editing the root package during a
runtime-focused cycle. Revisit if drift becomes annoying.

`"type": "module"` to match the pipeline's ESM (`src/` is ESM).

### `worker/Dockerfile`

- **Base image:** `node:20-slim` (Debian slim — Puppeteer's apt deps are
  well-documented on Debian; Alpine/musl is a known Puppeteer headache).
  Node 20 matches the pipeline's assumptions.
- **System deps for Puppeteer:** the standard Chromium runtime libraries
  (`libnss3`, `libatk-bridge2.0-0`, `libdrm2`, `libxkbcommon0`, `libgbm1`,
  `libasound2`, fonts, etc.). Either install Puppeteer's bundled Chromium and
  its libs, or `apt-get install chromium` and point Puppeteer at it via
  `PUPPETEER_EXECUTABLE_PATH`. Exact list finalized in B.5 from the Fly/Puppeteer
  recipe (§11).
- **sharp:** prebuilt binaries install cleanly on `node:20-slim` (glibc); no
  extra apt deps typically needed. Confirm in B.5.
- **Build steps:** copy `worker/package.json` → `npm ci` → copy `worker/src`,
  `../src`, `../templates` into the image → set env → `CMD ["node", "src/server.js"]`.
- **Build context:** the repo root (so `src/` and `templates/` are reachable),
  with `.dockerignore` doing the heavy lifting.
- **Fonts:** `page-pipeline.js` renders via Puppeteer with template HTML that
  references fonts. B.1 noted fonts are absolute `https://` URLs — so the
  container needs **outbound network at render time** (it has it) and we must
  confirm no template depends on a locally-installed font. If any do, add the
  font package to the image. Flagged for B.5 verification.

### `worker/src/server.js`

A minimal Express app:

- `GET /healthz` → `200` for Fly health checks.
- `GET|POST|PUT /api/inngest` → `serve({ client, functions: [runPipelineJob] })`
  from `inngest/express`.
- Initializes Sentry at process start.
- Listens on `process.env.PORT` (Fly convention) — default `8080`.

### `worker/src/run-pipeline.js`

The wrapped pipeline. **Signature** (preserves B.1):

```js
// runPipeline({ orderId, draft }) → Promise<{ pdfUrl, metadata }>
//   draft = the orders row (permanent draft snapshot), fetched by the handler.
```

Responsibilities, in order:

1. `input = adaptDraftToPipelineInput(draft)` — §B.1.4 mapping (adapter.js).
2. `{ story, usage } = await generateStory(input)` — `src/anthropic.js`, unchanged.
3. `{ bookPdfBytes, summary } = await generateBook({ story, meta, childName,
   childAge, outputDir: scratchDir })` — extracted orchestration.
4. `pdfUrl = await uploadBookPdf({ orderId, bytes: bookPdfBytes })` — storage.js.
5. `return { pdfUrl, metadata: { ...summary, tokens: usage } }`.

**Error contract:** any failure **throws** (never `process.exit`). The thrown
error propagates to the Inngest step, which retries per the function's
`retries: 2`. After retries exhaust, the worker's `onFailure` calls
`db.markFailed`. The worker must run the pipeline with **auto-confirm on**
(`AUTO_CONFIRM=1` or the extracted function's equivalent) so no interactive
`readline` gate blocks an unattended run (B.1 §3).

**Scratch directory:** a per-job temp dir (e.g. `os.tmpdir()/tuatale/<jobId>`),
**not** the repo's `output/`. Cleaned up after upload (success or failure) so the
container's disk doesn't grow unbounded across books.

### `worker/src/adapter.js`

The order/draft → pipeline `--input` mapping. Per Adro's ratified secondary
rules and B.1 §4:

- **Protagonist** maps cleanly: `child_name → name`, `child_age → age`
  (already an integer via `ageFromRange`), `child_gender → gender`,
  `child_appearance → appearance`.
- **Secondaries** (the gappy part):
  - `appearance` → `appearance_markers` (rename).
  - **`anchor`:** humans → always `tier2`; non-humans → `tier1` **unless**
    `extra_care` is set, which flips them to `tier2`. (Adro's rule.)
  - **`age`:** defaulted internally, not customer-facing (Adro's rule). The
    adapter assigns a sensible default per `subject_type`/`relationship`
    (e.g. humans default to the protagonist's age bucket; pets/toys get a
    nominal small integer the pipeline accepts). Exact defaults are B.4's call;
    they are invisible to the customer and only satisfy the pipeline's
    `age: positive int` requirement.
  - `extra_care` is consumed for the anchor decision, then dropped.
  - `id` synthesized as `companion-N`.
- Validates the produced object against the pipeline's input expectations before
  returning, so a bad mapping fails *in the adapter* with a clear message rather
  than deep inside `generateStory`.

### `worker/src/storage.js`

Supabase Storage upload helper (§5). Uploads the PDF bytes to
`tuatale-books/orders/{orderId}/book.pdf`, returns a **signed URL** (7-day
expiry). Uses the service-role client from `db.js`.

### `worker/src/db.js`

- Constructs a service-role Supabase client from `SUPABASE_URL` +
  `SUPABASE_SERVICE_ROLE_KEY` (the worker is not Next, so no `NEXT_PUBLIC_`
  prefix — see §4).
- Re-implements, in plain JS against the **same `pipeline_jobs` table**, exactly
  the transitions the worker needs:
  - `markRunning(jobId, { inngestEventId, inngestRunId })`
  - `markAwaitingReview(jobId, { pdfUrl, generationMetadata })`
  - `markFailed(jobId, { errorMessage, errorDetails })`
  - plus a read: `getOrderById(orderId)`.
- These mirror the semantics in `website/db/pipeline-jobs.ts` (same target
  statuses, same fields per edge). The worker does **not** need the full
  transition matrix or the admin-only transitions (`markShipped`,
  `markCancelled`, `updateReviewNotes`, notification helpers) — those stay on the
  website.
- **Design note for B.5:** the website stub calls `markRunning` for *both*
  `requested` and `retried` events. The DB layer has a dedicated `retry()`
  (failed→running, increments `attempt_count`). The worker should call `retry()`
  on `pipeline/job.retried` so `attempt_count` is bumped correctly, and
  `markRunning` on `pipeline/job.requested`. Small fidelity improvement over the
  stub; flagged so B.5 does it deliberately.

### `worker/.dockerignore`

Keep the image lean and the build context sane. Exclude:

- `output/`, `output-run*/` (gigabytes of generated books — never ship these).
- `**/node_modules` (rebuilt in-image via `npm ci`).
- `website/` (not needed by the worker at all).
- `.git`, `recraft-spike/`, `research-notes/`, `templates/**/*.pdf`,
  `templates/**/*.png` test artifacts, `SESSION_NOTES.md`, `*.docx`, the root
  `scripts/` test files — anything the runtime pipeline doesn't read.
- Note: `templates/<id>/config.json` + `template.html` **are** needed; the
  `.dockerignore` must exclude template *test artifacts* without dropping the
  configs/HTML the registry loads.

---

## 4. Environment variables

The worker needs the following. All injected as **Fly secrets**
(`fly secrets set KEY=value`), which Fly stores encrypted and exposes as env vars
to the running machine. None live in the image.

| Var | Purpose | Source / same as |
|---|---|---|
| `SUPABASE_URL` | DB writes + Storage | **Same value** as Vercel's `NEXT_PUBLIC_SUPABASE_URL`, without the `NEXT_PUBLIC_` prefix (worker isn't Next). |
| `SUPABASE_SERVICE_ROLE_KEY` | service-role DB + Storage writes | Same value as Vercel's `SUPABASE_SERVICE_ROLE_KEY`. |
| `SUPABASE_STORAGE_BUCKET` | bucket name | **New.** Recommended `tuatale-books` (§5; ratify). |
| `ANTHROPIC_API_KEY` | Sonnet (story-gen) | Same Anthropic key the pipeline already uses (`.env.example`). |
| `GEMINI_API_KEY` | Gemini (image-gen) | Same Gemini key the pipeline already uses. |
| `INNGEST_EVENT_KEY` | (optional on a pure serve host) sending events | **Same** value as Vercel — Inngest is one app, one keypair. The worker mainly *serves*, but having the key set is harmless and future-proofs worker-initiated sends. |
| `INNGEST_SIGNING_KEY` | verify inbound Inngest webhooks at `/api/inngest` | **Same** value as Vercel. This is the load-bearing one for the worker. |
| `SENTRY_DSN` | error reporting | **Same project** as the website (recommendation — unified observability), distinguished by `release`/`server_name` tag (§11, ratify). |
| `PORT` | HTTP listen port | Fly-provided / `8080`. |
| `AUTO_CONFIRM` | bypass the pipeline's interactive CONFIRM gate | Set to `1`. |
| `PUPPETEER_EXECUTABLE_PATH` | point Puppeteer at the image's Chromium | Set in Dockerfile/secrets per the B.5 Puppeteer recipe. |

**`fly secrets set` workflow:**

```bash
fly secrets set \
  SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… SUPABASE_STORAGE_BUCKET=tuatale-books \
  ANTHROPIC_API_KEY=… GEMINI_API_KEY=… \
  INNGEST_EVENT_KEY=… INNGEST_SIGNING_KEY=… \
  SENTRY_DSN=… AUTO_CONFIRM=1
```

Setting secrets triggers a rolling restart of the machine so the new values take
effect. Secrets are write-only via the CLI (you can list names with
`fly secrets list`, but not read values back) — store the canonical copy in
whatever vault Adro already uses for the Vercel values.

---

## 5. Supabase Storage strategy

- **Bucket:** `tuatale-books` — a **new, dedicated** bucket, separate from any
  future `customer-photos` bucket (the deferred Phase 3.A child-photo
  workstream). Keeping generated output and customer-supplied input in separate
  buckets means their access policies and retention can diverge without
  entangling them.
- **Path convention:** `orders/{orderId}/book.pdf` — **order-id-based, not
  job-id-based.** There is one final PDF per order; a regenerate/retry should
  **overwrite** the previous PDF at the same path (`upsert: true`), so the
  customer's link and the admin view always point at the latest book. (If we ever
  want to retain prior versions, that's a path-suffix change later — not v1.)
These are **two independent decisions** — keep them mentally separate, because
they have different owners and different review triggers:

- **(a) URL expiry — how long a given customer link stays valid.** **Signed URLs,
  7-day expiry.** This matches the Cycle A.5 ship-notification email's implicit
  contract (the customer clicks a PDF link from the email). 7 days comfortably
  covers email-read latency without leaving a permanently public link to a
  personalized children's book floating around. The signed URL is generated at
  upload time and stored in `pipeline_jobs.pdf_url` / `orders.book_pdf_url`.
  - *Consequence:* a signed URL expires, but **the file does not**. If a customer
    revisits the link after 7 days, the admin re-signs a fresh 7-day URL from the
    same, still-present Storage object (a small "regenerate link" action; worth a
    one-line note in the admin UI later — not Track B). URL expiry is a
    *link-lifetime* knob, not a *data-deletion* knob.
- **(b) File retention — how long the PDF object itself lives in Storage.**
  **Retained indefinitely for v1.** The Storage object is **never auto-deleted**;
  only signed URLs to it come and go. This is what makes on-demand link
  regeneration (above) possible at any time. Revisit when the legal review for
  the child-photo workstream lands, since that review will set the broader
  data-retention policy.

  > The distinction matters: "the link expired" (expected, every 7 days, fixed by
  > re-signing) is a completely different event from "the file was deleted"
  > (never happens in v1). Conflating them would make admin think a routine link
  > expiry is data loss.
- **RLS / access:** **service-role-only.** The worker uploads with the service
  role; the admin reviews through the website (also service role); the customer
  never touches Storage directly — they only ever receive a signed URL. No
  anon/authenticated policies on `tuatale-books` at v1 (same fail-closed posture
  as the `drafts`/`orders` tables).

---

## 6. Inngest re-registration

Inngest Cloud currently knows the `tuatale` app via the Vercel endpoint
`https://tuatale.vercel.app/api/inngest`. The migration points it at the worker.

**Key fact (confirmed against the SDK + Inngest's model):** an Inngest "app" is
identified by the client `id` (`tuatale`) and the **signing key**, *not* by its
URL. Moving the serve endpoint to a new URL, with the **same app id and the same
signing key**, is a supported operation — events addressed by name keep flowing;
only the endpoint that executes them changes. The website's *send* path
(`inngest.send`) is unaffected.

**Migration (happens in B.5, not before):**

1. Deploy the worker to Fly with the **same** `INNGEST_SIGNING_KEY` /
   `INNGEST_EVENT_KEY` and an Inngest client whose `id` is `tuatale`,
   serving function id `run-pipeline-job`.
2. In the Inngest dashboard, **sync the new endpoint URL**
   (`https://<fly-app>.fly.dev/api/inngest`). Recommended approach: **replace the
   existing `tuatale` app's endpoint URL** rather than registering a second app —
   one app, one function id, new URL. (Registering a *new* app would duplicate
   the function and split run history; avoid.)
3. Verify the worker shows healthy + the function is registered in the dashboard.
4. **Delete** `website/app/api/inngest/route.ts` and
   `website/lib/inngest/functions/run-pipeline-job.ts` (the stub) +
   `lib/pipeline-constants.ts`'s stub constants once nothing references them.
   Keep `lib/inngest/client.ts` and `events.ts` (still used to *send*).
5. Run one real paid test purchase end-to-end.

**Before B.5,** the worker can be developed and tested in **isolation**:

- Locally against the Inngest **dev server** (`npx inngest-cli dev`), which
  auto-discovers the worker's `/api/inngest` and lets you fire
  `pipeline/job.requested` manually with a real `jobId`/`orderId` from a seeded
  test order. No Vercel involvement, no production Inngest sync.
- This means B.3/B.4 (and most of B.5) need **no** production re-registration;
  the endpoint swap is the very last step.

---

## 7. Cost ceiling

Fly bills per-machine for CPU/RAM plus small Storage/egress.

- **Floor:** `shared-cpu-1x` / 256 MB ≈ $2/mo — **too small**; Chromium + sharp
  will OOM.
- **Recommended launch size:** **`shared-cpu-2x` / 2 GB RAM ≈ ~$11/mo.** A
  middle ground that comfortably holds one Puppeteer Chromium + sharp's working
  set for a single serial book, without paying for a dedicated CPU we can't yet
  justify.
- **Upgrade path if profiling shows OOM or CPU saturation:** `dedicated-cpu-2x`
  / 4 GB ≈ ~$30/mo. Only after B.5 profiling, not pre-emptively.

**`fly.toml` resource settings (illustrative — finalized in B.5):**

```toml
app = "tuatale-worker"           # ratify name (§12)
primary_region = "syd"

[build]
  dockerfile = "Dockerfile"

[http_service]
  internal_port = 8080
  force_https = true
  auto_stop_machines = false      # keep warm — see §8
  auto_start_machines = true
  min_machines_running = 1        # exactly one always-on machine (serial v1)

[[vm]]
  size = "shared-cpu-2x"
  memory = "2gb"
```

Plus the ~200 MB Chromium image layer (well under Fly's image size limits, §11)
and negligible Supabase Storage cost (each book PDF is ~10 MB; even hundreds of
books are pennies).

---

## 8. Concurrency model

- One book takes **~25–35 min** (B.1 measured a single-protagonist floor of
  ~6.5 min; multi-character books with escalations run far longer).
- **v1 decision: serial, single machine.** `min_machines_running = 1`,
  `auto_stop_machines = false` (keep the one machine warm so there's no
  cold-start and, critically, **no risk of Fly stopping the machine mid-book**).
- **Enforce serialization at the Inngest layer too:** set
  `concurrency: { limit: 1 }` on the `run-pipeline-job` function. This guarantees
  Inngest runs at most one book at a time and **queues** the rest, regardless of
  machine count — so even a momentary second machine can't double-run. The
  customer of a queued job simply waits; no data loss, no contention.
- At launch volume (1–10 books/week) serial is comfortable: even 10 books ×
  35 min ≈ 6 machine-hours/week against a 168-hour week.

**Scale-out, deferred until a volume signal (50+ books/week):** options, in
rough order of preference —
1. Raise the Inngest `concurrency.limit` and run **multiple Fly machines** (Fly
   scales horizontally trivially; Inngest load-balances across the synced
   endpoints / the function's concurrency budget).
2. In-machine concurrency (run 2–3 books per machine) — only if a bigger machine
   is cheaper than more machines; risk is Chromium memory multiplied.
3. Fly autoscaling to spin machines up/down with queue depth.

We do **not** build any of this now. The doc records the path so the decision is
ready when the signal arrives.

---

## 9. Failure modes

All of these resolve against handling that **already exists on the website side**
(the transition matrix + `onFailure` + admin dashboard). No new website code is
required for any of them; the worker just has to throw and let Inngest do its job.

| Failure | What happens | Recovery | Pre-existing handling |
|---|---|---|---|
| **Inngest can't reach the worker** (Fly machine down/restarting) | Inngest's invocation fails to connect; the event stays durably queued and Inngest retries with backoff | Machine comes back (Fly restarts it; `min_machines_running=1`), Inngest re-delivers. Customer waits longer; **no data loss** | Inngest queue durability (platform) |
| **Pipeline throws mid-book** (bad input, API refusal, region-detect failure on all templates) | The `run-pipeline` step rejects → Inngest retries (`retries: 2`) | If transient, a retry succeeds. If deterministic, retries exhaust → `onFailure` | `runPipelineJobOnFailure` → `markFailed` (re-implemented in worker) |
| **Worker process crashes mid-pipeline** (OOM, segfault in Chromium/sharp) | The HTTP request dies; Inngest sees a failed attempt and retries | Same retry budget; if it keeps OOMing, bump machine RAM (§7) | Inngest `retries: 2`, then `onFailure` → `markFailed` |
| **Supabase Storage upload fails** | `storage.upload` throws inside the run step → treated as a pipeline failure | Retried with the rest of the step | Same as "pipeline throws" |
| **DB transition fails** (e.g. `markAwaitingReview` after a successful render) | Step throws; Inngest retries the step. Because `step.run` results are cached, the *expensive* render is **not** re-run on retry — only the failed mark step re-executes | Idempotent retry | Inngest step caching + the transition helpers |
| **All retries exhausted** | `onFailure` runs once | Worker calls `db.markFailed(jobId, …)`; job shows **failed** in admin, admin can re-trigger (`pipeline/job.retried`) | Admin dashboard (Cycle A.4) + `retry()` edge |

Two worker-specific notes:

- **Idempotency for free:** because the handler is split into `step.run`
  boundaries (mark-running / run-pipeline / mark-awaiting-review), Inngest caches
  completed steps. A retry after a successful render but failed final mark does
  **not** regenerate the book — exactly the Track A design intent, preserved.
- **Partial book on the machine's disk** after a crash is harmless — the scratch
  dir is per-job and cleaned on the next attempt / on success; nothing
  customer-visible is written until the Storage upload + `markAwaitingReview`.

---

## 10. Track B coding cycles (B.3 – B.5)

Each cycle is bounded and self-contained. B.3 and B.4 involve **no Fly.io and no
production wiring** — they are pure pipeline/library work, testable locally.

### B.3 — Extract `generateBook()`
- Lift the sheet-mint / per-scene-render / pdf-lib-merge orchestration out of the
  module body of `scripts/generate-book.js` into an importable function
  (proposed `src/book-pipeline.js`, exporting `generateBook(...)`).
- It takes objects (story, meta, child name/age, output dir), **returns**
  `{ bookPdfBytes, summary }`, **throws** on error, never `process.exit`, never
  reads `argv`, runs with auto-confirm.
- `scripts/generate-book.js` becomes a thin CLI shim over it (manual workflow
  preserved).
- **Verification:** byte-/page-identical output against an existing
  `output/books/<id>` fixture (e.g. `2026-06-01-elena-1500`), at **$0** — reuse
  the on-disk character sheets and stub/mocks for Gemini so no paid calls fire.
- No Fly.io.

### B.4 — Adapter + storage helper + `runPipeline()` assembly
- Write `worker/src/adapter.js` (the §B.1.4 mapping with Adro's ratified
  secondary rules — anchor logic + internal age defaults).
- Write `worker/src/storage.js` (Supabase Storage upload → signed URL).
- Write `worker/src/db.js` (service-role client + `markRunning`,
  `markAwaitingReview`, `markFailed`, `getOrderById`).
- Assemble `worker/src/run-pipeline.js` (`runPipeline({ orderId, draft })`)
  composing adapter → `generateStory` → `generateBook` → upload.
- **Verification:** unit-test the adapter against representative order rows;
  integration-test `runPipeline` against the **`tuatale-test`** Supabase project
  with Gemini/Sonnet mocked (or one gated real run per the probe-before-build
  rule). One real paid book is **optional** here and gated.
- Still no Fly.io.

### B.5 — Wire it up + deploy + go live
- Write `worker/Dockerfile`, `worker/fly.toml`, `worker/.dockerignore`.
- Write `worker/src/server.js` + `worker/src/inngest.js` (serve the function,
  `concurrency: { limit: 1 }`, `retries: 2`, `onFailure → markFailed`).
- Resolve the Puppeteer-in-Docker recipe (§11) and verify a render in-container.
- Deploy to Fly (`fly launch` / `fly deploy`), set secrets (§4).
- Test in isolation against the Inngest dev server + a seeded test order.
- **Re-register** the `tuatale` app's endpoint to the Fly URL (§6); **delete**
  the Vercel `/api/inngest` route + the stub.
- **One real paid test purchase, end-to-end** (the only intentionally-paid step;
  gated, per probe-before-build).

---

## 11. Open questions / known unknowns

- **Puppeteer in Docker — which Chromium?** Bundled Puppeteer Chromium vs
  `apt-get install chromium` + `PUPPETEER_EXECUTABLE_PATH`. Both are standard on
  Fly; pick during B.5 from the well-known Fly/Puppeteer recipe. Not a blocker,
  just unselected.
- **Fonts at render time.** Confirm no template depends on a locally-installed
  font (B.1 saw absolute `https://` font URLs, which need only outbound network —
  which the container has). If any template references a system font, add the
  font package to the image. Verify in B.3/B.5 by diffing a containerized render
  against a fixture.
- **Inngest step-duration ceiling.** Moving off serverless removes the *platform*
  limit, but Inngest caps single-step duration. Keep steps coarse-but-bounded
  (mark / run / mark) and confirm the run-step ceiling for our plan in B.5; if a
  full book exceeds it, split the render into finer steps (per-page
  `step.run`s) — the pipeline already renders page-by-page, so this is a clean
  fallback. **This is the one real long-run unknown.**
- **Inngest signing key across endpoints.** Same app id + same signing key, new
  URL = supported (§6). Confirmed against the SDK's key-from-env model; re-verify
  empirically during the B.5 sync.
- **Sentry: same project vs separate.** Recommend **same** project, with worker
  events tagged by `release` / `server_name` so website vs worker errors are
  filterable in one place (§12 ratify).
- **Image size.** Chromium adds ~200 MB; total image likely 400–600 MB. Fly's
  limits are generous (multi-GB). Not blocking — measure in B.5.
- **Supabase region.** Assumed AU/Sydney to pair with Fly `syd`. If the Supabase
  project is elsewhere, latency on DB writes + Storage upload grows (tolerable
  for a 30-min batch job, but confirm).

---

## 12. Decisions — RATIFIED (Adro, 2026-06-07)

All six ratified. Recorded here as the decision log B.3–B.5 build against.

1. **Storage bucket name** — ✅ **`tuatale-books`** (new, dedicated bucket).
   Separate from any future `customer-photos` bucket.

2. **PDF retention** — ✅ **two distinct decisions** (see §5):
   - *URL expiry:* signed URLs, **7-day** expiry, for customer access.
   - *File retention:* underlying Storage object **retained indefinitely**, so
     admin can regenerate a fresh signed URL on demand at any time.
   - The docs (§5) explicitly distinguish "URL expiry" (routine, every 7 days,
     fixed by re-signing) from "file retention" (file never auto-deleted in v1).
     Revisit file retention when the child-photo legal review lands.

3. **Fly machine size at launch** — ✅ **`shared-cpu-2x` / 2 GB** (~$11/mo) as the
   starting point. **Documented upgrade path:** `dedicated-cpu-2x` / 4 GB
   (~$30/mo) if B.5 testing surfaces OOM or CPU saturation. Upgrade only on
   profiled evidence, not pre-emptively (§7).

4. **Sentry** — ✅ **single project**, website vs worker distinguished by
   `release` tag.

5. **Machine lifecycle** — ✅ **always-warm**: `min_machines_running = 1`,
   `auto_stop_machines = false`. No auto-stop (a 30-min job must never be stopped
   underneath itself).

6. **Worker dependency strategy** — ✅ **duplicate pipeline deps in
   `worker/package.json`**, no npm workspaces for v1. Revisit if drift bites.

**Carried-forward known-unknown (not a ratification):** the Inngest single-step
duration cap (§11) is confirmed empirically in B.5; per-page `step.run` is the
documented fallback if a full book exceeds the cap.

---

*End of Track B runtime architecture (Cycle B.2 — closed, decisions ratified
2026-06-07).*
