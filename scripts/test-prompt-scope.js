// scripts/test-prompt-scope.js
// No-API-cost unit tests for Items 6 + 7 (FIX 1 + FIX 2) — prompt-rule
// scope across N=1..N=4.
//
// Items 6 + 7 generalized two conditionally-activated prompt-layer rules:
//   FIX 1 (Item 6): N4_COMPOSITION_RULES split into SUBSET_DISTRIBUTION_RULES
//     (fires at N>=2, N-scaled targets) and N4_COMPOSITION_SHAPES_RULE (N=4
//     only). Closes the Step 1 fort-theme N=2 watch-item (1 solo / 11 together
//     was the failure mode — soft guidance lost to group-themed pressure).
//   FIX 2 (Item 7): V2 canvas-seam rule in src/page-pipeline.js is now
//     gated to N>=2 only (was applied to N=1 too with "harmless" rationale,
//     but the plural framing risked subtle over-constraint).
//
// These tests verify the activation gates and the per-N rule wording — no
// API calls.
//
// Test 1 — N=1 prompt assembly: V2 rule NOT in buildScenePrompt output
// Test 2 — N=2 prompt assembly: V2 rule IS in buildScenePrompt output
// Test 3 — N=4 prompt assembly: V2 rule IS in buildScenePrompt output
// Test 4 — N=2 system prompt: SUBSET rule present, N=4 shapes rule absent
// Test 5 — N=3 system prompt: SUBSET rule present, N=4 shapes rule absent
// Test 6 — N=4 system prompt: BOTH rules present
// Test 7 — N=1 system prompt: neither rule present
// Test 8 — Per-N target bands verified verbatim
//
// Book-polish additions (Items 1 + 2, 2026-06-17) — also no API cost:
// Test 9  — Item 1: em/en-dash ban present in VOICE section + narrative_text schema
// Test 10 — Item 2: asymmetric-accessory rule in CHARACTER DESCRIPTION
// Test 11 — Item 2: asymmetric-accessory rule echoed in COMPANIONS

import "dotenv/config";
import { buildScenePrompt } from "../src/page-pipeline.js";
import {
  buildSubsetDistributionRule,
  buildMulticharRulesBlock,
  N4_COMPOSITION_SHAPES_RULE,
  SYSTEM_PROMPT_TEMPLATE,
  buildStorySchema,
  READING_LEVELS,
  resolveReadingLevel,
  buildReadingLevelRulesBlock,
} from "../src/anthropic.js";

function assert(condition, message) {
  if (!condition) {
    console.error(`FAIL: ${message}`);
    process.exit(1);
  }
}

// Stable substring of COMPOSITION_RULE_V2 used to detect its presence/absence
// in assembled prompts. The phrase is unique to V2 (not present in any
// template's compositionPromptTemplate) so a substring check is reliable.
const V2_SIGNATURE = "NO vertical seams";
// Stable substring of the SUBSET DISTRIBUTION rule heading.
const SUBSET_SIGNATURE = "SUBSET DISTRIBUTION";
// Stable substring of the N=4 composition shapes rule heading.
const N4_SHAPES_SIGNATURE = "N=4 COMPOSITION DISCIPLINE";

function makeSubject(name, age = 6) {
  return {
    name,
    age,
    description: "round face, short brown hair, blue eyes",
    subjectType: "child",
    sheetCount: 4,
  };
}
function makeStubScene() {
  return { page: 1, action: "stub action for the scene." };
}
const STUB_STYLE = "watercolor on cold-press paper";
const STUB_COMPOSITION = "natural daylight, medium framing";
const STUB_TEMPLATE_COMP = "full body, clean background";
const STUB_NEGATIVE = "no text, no labels";

console.log();
console.log("=".repeat(72));
console.log("prompt-scope unit test (no API cost) — Items 6 + 7 (FIX 1 + FIX 2)");
console.log("=".repeat(72));

