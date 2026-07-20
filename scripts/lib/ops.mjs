// scripts/_lib/ops.mjs — shared guards for operational scripts.
//
// WHY (near-miss, 2026-07-20): a "verify against PROD" run silently executed against
// TEST. An ad-hoc `str.replace` patch failed to match, the patch script printed "ok"
// regardless, and the verification then used the unchanged (test) credentials. Every
// individual check passed, so the output looked like a clean prod verification of a
// table nothing had touched. It was caught only because the header happened to print
// the target.
//
// Two lessons, both structural rather than "be careful next time":
//   1. A script that targets an environment must ASSERT and PRINT that target.
//   2. A programmatic edit must ASSERT the substitution matched. A helper that can
//      return success on a no-op replace is itself the bug.
// That day the affected script was read-only. The next one may not be.

import fs from "node:fs";

/**
 * Replace EXACTLY ONE occurrence of `find` in a file. Throws if the pattern is absent
 * or ambiguous — a silent no-op is the failure mode this exists to prevent.
 *
 * @returns {string} the new file contents (also written to disk unless dryRun)
 */
export function replaceOrThrow(filePath, find, replace, { dryRun = false, occurrences = 1 } = {}) {
  const src = fs.readFileSync(filePath, "utf8");
  const count = src.split(find).length - 1;
  if (count === 0) {
    throw new Error(`replaceOrThrow: PATTERN NOT FOUND in ${filePath}\n  looking for: ${JSON.stringify(find.slice(0, 120))}`);
  }
  if (count !== occurrences) {
    throw new Error(`replaceOrThrow: expected ${occurrences} occurrence(s) in ${filePath}, found ${count}`);
  }
  const out = src.split(find).join(replace);
  if (out === src) throw new Error(`replaceOrThrow: replacement produced no change in ${filePath}`);
  if (!dryRun) fs.writeFileSync(filePath, out);
  console.log(`  ✓ patched ${filePath} (${count} occurrence${count === 1 ? "" : "s"})`);
  return out;
}

export const REFS = {
  prod: { ref: "xffkmkxsmvqpmspzihha", name: "tuatale" },
  test: { ref: "zdtnrsjvbyivawetorxt", name: "tuatale-test" },
};

/**
 * Resolve Supabase credentials for an explicitly-named environment, ASSERT the URL
 * really belongs to it, and PRINT the resolved target. Never infers the environment
 * from whatever happens to be in the file.
 *
 * PROD values are preserved as `# PROD ... KEY=value` comments when .env.local is
 * repointed at test — both URL and key are read from the same source so a
 * url/key mismatch across environments is impossible.
 */
export function resolveTarget(envName, { envPath = "website/.env.local" } = {}) {
  const expect = REFS[envName];
  if (!expect) throw new Error(`resolveTarget: unknown environment "${envName}"`);
  const env = fs.readFileSync(envPath, "utf8");
  const plain = (k) => (env.match(new RegExp("^" + k + "\\s*=\\s*(\\S+)", "m")) || [])[1];
  const commented = (k) => (env.match(new RegExp("^#\\s*PROD\\b.*?\\b" + k + "\\s*=\\s*(\\S+)", "m")) || [])[1];

  let url = plain("NEXT_PUBLIC_SUPABASE_URL");
  let key = plain("SUPABASE_SERVICE_ROLE_KEY");
  if (!url?.includes(expect.ref)) {
    url = envName === "prod" ? commented("NEXT_PUBLIC_SUPABASE_URL") : plain("TEST_SUPABASE_URL");
    key = envName === "prod" ? commented("SUPABASE_SERVICE_ROLE_KEY") : plain("TEST_SUPABASE_SERVICE_ROLE_KEY");
  }
  if (!url?.includes(expect.ref)) {
    throw new Error(`resolveTarget: ABORT — could not resolve ${envName.toUpperCase()} (${expect.ref}); got ${url}`);
  }
  if (!key) throw new Error(`resolveTarget: ABORT — no service-role key for ${envName.toUpperCase()}`);
  console.log(`TARGET: ${envName.toUpperCase()} (${url})`);
  return { url, key, ...expect };
}
