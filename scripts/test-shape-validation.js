// scripts/test-shape-validation.js
// No-API-cost unit tests for validateStoryShape() — the post-parse cross-
// field validator extracted from attemptStoryGeneration during Item 9
// (2026-06-01) when the launch-smoke test surfaced a tier-1 / tier-2 bug
// in the original inline validator.
//
// Background: the system prompt instructs Sonnet to emit
// companion_characters[] containing ONLY the tier-2 (ref-anchored)
// secondaries. Tier-1 (text-anchored) entities live in scene action prose
// and are intentionally absent from companion_characters AND from
// subjects_present. The original validator built expectedCompanionNames
// from ALL secondaries, which crashed every customer with a soft-anchored
// pet (kid + tier-1 dog → "Expected: [Pepper]. Got: [(none)]." → ouch).
//
// These tests guard:
//   (a) the post-fix behavior — tier-2 are required, tier-1 are absent
//   (b) regression against the OPPOSITE bug — if a future prompt change
//       starts pulling tier-1 into the list, validateStoryShape catches
//       the divergence
//   (c) all the previously-passing cases still pass after extraction
//
// Test 1 — N=1 protagonist only (no secondaries) → passes
// Test 2 — N=2 with tier-2 human → passes (the Søren+Theo shape)
// Test 3 — N=2 with tier-1 non-human (the Elena+Pepper case) → passes
// Test 4 — N=3 mixed (tier-2 + tier-1) → only tier-2 in companion_characters
// Test 5 — Sonnet wrongly includes a tier-1 name → validator FAILS cleanly
// Test 6 — Sonnet wrongly omits a tier-2 name → validator FAILS cleanly
// Test 7 — Malformed subjects_present (missing/non-array) → fails cleanly
// Test 8 — N=1 with companion_characters: ["StrayName"] → fails (catches
//          Sonnet hallucinating a companion the input never specified)

import "dotenv/config";
import { validateStoryShape } from "../src/anthropic.js";

function assert(condition, message) {
  if (!condition) {
    console.error(`FAIL: ${message}`);
    process.exit(1);
  }
}

function expectThrow(fn, expectedSubstring, label) {
  let caught = null;
  try { fn(); } catch (e) { caught = e; }
  assert(caught !== null, `${label}: expected a throw, got success`);
  assert(
    caught.message.includes(expectedSubstring),
    `${label}: expected error to mention "${expectedSubstring}", got: ${caught.message}`,
  );
}

// ---- Test fixtures ------------------------------------------------------
// A skeleton "minimal valid Sonnet output" — has all top-level fields and
// 12 well-formed scenes. Each test builds on this by mutating only the
// fields it cares about.
function makeScene(page, subjectsPresent) {
  return {
    page,
    action: `stub action for page ${page}`,
    narrative_text: `stub narrative text for page ${page}, long enough to read like prose.`,
    subjects_present: subjectsPresent,
    layout_intent: { template_id: "prompt-2-iter-2", rationale: "stub rationale" },
  };
}

function makeValidOutput({ protagonist, companions = [], subjectsPerScene = null }) {
  // subjectsPerScene: array of 12 arrays of names. Default: protagonist
  // alone on every scene.
  const scenes = [];
  for (let i = 0; i < 12; i++) {
    const sp = subjectsPerScene?.[i] ?? [protagonist];
    scenes.push(makeScene(i + 1, sp));
  }
  return {
    title: "Stub Title",
    character: `${protagonist} is a stub character description.`,
    companion_characters: companions.map((name) => ({
      name,
      character_description: `${name} is a stub companion description.`,
    })),
    scenes,
    cover_concept: `Stub cover concept featuring ${protagonist}.`,
    cover_subjects: [protagonist],
  };
}

console.log();
console.log("=".repeat(72));
console.log("validateStoryShape unit test (no API cost) — Item 9");
console.log("=".repeat(72));