// ---- Test 1 — N=1 prompt assembly: V2 NOT present ----
console.log();
console.log("Test 1 (FIX 2) — N=1 buildScenePrompt does NOT include V2 rule");
{
  const prompt = buildScenePrompt({
    subjects: [makeSubject("Iris")],
    scene: makeStubScene(),
    styleLine: STUB_STYLE,
    compositionLine: STUB_COMPOSITION,
    templateComposition: STUB_TEMPLATE_COMP,
    negativePrompt: STUB_NEGATIVE,
  });
  assert(typeof prompt === "string" && prompt.length > 0, "prompt is non-empty string");
  assert(prompt.includes(STUB_TEMPLATE_COMP), "bare templateComposition still present");
  assert(!prompt.includes(V2_SIGNATURE), `V2 signature "${V2_SIGNATURE}" must NOT be in N=1 prompt`);
  assert(!prompt.includes("NO panel divisions"), `V2 panel-divisions phrase must NOT be in N=1 prompt`);
  console.log(`  PASS (N=1 prompt lacks V2 signature; bare templateComposition preserved)`);
}

// ---- Test 2 — N=2 prompt assembly: V2 IS present ----
console.log();
console.log("Test 2 (FIX 2) — N=2 buildScenePrompt DOES include V2 rule");
{
  const prompt = buildScenePrompt({
    subjects: [makeSubject("Søren"), makeSubject("Theo")],
    scene: makeStubScene(),
    styleLine: STUB_STYLE,
    compositionLine: STUB_COMPOSITION,
    templateComposition: STUB_TEMPLATE_COMP,
    negativePrompt: STUB_NEGATIVE,
  });
  assert(prompt.includes(V2_SIGNATURE), `V2 signature "${V2_SIGNATURE}" MUST be in N=2 prompt`);
  assert(prompt.includes("NO panel divisions"), "V2 panel-divisions phrase present at N=2");
  assert(prompt.includes(STUB_TEMPLATE_COMP), "templateComposition still present (V2 is appended, not replacing)");
  console.log(`  PASS (N=2 prompt includes V2 canvas-seam defense)`);
}

// ---- Test 3 — N=4 prompt assembly: V2 IS present ----
console.log();
console.log("Test 3 (FIX 2) — N=4 buildScenePrompt DOES include V2 rule");
{
  const prompt = buildScenePrompt({
    subjects: [
      makeSubject("Søren"),
      makeSubject("Theo"),
      makeSubject("Mira"),
      makeSubject("Anya"),
    ],
    scene: makeStubScene(),
    styleLine: STUB_STYLE,
    compositionLine: STUB_COMPOSITION,
    templateComposition: STUB_TEMPLATE_COMP,
    negativePrompt: STUB_NEGATIVE,
  });
  assert(prompt.includes(V2_SIGNATURE), `V2 signature "${V2_SIGNATURE}" MUST be in N=4 prompt`);
  assert(prompt.includes("References:"), "N=4 multi-subject layout includes References mapping");
  console.log(`  PASS (N=4 prompt includes V2 canvas-seam defense)`);
}

// ---- Test 4 — N=2 system prompt: SUBSET only ----
console.log();
console.log("Test 4 (FIX 1) — N=2 multichar block: SUBSET present, N=4 shapes absent");
{
  const secondaries = [{ name: "Theo", anchor: "tier2" }];
  const block = buildMulticharRulesBlock(secondaries);
  assert(block.includes(SUBSET_SIGNATURE), `SUBSET DISTRIBUTION must be in N=2 block`);
  assert(!block.includes(N4_SHAPES_SIGNATURE), `N=4 COMPOSITION DISCIPLINE must NOT be in N=2 block`);
  assert(!block.includes("multi-focal-distance"), `N=4 shape-avoidance phrase must NOT leak into N=2`);
  assert(block.includes("2 ref-anchored subjects"), `N=2 wording present`);
  console.log(`  PASS (N=2 block contains subset rule, no N=4 shapes rule)`);
}

