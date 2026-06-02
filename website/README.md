# Tuatale — website

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

## Sentry verification

Trigger a deliberate error via the health route to verify Sentry is wired:

```bash
curl -i https://your-deployment.vercel.app/api/health?test_error=1
```

The request returns 500 and Sentry should capture the event within a minute.
This URL is meant for manual on-demand checking; no normal traffic ever hits
it.

## Relationship to the pipeline at `../`

The book-rendering pipeline at the repo root (`../src/`, `../scripts/`,
`../output/`, etc.) is a separate Node project with its own `package.json`,
its own `.env`, and its own `node_modules`. The website and the pipeline
share a git repository but do not share installed packages or environment.

Phase 4 will introduce the integration: the website's order handler will
spawn a pipeline run as a child process. Until then, they're codebase
siblings that don't talk to each other.
