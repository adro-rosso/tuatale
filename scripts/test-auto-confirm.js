// scripts/test-auto-confirm.js
// No-API-cost verification of the D3 auto-confirm path post-Items-1-through-7.
//
// Two CONFIRM gates exist in the production pipeline:
//   1. scripts/generate-story.js line 354 (story-gen)
//   2. scripts/generate-book.js  line 644 (sheet-mint + page-render)
// Both bypass via --yes / --auto-confirm / AUTO_CONFIRM=1 (extracted in an
// earlier session). This test verifies the bypass still works with the
// expanded input schema (gender, anchor, tier-1 / tier-2) and that no Item
// 5 / 6 / 7 change snuck a new interactive prompt into the silent paths
// (F2 archive on re-run, F4 prior-meta snapshot on MISMATCH_REMINT).
//
// Strategy:
//   - Tests 1-4: spawn generate-story.js with a stub Anthropic key + --yes
//     (or AUTO_CONFIRM=1 env), capture stdout, kill once the gate has
//     auto-confirmed. Verify the expected markers appeared. Clean up the
//     run output dir.
//   - Tests 5-6: static grep-style assertions on src/status-writer.js and
//     src/sheet-meta.js to confirm no readline / question / interactive
//     prompts were added to the F2 / F4 silent paths.

import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");
const STUB_KEY = "stub-invalid-key-for-test";

function assert(condition, message) {
  if (!condition) {
    console.error(`FAIL: ${message}`);
    process.exit(1);
  }
}

function rmrfQuietly(p) {
  if (!p) return;
  try { fs.rmSync(p, { recursive: true, force: true }); } catch { /* ignore */ }
}

/**
 * Spawn a script with the given args + env. Wait for the "Auto-confirm
 * enabled" marker in stdout, then kill the child (we don't need the full
 * API round-trip; the marker proves the gate auto-confirmed). Returns
 * { stdout, stderr, exitCode, outDir }.
 *
 * If the marker never appears within timeoutMs, the child is killed and
 * the test will fail downstream when asserting on stdout.
 */
