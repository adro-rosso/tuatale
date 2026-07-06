// scripts/test-medium-tokens.js — no-API-cost guard for the W-E medium-token
// parameterization (2026-07-06).
//
// The page templates' compositionPromptTemplate had watercolour-specific medium
// phrases baked in; W-E replaced them with {{MEDIUM:key}} tokens that each art
// style fills. THE HARD CONSTRAINT: watercolour (the live purchasable style) must
// render a BYTE-IDENTICAL composition prompt after the change. This test asserts,
// per template, that filling the tokenized composition with watercolour's medium
// (and with the default, i.e. no medium) reproduces the captured pre-W-E baseline
// EXACTLY — and that a non-watercolour style (coloured pencil) fills cleanly with
// no watercolour words and no leftover tokens.
//
// Baseline: scripts/fixtures/composition-watercolour-baseline.json, captured from
// the templates BEFORE tokenization.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveStyle, fillMediumTokens, MEDIUM_TOKEN_KEYS } from "../src/art-styles.js";
import { loadTemplateRegistry } from "../src/template-registry.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");

function assert(cond, msg) {
  if (!cond) { console.error(`FAIL: ${msg}`); process.exit(1); }
}

const baseline = JSON.parse(
  fs.readFileSync(path.join(__dirname, "fixtures", "composition-watercolour-baseline.json"), "utf8"),
);
const TEMPLATE_IDS = Object.keys(baseline);

console.log();
console.log("=".repeat(72));
console.log("medium-token unit test (no API cost) — W-E parameterization");
console.log("=".repeat(72));

// Read each tokenized template's CURRENT compositionPromptTemplate from disk.
function currentComposition(id) {
  const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, "templates", id, "config.json"), "utf8"));
  return cfg.imageGeneration.compositionPromptTemplate;
}

const WC = resolveStyle("watercolour").medium;
const PENCIL = resolveStyle("coloured_pencil").medium;

// ---- Test 1 — watercolour fill is BYTE-IDENTICAL to the pre-W-E baseline ----
console.log("\nTest 1 — watercolour medium fill === captured baseline (byte-identical), per template");
for (const id of TEMPLATE_IDS) {
  const tokenized = currentComposition(id);
  const filled = fillMediumTokens(tokenized, WC);
  assert(filled === baseline[id],
    `${id}: watercolour-filled composition != baseline.\n  baseline: ${JSON.stringify(baseline[id].slice(0, 120))}\n  filled:   ${JSON.stringify(filled.slice(0, 120))}`);
  console.log(`  PASS  ${id} (${filled.length} chars, byte-identical)`);
}

// ---- Test 2 — DEFAULT fill (no medium) also === baseline (legacy safety) ----
console.log("\nTest 2 — default fill (no medium arg) === baseline (legacy stories → watercolour)");
for (const id of TEMPLATE_IDS) {
  assert(fillMediumTokens(currentComposition(id)) === baseline[id], `${id}: default fill != baseline`);
}
console.log("  PASS (all templates default-fill to the watercolour baseline)");

// ---- Test 3 — no {{MEDIUM:...}} tokens survive a fill (watercolour + pencil) ----
console.log("\nTest 3 — no leftover {{MEDIUM:...}} tokens after filling");
for (const id of TEMPLATE_IDS) {
  for (const [label, med] of [["watercolour", WC], ["pencil", PENCIL]]) {
    const filled = fillMediumTokens(currentComposition(id), med);
    assert(!/\{\{MEDIUM:/.test(filled), `${id}: leftover MEDIUM token after ${label} fill`);
  }
}
console.log("  PASS (watercolour + pencil fills leave no tokens)");

// ---- Test 4 — pencil fill removes watercolour words + reads as pencil ----
console.log("\nTest 4 — coloured-pencil fill carries pencil vocab, drops watercolour words");
{
  let anyToken = false;
  for (const id of TEMPLATE_IDS) {
    const tokenized = currentComposition(id);
    if (/\{\{MEDIUM:/.test(tokenized)) anyToken = true;
    const filled = fillMediumTokens(tokenized, PENCIL);
    // Only assert on templates that actually carry medium tokens.
    if (/\{\{MEDIUM:/.test(tokenized)) {
      assert(!/watercolou?r/i.test(filled), `${id}: watercolour word survived the pencil fill: ${JSON.stringify(filled.match(/[^.]*watercolou?r[^.]*/i)?.[0] ?? "")}`);
      assert(/pencil/i.test(filled), `${id}: pencil fill produced no "pencil" wording`);
    }
  }
  assert(anyToken, "expected at least one template to carry {{MEDIUM:...}} tokens");
  console.log("  PASS (pencil fills contain 'pencil', contain no 'watercolour'/'watercolor')");
}

// ---- Test 5 — every token key used in templates is a known MEDIUM_TOKEN_KEY ----
console.log("\nTest 5 — every {{MEDIUM:key}} in the templates is a declared key (no typos)");
for (const id of TEMPLATE_IDS) {
  const keys = [...currentComposition(id).matchAll(/\{\{MEDIUM:(\w+)\}\}/g)].map((m) => m[1]);
  for (const k of keys) assert(MEDIUM_TOKEN_KEYS.includes(k), `${id}: token key "${k}" not in MEDIUM_TOKEN_KEYS`);
  // fillMediumTokens also throws on an unknown key — belt and suspenders.
  fillMediumTokens(currentComposition(id), WC);
}
console.log("  PASS (all template token keys are declared)");

// ---- Test 6 — the registry loads (tokenized configs are valid JSON) ----
console.log("\nTest 6 — template registry still loads (tokenized configs are valid)");
{
  const reg = await loadTemplateRegistry();
  assert(reg.length >= 5, "registry should load >= 5 page templates");
  console.log(`  PASS (${reg.map((t) => t.id).join(", ")})`);
}

console.log();
console.log("=".repeat(72));
console.log("All medium-token tests passed — watercolour composition is BYTE-IDENTICAL.");
console.log("=".repeat(72));
console.log();