// ---- Test 1: N=1 ----
console.log();
console.log("Test 1 — N=1 protagonist only → passes");
{
  const input = {
    child: { name: "Iris", age: 6, gender: "girl" },
    secondaries: [],
    theme: "a quiet day",
  };
  const out = makeValidOutput({ protagonist: "Iris" });
  // Should not throw
  validateStoryShape(out, { input });
  console.log(`  PASS (N=1 with no companions accepts companion_characters: [])`);
}

// ---- Test 2: N=2 tier-2 human ----
console.log();
console.log("Test 2 — N=2 tier-2 human (Søren+Theo shape) → passes");
{
  const input = {
    child: { name: "Søren", age: 6, gender: "boy" },
    secondaries: [{
      name: "Theo",
      age: 7,
      gender: "boy",
      relationship: "friend",
      subject_type: "human",
      anchor: "tier2",
      appearance_markers: "stub",
    }],
    theme: "a quiet day",
  };
  // Subjects-per-scene: mix of solo + together, all valid
  const subjectsPerScene = [
    ["Søren"],
    ["Søren", "Theo"],
    ["Søren", "Theo"],
    ["Søren"],
    ["Søren", "Theo"],
    ["Søren", "Theo"],
    ["Søren", "Theo"],
    ["Søren", "Theo"],
    ["Søren"],
    ["Søren", "Theo"],
    ["Søren", "Theo"],
    ["Søren"],
  ];
  const out = makeValidOutput({ protagonist: "Søren", companions: ["Theo"], subjectsPerScene });
  validateStoryShape(out, { input });
  console.log(`  PASS (tier-2 secondary present in companion_characters + subjects_present)`);
}

// ---- Test 3: N=2 tier-1 (Elena+Pepper) — THE BUG FIX ----
console.log();
console.log("Test 3 (Item 9 fix) — N=2 with tier-1 non-human (Elena+Pepper) → passes");
{
  const input = {
    child: { name: "Elena", age: 5, gender: "girl" },
    secondaries: [{
      name: "Pepper",
      age: 3,
      relationship: "pet",
      subject_type: "non_human",
      anchor: "tier1",
      appearance_markers: "scruffy grey-and-white dog",
    }],
    theme: "lost in the park",
  };
  // Mirror what Sonnet actually produced for the Elena+Pepper smoke test:
  // companion_characters: [], every subjects_present: ["Elena"] only.
  const out = makeValidOutput({ protagonist: "Elena", companions: [] });
  validateStoryShape(out, { input });
  console.log(`  PASS (tier-1 pet excluded from companion_characters; validator accepts as documented)`);
}

// ---- Test 4: N=3 mixed (1 tier-2 human + 1 tier-1 non-human) ----
console.log();
console.log("Test 4 — N=3 mixed (tier-2 + tier-1) → only tier-2 in companion_characters");
{
  const input = {
    child: { name: "Mira", age: 6, gender: "girl" },
    secondaries: [
      {
        name: "Lila",
        age: 7,
        gender: "girl",
        relationship: "friend",
        subject_type: "human",
        anchor: "tier2",
        appearance_markers: "stub",
      },
      {
        name: "Bramble",
        age: 3,
        relationship: "pet",
        subject_type: "non_human",
        anchor: "tier1",
        appearance_markers: "mixed terrier",
      },
    ],
    theme: "an adventure",
  };
  // subjects_present has only Mira + Lila (the tier-2). Bramble lives in
  // action prose. Validator should accept companion_characters: [Lila] only.
  const subjectsPerScene = [
    ["Mira"], ["Mira", "Lila"], ["Mira", "Lila"], ["Mira"],
    ["Mira", "Lila"], ["Mira", "Lila"], ["Mira", "Lila"], ["Mira", "Lila"],
    ["Mira"], ["Mira", "Lila"], ["Mira", "Lila"], ["Mira"],
  ];
  const out = makeValidOutput({ protagonist: "Mira", companions: ["Lila"], subjectsPerScene });
  validateStoryShape(out, { input });
  console.log(`  PASS (mixed: tier-2 Lila in companion_characters; tier-1 Bramble absent — correct)`);
}

