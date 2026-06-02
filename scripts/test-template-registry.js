// scripts/test-template-registry.js
// No-API-cost unit test for the v2 multi-template orchestration plumbing.
// Validates: registry loading, prompt-metadata formatting, schema enum
// construction, findTemplate lookup, and placeholder-substitution
// mechanics — all without hitting the Anthropic API. Run before any
// paid story-gen with the v2 system prompt to catch plumbing bugs cheap.

import "dotenv/config";
import {
  loadTemplateRegistry,
  buildTemplateMetadataForPrompt,
  findTemplate,
} from "../src/template-registry.js";
import { buildStorySchema } from "../src/anthropic.js";

function assert(condition, message) {
  if (!condition) {
    console.error(`FAIL: ${message}`);
    process.exit(1);
  }
}

console.log();
console.log("=".repeat(72));
console.log("Template-registry + v2-schema unit test (no API cost)");
console.log("=".repeat(72));

// ---- Test 1: registry loads all expected templates ----
console.log();
console.log("Test 1 — loadTemplateRegistry()");
const expectedIds = ["prompt-2-iter-2", "prompt-3-iter-2", "prompt-6-iter-1", "prompt-8-iter-1"];
const registry = await loadTemplateRegistry();
assert(
  registry.length === expectedIds.length,
  `expected ${expectedIds.length} templates in registry, got ${registry.length}`
);
const p2 = registry.find((t) => t.id === "prompt-2-iter-2");
const p3 = registry.find((t) => t.id === "prompt-3-iter-2");
const p6 = registry.find((t) => t.id === "prompt-6-iter-1");
const p8 = registry.find((t) => t.id === "prompt-8-iter-1");
for (const id of expectedIds) {
  assert(registry.find((t) => t.id === id), `${id} not in registry`);
}

// prompt-4-iter-1 + prompt-7-iter-1 have config.json on disk but
// config.deferred === true, so the registry loader must FILTER them out.
// See SESSION_NOTES Section 2.
assert(
  !registry.find((t) => t.id === "prompt-4-iter-1"),
  "prompt-4-iter-1 should be FILTERED from registry (deferred:true in its config.json)"
);
assert(
  !registry.find((t) => t.id === "prompt-7-iter-1"),
  "prompt-7-iter-1 should be FILTERED from registry (scrapped 2026-05-24, deferred:true in its config.json)"
);
console.log(`  PASS (registry has ${expectedIds.join(", ")}; prompt-4 + prompt-7 correctly filtered as deferred)`);

// ---- Test 2: selection_metadata shape per template ----
console.log();
console.log("Test 2 — selection_metadata schema");
for (const t of registry) {
  assert(t.selection_metadata, `${t.id}: missing selection_metadata`);
  assert(typeof t.selection_metadata.summary === "string", `${t.id}: summary not string`);
  assert(
    t.selection_metadata.max_narrative_chars === null || typeof t.selection_metadata.max_narrative_chars === "number",
    `${t.id}: max_narrative_chars wrong type`
  );
  assert(Array.isArray(t.selection_metadata.aesthetic_intent), `${t.id}: aesthetic_intent not array`);
}
assert(p2.selection_metadata.max_narrative_chars === null, "prompt-2 max_narrative_chars should be null");
assert(p3.selection_metadata.max_narrative_chars === 300, "prompt-3 max_narrative_chars should be 300");
assert(p6.selection_metadata.max_narrative_chars === 200, "prompt-6 max_narrative_chars should be 200");
assert(p8.selection_metadata.max_narrative_chars === 280, "prompt-8 max_narrative_chars should be 280");
assert(p2.selection_metadata.aesthetic_intent.includes("default"), "prompt-2 should be tagged 'default'");
assert(p3.selection_metadata.aesthetic_intent.includes("intimate"), "prompt-3 should be tagged 'intimate'");
assert(p6.selection_metadata.aesthetic_intent.includes("climactic"), "prompt-6 should be tagged 'climactic'");
assert(p8.selection_metadata.aesthetic_intent.includes("vertical"), "prompt-8 should be tagged 'vertical'");
console.log("  PASS (all templates have well-formed selection_metadata)");