function spawnUntilAutoConfirm(scriptName, scriptArgs, extraEnv = {}, timeoutMs = 12000) {
  return new Promise((resolve) => {
    const scriptPath = path.join(PROJECT_ROOT, "scripts", scriptName);
    const child = spawn(process.execPath, [scriptPath, ...scriptArgs], {
      cwd: PROJECT_ROOT,
      env: {
        ...process.env,
        ANTHROPIC_API_KEY: STUB_KEY,
        ...extraEnv,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "", stderr = "";
    let outDir = null;
    let killed = false;
    let resolved = false;
    let killAfterMarkerTimer = null;
    let watchdog = null;

    const finalize = () => {
      if (resolved) return;
      resolved = true;
      clearTimeout(watchdog);
      clearTimeout(killAfterMarkerTimer);
      resolve({ stdout, stderr, exitCode: child.exitCode, outDir });
    };

    watchdog = setTimeout(() => {
      killed = true;
      try { child.kill("SIGKILL"); } catch { /* already exited */ }
    }, timeoutMs);

    child.stdout.on("data", (d) => {
      const s = d.toString();
      stdout += s;
      const m = stdout.match(/Output directory:\s+(\S+?)\/?\s*$/m);
      if (m) outDir = path.resolve(PROJECT_ROOT, m[1]);
      if (!killed && stdout.includes("Auto-confirm enabled")) {
        killed = true;
        // Give the child ~300ms after marker so any post-gate setup
        // (createStatusFile, registerAbortHandlers) has a chance to write
        // to disk — provides evidence the script actually proceeded past
        // the gate, not just printed the message.
        killAfterMarkerTimer = setTimeout(() => {
          try { child.kill("SIGKILL"); } catch { /* already exited */ }
        }, 300);
      }
    });
    child.stderr.on("data", (d) => { stderr += d.toString(); });
    child.on("exit", finalize);
    child.on("error", finalize);
  });
}

function writeInputJson(content, label) {
  const p = path.join(PROJECT_ROOT, "output", "stories", `_test-auto-confirm-${label}.json`);
  fs.writeFileSync(p, JSON.stringify(content));
  return p;
}

console.log();
console.log("=".repeat(72));
console.log("auto-confirm verification (no API cost) — Item 8 (D3 re-validation)");
console.log("=".repeat(72));

const cleanupPaths = [];

// ---- Test 1 — N=1 single-protagonist with --yes ----
console.log();
console.log("Test 1 — N=1 single-protagonist with --yes bypasses the CONFIRM gate");
{
  const inputPath = writeInputJson({
    child: { name: "TestKid", age: 6, gender: "boy", appearance: "short brown hair, blue shirt" },
    secondaries: [],
    theme: "a quiet day",
  }, "n1");
  cleanupPaths.push(inputPath);
  const { stdout, outDir } = await spawnUntilAutoConfirm(
    "generate-story.js",
    ["--input", inputPath, "--yes"],
  );
  cleanupPaths.push(outDir);
  assert(stdout.includes("Auto-confirm enabled"), `"Auto-confirm enabled" marker missing from stdout`);
  assert(stdout.includes("Child gender:     boy"), `gender field missing from input summary`);
  assert(!stdout.match(/^\s*-\s*\[REF-ANCHORED\]/m), `unexpected secondary in N=1 input summary`);
  assert(stdout.includes("Output directory:"), `output dir line should print`);
  console.log(`  PASS (N=1 input summary correct; auto-confirm fired silently)`);
}

// ---- Test 2 — N=2 multi-character with tier-2 secondary, --yes ----
console.log();
console.log("Test 2 — N=2 (protagonist + 1 tier-2 human secondary) with --yes");
{
  const inputPath = writeInputJson({
    child: { name: "TestKid", age: 6, gender: "boy", appearance: "short brown hair, blue shirt" },
    secondaries: [{
      name: "Friend",
      age: 7,
      gender: "girl",
      relationship: "friend",
      subject_type: "human",
      anchor: "tier2",
      appearance_markers: "long red hair to shoulders; green dress",
    }],
    theme: "a quiet afternoon",
  }, "n2");
  cleanupPaths.push(inputPath);
  const { stdout, outDir } = await spawnUntilAutoConfirm(
    "generate-story.js",
    ["--input", inputPath, "--yes"],
  );
  cleanupPaths.push(outDir);
  assert(stdout.includes("Auto-confirm enabled"), `auto-confirm marker present`);
  assert(stdout.includes("Companions:       1"), `expected "Companions: 1" in input summary`);
  assert(stdout.includes("[REF-ANCHORED] Friend"), `tier-2 secondary should render as [REF-ANCHORED]`);
  assert(stdout.includes("gender girl"), `secondary gender printed`);
  assert(stdout.includes("Child gender:     boy"), `protagonist gender printed`);
  console.log(`  PASS (N=2 schema with gender + tier-2 anchor; auto-confirm fired)`);
}

// ---- Test 3 — N=3 mixed anchors (tier-2 human + tier-1 non_human) ----
console.log();
console.log("Test 3 — N=3 mixed anchors (tier-2 human + tier-1 non_human) with --yes");
{
  const inputPath = writeInputJson({
    child: { name: "TestKid", age: 6, gender: "boy", appearance: "short brown hair, blue shirt" },
    secondaries: [
      {
        name: "Friend",
        age: 7,
        gender: "girl",
        relationship: "friend",
        subject_type: "human",
        anchor: "tier2",
        appearance_markers: "long red hair to shoulders; green dress",
      },
      {
        name: "Bramble",
        relationship: "pet",
        subject_type: "non_human",
        anchor: "tier1",
        appearance_markers: "mixed terrier with shaggy tan coat and a black ear tip",
        age: 4,
      },
    ],
    theme: "a quiet afternoon",
  }, "n3-mixed");
  cleanupPaths.push(inputPath);
  const { stdout, outDir } = await spawnUntilAutoConfirm(
    "generate-story.js",
    ["--input", inputPath, "--yes"],
  );
  cleanupPaths.push(outDir);
  assert(stdout.includes("Auto-confirm enabled"), `auto-confirm marker`);
  assert(stdout.includes("Companions:       2"), `expected "Companions: 2" with 2 secondaries`);
  assert(stdout.includes("[REF-ANCHORED] Friend"), `tier-2 friend [REF-ANCHORED]`);
  assert(stdout.includes("[TEXT-ANCHORED] Bramble"), `tier-1 pet [TEXT-ANCHORED]`);
  // tier-1 non_human has no gender (validated by schema in generate-story.js
  // line ~256: gender must NOT be present for non_human); should not appear.
  assert(
    !stdout.match(/Bramble.*gender (boy|girl|non_binary)/),
    `non_human secondary must not print a gender`,
  );
  console.log(`  PASS (tier-1 + tier-2 mix; anchor validation passes; auto-confirm fired)`);
}

// ---- Test 4 — AUTO_CONFIRM=1 env var (no --yes flag) ----
console.log();
console.log("Test 4 — AUTO_CONFIRM=1 env var bypasses the gate (no --yes flag)");
{
  const inputPath = writeInputJson({
    child: { name: "TestKid", age: 6, gender: "boy", appearance: "short brown hair, blue shirt" },
    secondaries: [],
    theme: "a quiet day",
  }, "env-only");
  cleanupPaths.push(inputPath);
  const { stdout, outDir } = await spawnUntilAutoConfirm(
    "generate-story.js",
    ["--input", inputPath],
    { AUTO_CONFIRM: "1" },
  );
  cleanupPaths.push(outDir);
  assert(stdout.includes("Auto-confirm enabled"), `env-var path: auto-confirm marker missing`);
  assert(!stdout.includes("Type CONFIRM to proceed"), `interactive prompt must not appear under AUTO_CONFIRM=1`);
  console.log(`  PASS (AUTO_CONFIRM=1 env var alone is sufficient; no --yes flag needed)`);
}

// ---- Test 5 — F2 silent archive path: no readline in src/status-writer.js ----
console.log();
console.log("Test 5 (F2) — src/status-writer.js has no readline / interactive prompt");
{
  const src = fs.readFileSync(path.join(PROJECT_ROOT, "src", "status-writer.js"), "utf8");
  // F2 archiving (rotatePriorStatusIfPresent) must be silent — no readline,
  // no question(), no stdin. The whole module is silent except console.log
  // (which generate-* call sites handle directly).
  assert(!/from\s+["']node:readline/.test(src), `src/status-writer.js must not import readline`);
  assert(!/require\(["']readline["']\)/.test(src), `src/status-writer.js must not require readline`);
  assert(!/\.question\s*\(/.test(src), `src/status-writer.js must not call .question(`);
  assert(!/process\.stdin\.on\b/.test(src), `src/status-writer.js must not subscribe to stdin`);
  assert(/rotatePriorStatusIfPresent/.test(src), `F2 archive helper still present (sanity)`);
  console.log(`  PASS (F2 status-archive path is silent — no readline / prompt)`);
}

// ---- Test 6 — F4 silent snapshot + MISMATCH_REMINT warning is non-blocking ----
console.log();
console.log("Test 6 (F4) — src/sheet-meta.js silent; MISMATCH_REMINT uses console.warn not prompt");
{
  const sheetMeta = fs.readFileSync(path.join(PROJECT_ROOT, "src", "sheet-meta.js"), "utf8");
  assert(!/from\s+["']node:readline/.test(sheetMeta), `src/sheet-meta.js must not import readline`);
  assert(!/\.question\s*\(/.test(sheetMeta), `src/sheet-meta.js must not call .question(`);
  assert(/snapshotPreviousMeta/.test(sheetMeta), `F4 snapshot helper still present (sanity)`);

  // generate-book.js's MISMATCH_REMINT branch must warn (non-blocking),
  // not prompt. The whole script has exactly ONE readline.createInterface
  // call — the CONFIRM gate at line ~643. We verify the MISMATCH branch
  // uses console.warn and snapshotPreviousMeta, not readline.
  const genBook = fs.readFileSync(path.join(PROJECT_ROOT, "scripts", "generate-book.js"), "utf8");
  const createInterfaceMatches = genBook.match(/readline\.createInterface/g) ?? [];
  assert(
    createInterfaceMatches.length === 1,
    `generate-book.js must have exactly 1 readline.createInterface (the CONFIRM gate). Got ${createInterfaceMatches.length}.`,
  );
  // The MISMATCH_REMINT branch must:
  //   (a) call console.warn about the marker fingerprint mismatch
  //   (b) call snapshotPreviousMeta (F4 wiring)
  //   (c) NOT prompt the user (no rl.question outside the single CONFIRM gate)
  // Whole-file checks — spatial bracketing breaks when "MISMATCH_REMINT"
  // appears in earlier comments (it does: line ~523 in sheetsToMintForSubject).
  assert(
    /console\.warn\([^)]*marker fingerprint mismatch/.test(genBook),
    `expected console.warn("...marker fingerprint mismatch...") in MISMATCH_REMINT branch`,
  );
  assert(
    /snapshotPreviousMeta\s*\(/.test(genBook),
    `generate-book.js must call snapshotPreviousMeta (F4 wiring)`,
  );
  // Already verified above: exactly 1 readline.createInterface (the CONFIRM
  // gate). No need for a second check.
  console.log(`  PASS (F4 snapshot silent; MISMATCH_REMINT warns + snapshots non-blocking)`);
}

// ---- Cleanup ----
for (const p of cleanupPaths) rmrfQuietly(p);

console.log();
console.log("=".repeat(72));
console.log("All auto-confirm tests passed.");
console.log("=".repeat(72));
console.log();
