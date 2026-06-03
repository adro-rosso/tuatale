# Tuatale — website

[![CI](https://github.com/adro-rosso/tuatale/actions/workflows/ci.yml/badge.svg)](https://github.com/adro-rosso/tuatale/actions/workflows/ci.yml)

A personalized children's book platform. This is the customer-facing website
(landing → form → checkout → status). The book-rendering pipeline lives in
the sibling root of this repository (`../src/`, `../scripts/`, `../output/`)
and runs separately.

Phase 1 status: foundation only. Landing page with brand identity, no
customer flow yet. Phase 2 adds the customer form.

## Requirements

- **Node.js** ≥ 20 (Next.js 16 minimum). Tested on 24.x.
- **npm** ≥ 10.

## Local setup

```bash
cd website
npm install
cp .env.example .env.local
# Fill in real values for Supabase, Stripe (test mode), and Sentry.
npm run dev
```

The site runs at http://localhost:3000.

The `.env.local` file is gitignored — never commit it. Real keys come from
the Tuatale Supabase / Stripe / Sentry consoles; see `.env.example` for the
exact variable names.

## Architecture

- **Next.js 16** with App Router, TypeScript strict (+ `noUncheckedIndexedAccess` + `noImplicitOverride`).
- **Tailwind v4** with the design tokens defined in `lib/tokens.ts` and mirrored into `app/globals.css`'s `@theme` block. The mirror is enforced by `tests/tokens-sync.test.ts` — if the two drift, that test fails.
- **Fonts** loaded via `next/font/google`: EB Garamond italic 400 (headings + wordmark), Inter 400 (body). Both self-hosted; no Google network requests at runtime.
- **Supabase** Postgres + Storage for orders, draft state, and rendered artifacts (Phase 2+). Guest checkout only — no Supabase Auth.
- **Stripe** for checkout. Test mode at launch; live mode flip is Phase 5.
- **Sentry** for error tracking (Phase 1 Part 7).
- **Vercel** for hosting. Production = `main` branch, Preview = PR branches. Root Directory in Vercel project settings is set to `website` so only this subfolder is built.

## Folder structure

```
app/                      # Next.js App Router (layout, page, api routes)
  api/health/route.ts     # wiring smoke test for Supabase + Stripe
  globals.css             # Tailwind v4 @theme block + base body styles
  layout.tsx              # root layout, loads fonts, sets html lang
  page.tsx                # landing page
components/               # shared UI primitives
  Wordmark.tsx            # the tuatale wordmark
  ui/Button.tsx           # primary / secondary / ghost button
  ui/Heading.tsx          # h1/h2/h3 wrapper in EB Garamond
  ui/Body.tsx             # paragraph primitive
  ui/Container.tsx        # responsive max-width wrapper
lib/                      # framework-agnostic library code
  tokens.ts               # design tokens — TS source of truth
  supabase.ts             # browser + server client factories
  stripe.ts               # server-side Stripe client
db/                       # database migrations + queries (Phase 2+)
types/                    # shared TypeScript types (Phase 2+)
public/                   # static assets
tests/                    # vitest unit tests
  e2e/                    # playwright E2E tests (no tests yet)
  tokens-sync.test.ts     # asserts tokens.ts == @theme block
```

## Available scripts

| Script                 | What it does                                                             |
| ---------------------- | ------------------------------------------------------------------------ |
| `npm run dev`          | Start Next dev server with Turbopack                                     |
| `npm run build`        | Production build                                                         |
| `npm run start`        | Serve the production build locally                                       |
| `npm run lint`         | ESLint (flat config, extends `next/core-web-vitals` + `next/typescript`) |
| `npm run typecheck`    | `tsc --noEmit` against strict tsconfig                                   |
| `npm run format`       | Prettier write across the project                                        |
| `npm run format:check` | Prettier check (no writes); for CI                                       |
| `npm test`             | Vitest unit tests in jsdom                                               |
| `npm run test:watch`   | Vitest in watch mode                                                     |
| `npm run test:e2e`     | Playwright E2E tests (Chrome desktop + iPhone 14 + iPad)                 |

## Environment variables

See `.env.example`. Required for Phase 1:

- `NEXT_PUBLIC_SUPABASE_URL` — Supabase project URL
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` — Supabase anon (public) key, browser-safe
- `SUPABASE_SERVICE_ROLE_KEY` — Supabase service role key, server-only
- `STRIPE_SECRET_KEY` — Stripe test-mode secret key (`sk_test_…`), server-only
- `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` — Stripe test-mode publishable key (`pk_test_…`), browser-safe
- `NEXT_PUBLIC_SENTRY_DSN` — Sentry DSN (added during Phase 1 Part 7)

Vercel needs all of these set for both Production and Preview environments.

### Optional — Database integration tests (Phase 2.A onwards)

Integration tests under `tests/db/` run against a SEPARATE Supabase
project (`tuatale-test`) so production data is never at risk. They skip
automatically when the env vars aren't set, so CI stays green without
them.

- `TEST_SUPABASE_URL` — `tuatale-test` project URL
- `TEST_SUPABASE_SERVICE_ROLE_KEY` — `tuatale-test` service-role key
- `TEST_SUPABASE_DB_PASSWORD` — `tuatale-test` DB password (used to apply
  migrations: `npx supabase db push --db-url <connection string>`)

See `db/README.md` for the per-machine setup walkthrough.

### Optional — Sentry source map upload (Phase 1.5 onwards)

Stack traces in the Sentry dashboard are minified by default. To get
readable source paths (e.g. `app/api/health/route.ts:14`), set these three
in Vercel only — they're build-time secrets, never bundled into the
client. Source map upload skips gracefully when they're absent, so CI
and local builds don't need them.

- `SENTRY_AUTH_TOKEN` — Sentry "internal integration" token with
  `project:read`, `project:releases`, `org:read` scopes
- `SENTRY_ORG` — Sentry organisation slug (visible in the Sentry URL)
- `SENTRY_PROJECT` — Sentry project slug (also in the URL)

## Sentry verification

Trigger a deliberate error via the health route to verify Sentry is wired:

```bash
curl -i https://your-deployment.vercel.app/api/health?test_error=1
```

The request returns 500 and Sentry should capture the event within a minute.
This URL is meant for manual on-demand checking; no normal traffic ever hits
it.

## Database

Three tables in `public`, all service-role-only at v1 (RLS enabled, no
policies). Each draft / order / preview event flows through API routes
that authenticate the caller (cookie for drafts; Stripe signature for
orders; IP + cookie for preview events) before any DB call.

### `drafts`

Ephemeral form-in-progress state. 30-day expiry. Identified by an
anonymous `cookie_id`. Customer email captured at the preview step. The
multi-step form's progress marker (`current_step`) lets the UI resume
mid-flow.

When payment succeeds, `status` flips to `'converted'` and
`converted_to_order_id` records the linkage. Converted drafts are
retained as part of the forensic trail; everything else is deleted by
the daily `pg_cron` job (see migration `20260603120300_…`).

### `orders`

Permanent post-payment records. Retained forever for legal + business
needs. All customer / child / theme fields are snapshotted from the
draft at the moment of payment and never mutate afterwards. The
pipeline integration in Phase 4 mutates only the pipeline fields
(`pipeline_status`, `pipeline_started_at`, etc.) and the output URL
fields (`story_dir`, `book_pdf_url`).

`converted_from_draft_id` is a loose reference back to drafts — there's
no FK constraint, so the `pg_cron` cleanup can run independently of
order retention.

### `preview_events`

Append-only audit log of every preview-related event (request,
generation, threshold block, admin action). Drives rate-limit checks
and abuse-investigation queries. Composite indexes on
`(ip_address, created_at desc)` and `(customer_email, created_at desc)`
make 24h-window count queries fast at any table size.

`draft_id` is a loose reference back to drafts (no FK) so drafts can be
cleaned up without breaking event history.

### Schema relationships

```
drafts ──────────┐
  │              │ (loose ref, no FK)
  │ (loose ref,  ▼
  │  no FK) preview_events
  ▼
orders.converted_from_draft_id
```

No referential integrity is enforced at the FK level — the three loose
references (drafts → orders, drafts → preview_events) trade a small
amount of consistency policing for the freedom to clean up drafts on
their own schedule.

### Migration + types commands

| Script             | What it does                                                                                                                                   |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run db:push`  | Push pending migrations to the linked project (after `supabase link --project-ref <ref>`). Uses `SUPABASE_DB_PASSWORD` from env or prompts.    |
| `npm run db:types` | Regenerate `types/database.ts` from the linked project's live schema. Run after any migration to catch drift between the SQL and the TS types. |

Migrations live under `supabase/migrations/` and are SQL files named
`YYYYMMDDHHMMSS_short_description.sql`. Apply in order. See the
official Supabase CLI docs for `supabase migration new` if you'd rather
let the CLI generate the filename + skeleton.

For the `tuatale-test` project, apply migrations once per machine
setup with:

```bash
npx supabase db push --db-url "<test project connection string from dashboard>"
```

Re-apply whenever a new migration lands in `supabase/migrations/`.

## Recovery

If a customer's draft becomes unreachable (cookie points at a deleted
draft row after the `pg_cron` cleanup, or other inconsistent state),
they can visit `/start/reset` to clear the cookie and start fresh.

The Route Handler at `app/start/reset/route.ts` clears the
`tuatale_draft_id` cookie and redirects to `/start`, which the proxy
then catches to mint a brand-new draft + cookie.

This URL is also useful during development for testing the cold-start
flow — visit it between manual wizard runs to reset state without
fiddling with browser cookie tooling.

## Relationship to the pipeline at `../`

The book-rendering pipeline at the repo root (`../src/`, `../scripts/`,
`../output/`, etc.) is a separate Node project with its own `package.json`,
its own `.env`, and its own `node_modules`. The website and the pipeline
share a git repository but do not share installed packages or environment.

Phase 4 will introduce the integration: the website's order handler will
spawn a pipeline run as a child process. Until then, they're codebase
siblings that don't talk to each other.