// ---- Test 5 — N=3 system prompt: SUBSET only ----
console.log();
console.log("Test 5 (FIX 1) — N=3 multichar block: SUBSET present, N=4 shapes absent");
{
  const secondaries = [
    { name: "Theo", anchor: "tier2" },
    { name: "Mira", anchor: "tier2" },
  ];
  const block = buildMulticharRulesBlock(secondaries);
  assert(block.includes(SUBSET_SIGNATURE), `SUBSET DISTRIBUTION must be in N=3 block`);
  assert(!block.includes(N4_SHAPES_SIGNATURE), `N=4 COMPOSITION DISCIPLINE must NOT be in N=3 block`);
  assert(block.includes("3 ref-anchored subjects"), `N=3 wording present`);
  console.log(`  PASS (N=3 block contains subset rule, no N=4 shapes rule)`);
}

// ---- Test 6 — N=4 system prompt: BOTH rules present ----
console.log();
console.log("Test 6 (FIX 1) — N=4 multichar block: BOTH subset and N=4 shapes present");
{
  const secondaries = [
    { name: "Theo", anchor: "tier2" },
    { name: "Mira", anchor: "tier2" },
    { name: "Anya", anchor: "tier2" },
  ];
  const block = buildMulticharRulesBlock(secondaries);
  assert(block.includes(SUBSET_SIGNATURE), `SUBSET DISTRIBUTION must be in N=4 block`);
  assert(block.includes(N4_SHAPES_SIGNATURE), `N=4 COMPOSITION DISCIPLINE must be in N=4 block`);
  assert(block.includes("multi-focal-distance"), `N=4 shape-avoidance phrase present`);
  assert(block.includes("4 ref-anchored subjects"), `N=4 wording present`);
  console.log(`  PASS (N=4 block contains both subset and shapes rules)`);
}

// ---- Test 7 — N=1 system prompt: neither rule ----
console.log();
console.log("Test 7 (FIX 1) — N=1 multichar block is empty (neither rule fires)");
{
  const block1 = buildMulticharRulesBlock(undefined);  // no secondaries field
  const block2 = buildMulticharRulesBlock([]);          // empty secondaries
  const block3 = buildMulticharRulesBlock([{ name: "Aunt", anchor: "text" }]);  // text-anchored only
  for (const [name, block] of [["undefined", block1], ["empty []", block2], ["text-only", block3]]) {
    assert(!block.includes(SUBSET_SIGNATURE), `SUBSET DISTRIBUTION must NOT fire at N=1 (${name})`);
    assert(!block.includes(N4_SHAPES_SIGNATURE), `N=4 COMPOSITION DISCIPLINE must NOT fire at N=1 (${name})`);
    assert(block === "", `multichar block must be empty string at N=1 (${name}), got ${JSON.stringify(block.slice(0, 50))}`);
  }
  console.log(`  PASS (N=1 block is empty across undefined / [] / text-anchored-only inputs)`);
}

// ---- Test 8 — Per-N target bands verbatim ----
console.log();
console.log("Test 8 (FIX 1) — N-scaled target bands appear verbatim per N");
{
  const n2 = buildSubsetDistributionRule(2);
  const n3 = buildSubsetDistributionRule(3);
  const n4 = buildSubsetDistributionRule(4);
  const n1 = buildSubsetDistributionRule(1);

  // N=2 spec: 6-8 together / 2-4 solo / 1-2 intimate
  assert(n2.includes("6-8 of the 12 scenes"), `N=2 missing "6-8" target band`);
  assert(n2.includes("2-4 scenes to feature the protagonist alone"), `N=2 missing "2-4 solo" target`);
  assert(n2.includes("1-2 scenes"), `N=2 missing "1-2" intimate phrase`);
  assert(!n2.includes("4-6 of the 12 scenes"), `N=2 must NOT contain N=4's "4-6" band`);

  // N=3 spec: 3-5 all-three / 4-6 subsets-of-2 / 2-4 solo
  assert(n3.includes("3-5 of the 12 scenes"), `N=3 missing "3-5" target`);
  assert(n3.includes("4-6 scenes to feature subsets of 2"), `N=3 missing "4-6 subsets of 2"`);
  assert(n3.includes("2-4 scenes to feature the protagonist alone"), `N=3 missing "2-4 solo"`);

  // N=4 spec: 4-6 all-four / 4-6 subsets-of-2-3 / 1-3 solo
  assert(n4.includes("4-6 of the 12 scenes"), `N=4 missing "4-6 all-four" target`);
  assert(n4.includes("4-6 scenes to feature subsets of 2-3"), `N=4 missing "4-6 subsets of 2-3"`);
  assert(n4.includes("1-3 scenes"), `N=4 missing "1-3 solo" target`);

  // N=1: empty
  assert(n1 === "", `N=1 must return empty string, got ${JSON.stringify(n1.slice(0, 80))}`);

  // Cross-check: each N's rule mentions the correct subject count word
  assert(n2.includes("both subjects"), `N=2 mentions "both subjects"`);
  assert(n3.includes("all three subjects"), `N=3 mentions "all three subjects"`);
  assert(n4.includes("all four subjects"), `N=4 mentions "all four subjects"`);

  console.log(`  PASS (per-N target bands present verbatim; cross-contamination absent)`);
}