// ---- Test 3: buildTemplateMetadataForPrompt formatting ----
console.log();
console.log("Test 3 — buildTemplateMetadataForPrompt()");
const desc = buildTemplateMetadataForPrompt(registry);
assert(desc.startsWith("Available templates:"), "should start with 'Available templates:'");
assert(desc.includes("prompt-2-iter-2"), "missing prompt-2");
assert(desc.includes("prompt-3-iter-2"), "missing prompt-3");
assert(desc.includes("prompt-6-iter-1"), "missing prompt-6");
assert(desc.includes("prompt-8-iter-1"), "missing prompt-8");
assert(!desc.includes("prompt-4-iter-1"), "deferred prompt-4 should not appear in template description");
assert(!desc.includes("prompt-7-iter-1"), "deferred prompt-7 should not appear in template description");
assert(desc.includes("any length"), "prompt-2 should say 'any length' for max_narrative_chars");
assert(desc.includes("300 chars"), "prompt-3 should say '300 chars' for max_narrative_chars");
assert(desc.includes("200 chars"), "prompt-6 should say '200 chars' for max_narrative_chars");
assert(desc.includes("280 chars"), "prompt-8 should say '280 chars' for max_narrative_chars");
assert(desc.includes("intimate"), "prompt-3 aesthetic_intent should include 'intimate'");
assert(desc.includes("cinematic"), "prompt-2 aesthetic_intent should include 'cinematic'");
assert(desc.includes("climactic"), "prompt-6 aesthetic_intent should include 'climactic'");
assert(desc.includes("vertical"), "prompt-8 aesthetic_intent should include 'vertical'");
console.log("  PASS");
console.log("  --- formatted output: ---");
console.log(desc.split("\n").map((line) => "  " + line).join("\n"));
console.log("  -------------------------");

// ---- Test 4: findTemplate lookup ----
console.log();
console.log("Test 4 — findTemplate()");
assert(findTemplate(registry, "prompt-2-iter-2").id === "prompt-2-iter-2", "findTemplate failed for valid id");
let threw = false;
try {
  findTemplate(registry, "nonexistent");
} catch {
  threw = true;
}
assert(threw, "findTemplate should throw on unknown id");
console.log("  PASS (returns match; throws on unknown)");

// ---- Test 5: buildStorySchema produces correct shape with runtime enum ----
console.log();
console.log("Test 5 — buildStorySchema() + runtime enum");
const schema = buildStorySchema(registry);
assert(schema.type === "object", "schema.type wrong");
assert(schema.required.includes("scenes"), "scenes not required");
const sceneItem = schema.properties.scenes.items;
assert(sceneItem.required.includes("layout_intent"), "layout_intent should be in scene required[]");
const liProps = sceneItem.properties.layout_intent;
assert(liProps.type === "object", "layout_intent.type should be object");
assert(liProps.required.includes("template_id"), "template_id should be required");
assert(liProps.required.includes("rationale"), "rationale should be required");
const tplIdProp = liProps.properties.template_id;
assert(Array.isArray(tplIdProp.enum), "template_id.enum should be an array");
assert(tplIdProp.enum.includes("prompt-2-iter-2"), "enum missing prompt-2-iter-2");
assert(tplIdProp.enum.includes("prompt-3-iter-2"), "enum missing prompt-3-iter-2");
assert(tplIdProp.enum.includes("prompt-6-iter-1"), "enum missing prompt-6-iter-1");
assert(tplIdProp.enum.includes("prompt-8-iter-1"), "enum missing prompt-8-iter-1");
assert(!tplIdProp.enum.includes("prompt-4-iter-1"), "enum should NOT include deferred prompt-4-iter-1");
assert(!tplIdProp.enum.includes("prompt-7-iter-1"), "enum should NOT include deferred prompt-7-iter-1");
assert(tplIdProp.enum.length === 4, `enum should have 4 items, got ${tplIdProp.enum.length}`);
console.log(`  PASS (enum: [${tplIdProp.enum.join(", ")}])`);

// ---- Test 6: placeholder substitution mechanics ----
console.log();
console.log("Test 6 — placeholder substitution");
const mockPrompt = "Before. {{TEMPLATE_REGISTRY_DESCRIPTION}} After.";
const substituted = mockPrompt.replace(
  /\{\{TEMPLATE_REGISTRY_DESCRIPTION\}\}/g,
  desc
);
assert(substituted.includes("Available templates:"), "substituted prompt should contain registry description");
assert(!substituted.includes("{{TEMPLATE_REGISTRY_DESCRIPTION}}"), "placeholder should be gone after substitution");
assert(substituted.startsWith("Before."), "substitution should preserve surrounding text");
assert(substituted.endsWith("After."), "substitution should preserve trailing text");
console.log("  PASS");

console.log();
console.log("=".repeat(72));
console.log("All template-registry + v2-schema tests passed.");
console.log("=".repeat(72));
console.log();