// ---- Test 5: Opposite bug — Sonnet wrongly INCLUDES a tier-1 in companion_characters ----
console.log();
console.log("Test 5 (reverse guard) — Sonnet erroneously includes tier-1 in companion_characters → fails");
{
  const input = {
    child: { name: "Elena", age: 5, gender: "girl" },
    secondaries: [{
      name: "Pepper",
      age: 3,
      relationship: "pet",
      subject_type: "non_human",
      anchor: "tier1",
      appearance_markers: "scruffy grey-and-white dog",
    }],
    theme: "lost in the park",
  };
  // Sonnet wrongly puts Pepper in companion_characters[] (regression mode
  // — if a future prompt change reverses the directive). Validator
  // expected: [] (tier-2 only). Got: [Pepper]. Should fail.
  const out = makeValidOutput({ protagonist: "Elena", companions: ["Pepper"] });
  expectThrow(
    () => validateStoryShape(out, { input }),
    "do not match input",
    "tier-1 leaked into companion_characters",
  );
  console.log(`  PASS (reverse-direction validator catches tier-1 leakage with clear error)`);
}

// ---- Test 6: Sonnet wrongly OMITS a required tier-2 name ----
console.log();
console.log("Test 6 — Sonnet erroneously omits a tier-2 secondary → fails");
{
  const input = {
    child: { name: "Søren", age: 6, gender: "boy" },
    secondaries: [{
      name: "Theo",
      age: 7,
      gender: "boy",
      relationship: "friend",
      subject_type: "human",
      anchor: "tier2",
      appearance_markers: "stub",
    }],
    theme: "a quiet day",
  };
  // Sonnet wrongly drops Theo from companion_characters. Expected: [Theo].
  // Got: []. Should fail.
  const out = makeValidOutput({ protagonist: "Søren", companions: [] });
  expectThrow(
    () => validateStoryShape(out, { input }),
    "Expected: [Theo]",
    "tier-2 secondary missing from companion_characters",
  );
  console.log(`  PASS (validator still requires tier-2 names — original contract preserved)`);
}

// ---- Test 7: Malformed subjects_present ----
console.log();
console.log("Test 7 — Malformed subjects_present (non-array / empty) → fails cleanly");
{
  const input = {
    child: { name: "Iris", age: 6, gender: "girl" },
    secondaries: [],
    theme: "a quiet day",
  };
  // Scene 5 has subjects_present: null
  const bad1 = makeValidOutput({ protagonist: "Iris" });
  bad1.scenes[4].subjects_present = null;
  expectThrow(
    () => validateStoryShape(bad1, { input }),
    "Scene 5",
    "null subjects_present",
  );
  // Scene 5 has subjects_present: []
  const bad2 = makeValidOutput({ protagonist: "Iris" });
  bad2.scenes[4].subjects_present = [];
  expectThrow(
    () => validateStoryShape(bad2, { input }),
    "non-empty array",
    "empty subjects_present array",
  );
  // Scene 5 missing the protagonist
  const bad3 = makeValidOutput({ protagonist: "Iris" });
  bad3.scenes[4].subjects_present = ["SomeoneElse"];
  expectThrow(
    () => validateStoryShape(bad3, { input }),
    "must include the protagonist",
    "missing protagonist in subjects_present",
  );
  console.log(`  PASS (3 malformed-subjects_present variants all caught with clear errors)`);
}

// ---- Test 8: N=1 with hallucinated companion ----
console.log();
console.log("Test 8 — N=1 input with Sonnet hallucinating a companion → fails");
{
  const input = {
    child: { name: "Iris", age: 6, gender: "girl" },
    secondaries: [],
    theme: "a quiet day",
  };
  // Sonnet hallucinates a "BestFriend" companion despite N=1 input.
  // Expected: []. Got: [BestFriend]. Should fail.
  const out = makeValidOutput({ protagonist: "Iris", companions: ["BestFriend"] });
  expectThrow(
    () => validateStoryShape(out, { input }),
    "do not match input",
    "N=1 input + hallucinated companion",
  );
  console.log(`  PASS (validator catches Sonnet hallucinating companions on N=1 inputs)`);
}

console.log();
console.log("=".repeat(72));
console.log("All validateStoryShape tests passed.");
console.log("=".repeat(72));
console.log();