// ---- Test 9 — Item 1: em/en-dash rule present in VOICE + schema ----
console.log();
console.log("Test 9 (Item 1) — em/en-dash rule in system prompt VOICE + narrative_text schema");
{
  assert(
    SYSTEM_PROMPT_TEMPLATE.includes("PUNCTUATION: do NOT use em dashes"),
    "VOICE section must carry the em/en-dash ban",
  );
  assert(
    SYSTEM_PROMPT_TEMPLATE.includes("breaks the read-aloud cadence"),
    "em-dash rule must give the read-aloud-cadence rationale",
  );
  // The same instruction is mirrored in the schema's narrative_text description.
  const schema = buildStorySchema([{ id: "prompt-3-iter-2" }]);
  const narrativeDesc = schema.properties.scenes.items.properties.narrative_text.description;
  assert(
    /do not use em dashes/i.test(narrativeDesc),
    `narrative_text schema description must echo the em-dash ban (got: ${JSON.stringify(narrativeDesc)})`,
  );
  console.log(`  PASS (em/en-dash rule present in both the prompt and the schema)`);
}

// ---- Test 10 — Item 2: asymmetric-accessory rule in CHARACTER DESCRIPTION ----
console.log();
console.log("Test 10 (Item 2) — asymmetric-accessory rule in CHARACTER DESCRIPTION");
{
  assert(
    SYSTEM_PROMPT_TEMPLATE.includes("Persistent appearance is symmetric and intrinsic only"),
    "CHARACTER DESCRIPTION must carry the symmetric/intrinsic-only rule",
  );
  assert(
    SYSTEM_PROMPT_TEMPLATE.includes("a pencil behind one ear"),
    "asymmetric-accessory rule must include the concrete examples (pencil-behind-ear, etc.)",
  );
  assert(
    SYSTEM_PROMPT_TEMPLATE.includes("single-cheek mole"),
    "rule must tie the failure to the known single-cheek-mole failure mode",
  );
  assert(
    SYSTEM_PROMPT_TEMPLATE.includes("per-scene prop"),
    "rule must redirect asymmetric items to per-scene props in `action`",
  );
  console.log(`  PASS (asymmetric-accessory rule present with examples + mole analogy + per-scene-prop redirect)`);
}

// ---- Test 11 — Item 2: companion parallel of the asymmetric rule ----
console.log();
console.log("Test 11 (Item 2) — asymmetric-accessory rule echoed in COMPANIONS");
{
  assert(
    SYSTEM_PROMPT_TEMPLATE.includes("The persistent-appearance rule from CHARACTER DESCRIPTION applies to companions too"),
    "COMPANIONS section must carry the parallel asymmetric-accessory rule",
  );
  console.log(`  PASS (companion character_description gets the same asymmetric-accessory discipline)`);
}

// ---- Test 12 — Heritage: the HERITAGE AND BACKGROUND frame is present ----
console.log();
console.log("Test 12 (Heritage) — HERITAGE AND BACKGROUND frame in CHARACTER DESCRIPTION");
{
  assert(SYSTEM_PROMPT_TEMPLATE.includes("HERITAGE AND BACKGROUND"), "HERITAGE frame heading must be present");
  assert(/render it faithfully and with dignity/i.test(SYSTEM_PROMPT_TEMPLATE), "faithful + dignity instruction present");
  assert(/do not stereotype, caricature, or exaggerate/i.test(SYSTEM_PROMPT_TEMPLATE), "no-stereotype/caricature instruction present");
  assert(SYSTEM_PROMPT_TEMPLATE.includes("never reduce the child to a single trait"), "individual-first instruction present");
  console.log("  PASS (heritage frame: render faithfully + with dignity + no stereotype/caricature)");
}

