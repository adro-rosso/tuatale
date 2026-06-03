# `db/` — query helpers

Typed wrappers around the Supabase client. One file per table. Each file
exports a small set of named functions that:

1. Take an explicit Supabase client as the LAST parameter (defaults to
   `createServerClient()`) — this is the dependency-injection seam tests
   use to point queries at the `tuatale-test` project.
2. Surface a single `DatabaseError` from `db/errors.ts` on failure —
   route handlers and server actions handle one typed exception instead
   of inspecting Supabase response shapes.
3. Return strongly-typed Row / Row[] / null shapes from `@/types/database`.

```ts
import { createDraft, DatabaseError } from '@/db';

try {
  const draft = await createDraft(cookieId);
  // draft is fully typed as DraftRow
} catch (err) {
  if (err instanceof DatabaseError) {
    // err.operation: 'drafts.create'
    // err.cause: the raw Supabase / PostgREST error
  }
  throw err;
}
```

## Conventions

**Per-table modules only.** `drafts.ts`, `orders.ts`, `preview-events.ts`.
Cross-table queries don't go in any of them — when they're needed,
create a `db/queries/` subfolder for them.

**No business logic.** These helpers are CRUD-only. Rate-limit
decisions, status transition rules, threshold calculations — none of
that lives here. It lives in the API routes and service code that call
these helpers.

**Service-role client only.** All helpers default to
`createServerClient()`. Never import these from a client component —
the bundle would explode with server-only env vars.

**Tests inject the client.** Every helper takes a client parameter so
`tests/db/*.test.ts` can pass a `tuatale-test`-pointed client without
touching production. See `tests/db/helpers.ts` for the test client
factory.

## Adding a new query helper

1. Add the typed function to the appropriate `<table>.ts` file.
2. Match the existing signature pattern: `(args..., client = createServerClient())`.
3. Wrap any error in `DatabaseError(operation, cause)`.
4. Return the typed Row / Row[] from `@/types/database`.
5. Add a test in `tests/db/<table>.test.ts` against the test client.

## Running the integration tests locally

The tests under `tests/db/` are real integration tests against a
separate Supabase project (`tuatale-test`). They skip automatically
when the env isn't configured — CI never runs them.

### One-time setup per machine

1. Create a second Supabase project named `tuatale-test` (free tier).
2. Add to `website/.env.local`:
   ```
   TEST_SUPABASE_URL=https://<test ref>.supabase.co
   TEST_SUPABASE_SERVICE_ROLE_KEY=<test project's service role key>
   TEST_SUPABASE_DB_PASSWORD=<test project's database password>
   ```
3. Get the test project's connection string from the dashboard:
   Settings → Database → Connection string → URI. Copy the full
   `postgresql://...` URL.
4. Apply all migrations to the test project:
   ```bash
   npx supabase db push --db-url "<the connection string from step 3>"
   ```
5. Re-apply step 4 whenever a new migration is added to
   `supabase/migrations/`.

### Running

```bash
npm test
```

When configured, the `tests/db/` suites run against the test project
and report passes alongside the existing unit tests. When not
configured, they skip silently and the unit tests run as usual.

### Why a separate project, not a separate schema?

We considered using a `test` schema in `tuatale-prod` to avoid managing
a second project. The schema is properly isolated from `public`, so
tests can't accidentally touch production rows. But the service-role
credentials would be the production ones — a bug in test setup could in
principle delete production data. Separate projects mean separate
credentials; tests literally cannot touch production. The 5 minutes of
extra setup is worth it.

Phase 4+ when production has real customer data, this isolation
becomes load-bearing rather than nice-to-have.
