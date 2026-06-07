// Vitest config for the Tuatale worker.
//
// Loads worker/.env.local at config-evaluation time (before any test or source
// module is imported) so that:
//   - db.js / storage.js see NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
//   - ../../src/gemini.js + ../../src/anthropic.js (imported transitively by the
//     pipeline core) find GEMINI_API_KEY / ANTHROPIC_API_KEY at import time —
//     they throw on load if these are missing, even when no real call is made.
//
// Integration tests (db/storage/run-pipeline) hit the tuatale-TEST project; the
// .env.local must therefore point at tuatale-test, not prod.

import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Integration tests do real network I/O to Supabase; give them room and
    // run serially so DB-state assertions don't race across files.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    fileParallelism: false,
  },
});