// ---- Test 13 — Reading level: default mapping (band + age fallback) ----
console.log();
console.log("Test 13 (Reading level) — resolveReadingLevel: override → band → age fallback");
{
  // Explicit override wins.
  assert(resolveReadingLevel({ reading_level: "advanced", ageRange: "3-5", age: 3 }) === "advanced",
    "explicit reading_level must override band + age");
  assert(resolveReadingLevel({ reading_level: "bogus", ageRange: "3-5" }) === "simplest",
    "invalid reading_level must be ignored, fall through to band");
  // Band mapping (lossless, preferred).
  assert(resolveReadingLevel({ ageRange: "3-5" }) === "simplest", "band 3-5 → simplest");
  assert(resolveReadingLevel({ ageRange: "5-7" }) === "standard", "band 5-7 → standard");
  assert(resolveReadingLevel({ ageRange: "7-9" }) === "advanced", "band 7-9 → advanced");
  // Lossy age-int fallback (no band).
  assert(resolveReadingLevel({ age: 4 }) === "simplest", "age 4 → simplest");
  assert(resolveReadingLevel({ age: 6 }) === "standard", "age 6 → standard");
  assert(resolveReadingLevel({ age: 8 }) === "advanced", "age 8 → advanced");
  // Nothing → standard (safe default).
  assert(resolveReadingLevel({}) === "standard", "no signal → standard");
  console.log("  PASS (override → band → age fallback precedence correct)");
}

// ---- Test 14 — Reading level: rules block per level (right one, not others) ----
console.log();
console.log("Test 14 (Reading level) — buildReadingLevelRulesBlock returns the correct level block");
{
  const simplest = buildReadingLevelRulesBlock("simplest");
  const standard = buildReadingLevelRulesBlock("standard");
  const advanced = buildReadingLevelRulesBlock("advanced");
  assert(simplest.includes("READING LEVEL — SIMPLEST"), "simplest heading present");
  assert(simplest.includes("40 to 140 characters"), "simplest char band present (floor relaxed to 40)");
  assert(simplest.includes("never a bare fragment"), "simplest complete-sentence guard present");
  assert(simplest.includes("bookends on the refrain"), "simplest refrain-bookend instruction present");
  assert(!simplest.includes("ADVANCED"), "simplest block must not leak advanced content");
  assert(standard.includes("READING LEVEL — STANDARD") && standard.includes("140 to 260 characters"),
    "standard heading + char band present");
  assert(advanced.includes("READING LEVEL — ADVANCED") && advanced.includes("200 to 300 characters"),
    "advanced heading + char band present (200-300, reconciled with 300 template cap)");
  assert(!advanced.includes("360"), "advanced must NOT reference the old 360-char band (would overflow templates)");
  // Unknown level → standard (safe default), never throws.
  assert(buildReadingLevelRulesBlock("bogus") === READING_LEVELS.standard.rules, "unknown level → standard block");
  console.log("  PASS (each level returns its own block; advanced reconciled to <=300; unknown → standard)");
}

// ---- Test 15 — Reading level: schema narrative_text desc is level-conditioned ----
console.log();
console.log("Test 15 (Reading level) — buildStorySchema narrative_text description varies by level");
{
  const descFor = (lvl) =>
    buildStorySchema([{ id: "prompt-3-iter-2" }], lvl).properties.scenes.items.properties.narrative_text.description;
  assert(descFor("simplest").includes("1 to 2 short sentences"), "simplest schema desc: 1-2 short sentences");
  assert(descFor("standard").includes("3 to 4 sentences"), "standard schema desc: 3-4 sentences");
  assert(descFor("advanced").includes("4 to 5 sentences"), "advanced schema desc: 4-5 sentences");
  // Backward compat: the 1-arg call still works and defaults to standard.
  assert(buildStorySchema([{ id: "prompt-3-iter-2" }]).properties.scenes.items.properties.narrative_text.description
    .includes("3 to 4 sentences"), "1-arg buildStorySchema defaults to standard");
  // Dash ban still echoed regardless of level.
  assert(/do not use em dashes/i.test(descFor("advanced")), "dash ban still present in level-conditioned desc");
  console.log("  PASS (schema narrative_text desc is level-conditioned; 1-arg defaults to standard; dash ban intact)");
}

// ---- Test 16 — Reading level: placeholders resolve (no {{...}} left, age preserved) ----
console.log();
console.log("Test 16 (Reading level) — system prompt still carries the reading-level placeholders");
{
  // The template must carry the three placeholders so generateStory can fill them.
  assert(SYSTEM_PROMPT_TEMPLATE.includes("{{AUDIENCE}}"), "{{AUDIENCE}} placeholder present");
  assert(SYSTEM_PROMPT_TEMPLATE.includes("{{PROSE_LENGTH}}"), "{{PROSE_LENGTH}} placeholder present");
  assert(SYSTEM_PROMPT_TEMPLATE.includes("{{READING_LEVEL_RULES}}"), "{{READING_LEVEL_RULES}} placeholder present");
  // The old hard-coded audience/sentence strings must be GONE.
  assert(!SYSTEM_PROMPT_TEMPLATE.includes("4-7-year-old"), "hard-coded '4-7-year-old' audience must be removed");
  assert(!/reads aloud\. 3-5 sentences\./.test(SYSTEM_PROMPT_TEMPLATE), "hard-coded '3-5 sentences' prose length must be removed");
  console.log("  PASS (placeholders present; hard-coded audience + sentence-count removed)");
}

// ---- Test 17 — Simplest FILL-template selection preference (rule 6) ----
console.log();
console.log("Test 17 (Step 2) — TEMPLATE SELECTION rule 6 steers SIMPLEST → prompt-7-iter-1");
{
  assert(SYSTEM_PROMPT_TEMPLATE.includes("READING-LEVEL LAYOUT"), "rule 6 heading present");
  assert(/prompt-7-iter-1[\s\S]{0,120}(default|workhorse)/i.test(SYSTEM_PROMPT_TEMPLATE)
    || /(default|workhorse)[\s\S]{0,120}prompt-7-iter-1/i.test(SYSTEM_PROMPT_TEMPLATE),
    "rule 6 names prompt-7-iter-1 as the SIMPLEST default workhorse");
  assert(SYSTEM_PROMPT_TEMPLATE.includes("only at the SIMPLEST reading level")
    || SYSTEM_PROMPT_TEMPLATE.includes("ONLY at the SIMPLEST reading level"),
    "rule 6 scopes the preference to SIMPLEST (STANDARD/ADVANCED ignore it)");
  console.log("  PASS (rule 6 present, names the FILL template, scoped to SIMPLEST)");
}

// ---- Test 18 — prompt-7 FILL template is in the registry (reactivated) ----
console.log();
console.log("Test 18 (Step 2) — prompt-7-iter-1 reactivated in the template registry");
{
  const { loadTemplateRegistry } = await import("../src/template-registry.js");
  const registry = await loadTemplateRegistry();
  const p7 = registry.find((t) => t.id === "prompt-7-iter-1");
  assert(p7, "prompt-7-iter-1 must be in the registry (deferred flag removed)");
  assert(p7.selection_metadata.max_narrative_chars === 150, "prompt-7 cap is 150");
  assert(p7.regionDetection === null && p7.autoFit !== null && p7.autoFit !== undefined,
    "prompt-7 is Type C (no region detection + autoFit) — dependable banded, not the scrapped vignette");
  assert(p7.textRegion && p7.textRegion.height <= 0.22, "prompt-7 uses a compact text band (fills, not sparse)");
  console.log("  PASS (prompt-7 in registry, 150 cap, Type C, compact fill band)");
}

console.log();
console.log("=".repeat(72));
console.log("All prompt-scope tests passed.");
console.log("=".repeat(72));
console.log();
