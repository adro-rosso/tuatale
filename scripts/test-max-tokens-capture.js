// scripts/test-max-tokens-capture.js
// No-API-cost unit tests for the Item 2 max_tokens diagnostic capture path
// in src/anthropic.js. Tests the standalone captureMaxTokensFailure() +
// MaxTokensError class directly with a stubbed Sonnet response (no SDK
// mocking required, no Anthropic API call).

// dotenv before src/anthropic.js: the module's API-key check fires at import
// time; this file doesn't call the API but the import would still fail without
// the env var present.
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  captureMaxTokensFailure,
  MaxTokensError,
  captureRefusalFailure,
  RefusalError,
} from "../src/anthropic.js";

function assert(condition, message) {
  if (!condition) {
    console.error(`FAIL: ${message}`);
    process.exit(1);
  }
}
function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "daboo-maxtoken-test-"));
}

// A realistic-shaped truncated Sonnet response. Real responses have content
// blocks for thinking + text + tool_use; we mock the relevant fields.
function stubTruncatedResponse({ outputTokens = 16384, inputTokens = 5135 } = {}) {
  return {
    id: "msg_test_truncated_001",
    type: "message",
    role: "assistant",
    model: "claude-sonnet-4-6",
    stop_reason: "max_tokens",
    stop_sequence: null,
    usage: { input_tokens: inputTokens, output_tokens: outputTokens },
    content: [
      { type: "thinking", thinking: "The story arc should..." },
      {
        type: "text",
        text: '{"title":"The Truncated Story","character":"Iris is six years old, ...",'
            + '"companion_characters":[],"scenes":[{"page":1,"action":"Iris stands at the window..."',
      },
    ],
  };
}

console.log();
console.log("=".repeat(72));
console.log("max_tokens capture unit test (no API cost)");
console.log("=".repeat(72));

// ---- Test 1: captureMaxTokensFailure writes valid JSON with expected shape ----
console.log();
console.log("Test 1 — captureMaxTokensFailure writes valid JSON to disk with all expected fields");
{
  const dir = tempDir();
  const response = stubTruncatedResponse({ outputTokens: 16384, inputTokens: 5135 });
  const inputSummary = { protagonist: "Iris", subjects_count: 1, scenes_requested: 12, theme: "midnight library" };
  const filePath = captureMaxTokensFailure({
    rawResponse: response,
    inputSummary,
    maxTokensConfigured: 16384,
    failureDir: dir,
  });
  assert(fs.existsSync(filePath), `captured file not on disk: ${filePath}`);
  assert(filePath.endsWith(".json"), `captured file should end .json: ${filePath}`);
  assert(filePath.includes("max-tokens-truncation"), `filename should include "max-tokens-truncation": ${filePath}`);
  const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
  assert(parsed.kind === "max_tokens_truncation", `parsed.kind: ${parsed.kind}`);
  assert(parsed.max_tokens_configured === 16384, `max_tokens_configured: ${parsed.max_tokens_configured}`);
  assert(parsed.tokens_used === 16384, `tokens_used: ${parsed.tokens_used}`);
  assert(parsed.input_tokens === 5135, `input_tokens: ${parsed.input_tokens}`);
  assert(parsed.stop_reason === "max_tokens", `stop_reason: ${parsed.stop_reason}`);
  assert(parsed.input_summary?.protagonist === "Iris", `input_summary.protagonist: ${parsed.input_summary?.protagonist}`);
  assert(parsed.input_summary?.theme === "midnight library", `input_summary.theme: ${parsed.input_summary?.theme}`);
  assert(parsed.raw_response?.id === "msg_test_truncated_001", `raw_response.id preserved`);
  assert(Array.isArray(parsed.raw_response?.content) && parsed.raw_response.content.length === 2, `raw_response.content preserved`);
  assert(parsed.captured_to === filePath, `captured_to should be self-referential: ${parsed.captured_to}`);
  assert(typeof parsed.timestamp === "string" && parsed.timestamp.match(/^\d{4}-\d{2}-\d{2}T/), `timestamp ISO format`);
  console.log(`  PASS (captured file: ${path.basename(filePath)})`);
}

// ---- Test 2: atomicity — no .tmp file lingers after the write ----
console.log();
console.log("Test 2 — atomic write leaves no .tmp file lingering");
{
  const dir = tempDir();
  for (let i = 0; i < 5; i++) {
    captureMaxTokensFailure({
      rawResponse: stubTruncatedResponse(),
      inputSummary: { protagonist: `Test${i}`, subjects_count: 1, scenes_requested: 12, theme: "x" },
      maxTokensConfigured: 16384,
      failureDir: dir,
    });
    // Force a small wait so subsequent tsForName slugs differ (timestamps include ms).
    // (Even without this, 5 captures in the same ms would just overwrite each other,
    // which is fine — the test cares about no .tmp lingering, not file count.)
  }
  const filesAfter = fs.readdirSync(dir);
  const tmpFiles = filesAfter.filter((f) => f.endsWith(".tmp"));
  assert(tmpFiles.length === 0, `lingering .tmp files: ${tmpFiles.join(", ")}`);
  const jsonFiles = filesAfter.filter((f) => f.endsWith(".json"));
  assert(jsonFiles.length >= 1, `at least 1 captured .json should be on disk, got ${jsonFiles.length}`);
  for (const f of jsonFiles) {
    const parsed = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
    assert(parsed.kind === "max_tokens_truncation", `${f}: kind`);
  }
  console.log(`  PASS (no .tmp lingering; ${jsonFiles.length} valid .json captures)`);
}

// ---- Test 3: MaxTokensError construction + toJSON ----
console.log();
console.log("Test 3 — MaxTokensError carries structured fields + toJSON round-trips");
{
  const inputSummary = { protagonist: "Theo", subjects_count: 1, scenes_requested: 12, theme: "exploring the forest" };
  const err = new MaxTokensError({
    maxTokensConfigured: 16384,
    tokensUsed: 16384,
    inputSummary,
    capturedToPath: "/tmp/example-capture.json",
    stopReason: "max_tokens",
  });
  assert(err instanceof MaxTokensError, "instanceof check");
  assert(err instanceof Error, "should also be Error");
  assert(err.name === "MaxTokensError", `name: ${err.name}`);
  assert(err.kind === "max_tokens_truncation", `kind: ${err.kind}`);
  assert(err.max_tokens_configured === 16384, `max_tokens_configured: ${err.max_tokens_configured}`);
  assert(err.tokens_used === 16384, `tokens_used: ${err.tokens_used}`);
  assert(err.input_summary?.protagonist === "Theo", `input_summary preserved`);
  assert(err.captured_to === "/tmp/example-capture.json", `captured_to preserved`);
  assert(err.stop_reason === "max_tokens", `stop_reason preserved`);
  assert(typeof err.message === "string" && err.message.includes("16384"), `message includes config: ${err.message}`);
  assert(err.message.includes("/tmp/example-capture.json"), `message includes captured_to path`);
  // toJSON for status.json serialization
  const serialized = err.toJSON();
  assert(serialized.kind === "max_tokens_truncation", "toJSON kind discriminator");
  assert(serialized.max_tokens_configured === 16384, "toJSON max_tokens_configured");
  assert(serialized.tokens_used === 16384, "toJSON tokens_used");
  assert(serialized.input_summary?.protagonist === "Theo", "toJSON input_summary");
  assert(serialized.captured_to === "/tmp/example-capture.json", "toJSON captured_to");
  assert(typeof serialized.message === "string", "toJSON message");
  // JSON.stringify should serialize cleanly (no circular refs, no functions)
  const jsonStr = JSON.stringify(err);
  const reParsed = JSON.parse(jsonStr);
  assert(reParsed.kind === "max_tokens_truncation", "JSON.stringify round-trips");
  console.log(`  PASS (MaxTokensError structured + serializable)`);
}

// ---- Test 4: tokens_used null fallback when response lacks usage ----
console.log();
console.log("Test 4 — tokens_used defaults to null when response.usage missing");
{
  const dir = tempDir();
  const responseNoUsage = { ...stubTruncatedResponse(), usage: undefined };
  const filePath = captureMaxTokensFailure({
    rawResponse: responseNoUsage,
    inputSummary: { protagonist: "X", subjects_count: 1, scenes_requested: 12, theme: "y" },
    maxTokensConfigured: 16384,
    failureDir: dir,
  });
  const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
  assert(parsed.tokens_used === null, `tokens_used should be null when usage missing, got ${parsed.tokens_used}`);
  assert(parsed.input_tokens === null, `input_tokens should be null when usage missing, got ${parsed.input_tokens}`);
  console.log(`  PASS (null fallback)`);
}

// ---- Test 5: failureDir is created if it doesn't exist ----
console.log();
console.log("Test 5 — captureMaxTokensFailure creates failureDir if missing");
{
  const parentTmp = fs.mkdtempSync(path.join(os.tmpdir(), "daboo-maxtoken-mkdir-"));
  const nested = path.join(parentTmp, "deep", "nested", "_failed");
  assert(!fs.existsSync(nested), "precondition: nested dir should not exist");
  captureMaxTokensFailure({
    rawResponse: stubTruncatedResponse(),
    inputSummary: { protagonist: "X", subjects_count: 1, scenes_requested: 12, theme: "y" },
    maxTokensConfigured: 16384,
    failureDir: nested,
  });
  assert(fs.existsSync(nested), "nested dir should be created");
  const files = fs.readdirSync(nested).filter((f) => f.endsWith(".json"));
  assert(files.length === 1, `should have 1 capture, got ${files.length}`);
  console.log(`  PASS (recursive mkdir works)`);
}

// ============================================================================
// Item 5 F3 — Refusal capture
// ============================================================================

function stubRefusalResponse({ outputTokens = 47, inputTokens = 5135, category = "unsafe_content" } = {}) {
  return {
    id: "msg_test_refused_001",
    type: "message",
    role: "assistant",
    model: "claude-sonnet-4-6",
    stop_reason: "refusal",
    stop_details: { category },
    usage: { input_tokens: inputTokens, output_tokens: outputTokens },
    content: [],
  };
}

console.log();
console.log("=".repeat(72));
console.log("Item 5 F3 — refusal capture");
console.log("=".repeat(72));

// ---- Test 6 — captureRefusalFailure writes valid JSON with all fields ----
console.log();
console.log("Test 6 (F3) — captureRefusalFailure writes diagnostic with prompt + response + category");
{
  const dir = tempDir();
  const response = stubRefusalResponse({ category: "harassment" });
  const inputSummary = { protagonist: "TestKid", subjects_count: 1, scenes_requested: 12, theme: "trigger theme" };
  const filePath = captureRefusalFailure({
    rawResponse: response,
    systemPrompt: "You are a children's book author.",
    userMessage: "Write a story about [redacted scenario]",
    safetyCategory: "harassment",
    inputSummary,
    failureDir: dir,
  });
  assert(fs.existsSync(filePath), `captured file not on disk: ${filePath}`);
  assert(filePath.endsWith("-refusal.json"), `filename should end -refusal.json: ${filePath}`);
  const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
  assert(parsed.kind === "refusal", `kind: ${parsed.kind}`);
  assert(parsed.safety_category === "harassment", `safety_category: ${parsed.safety_category}`);
  assert(parsed.tokens_used === 47, `tokens_used: ${parsed.tokens_used}`);
  assert(parsed.input_tokens === 5135, `input_tokens: ${parsed.input_tokens}`);
  assert(parsed.system_prompt === "You are a children's book author.", "system_prompt preserved");
  assert(parsed.user_message?.includes("[redacted scenario]"), "user_message preserved");
  assert(parsed.input_summary?.protagonist === "TestKid", "input_summary preserved");
  assert(parsed.raw_response?.id === "msg_test_refused_001", "raw_response preserved");
  assert(parsed.captured_to === filePath, "captured_to self-referential");
  console.log(`  PASS (refusal diagnostic with sent prompt + response captured)`);
}

// ---- Test 7 — RefusalError carries structured fields + toJSON round-trips ----
console.log();
console.log("Test 7 (F3) — RefusalError structured + serializable");
{
  const err = new RefusalError({
    safetyCategory: "violence",
    tokensUsed: 12,
    inputSummary: { protagonist: "X", subjects_count: 1, scenes_requested: 12, theme: "y" },
    capturedToPath: "/tmp/example-refusal.json",
  });
  assert(err instanceof RefusalError, "instanceof RefusalError");
  assert(err instanceof Error, "instanceof Error");
  assert(err.name === "RefusalError", `name: ${err.name}`);
  assert(err.kind === "refusal", `kind: ${err.kind}`);
  assert(err.safety_category === "violence", `safety_category: ${err.safety_category}`);
  assert(err.captured_to === "/tmp/example-refusal.json", `captured_to`);
  assert(err.message.includes("violence"), "message contains category");
  assert(err.message.includes("/tmp/example-refusal.json"), "message contains captured_to");
  const serialized = err.toJSON();
  assert(serialized.kind === "refusal", "toJSON kind");
  assert(serialized.safety_category === "violence", "toJSON safety_category");
  assert(serialized.captured_to === "/tmp/example-refusal.json", "toJSON captured_to");
  const reParsed = JSON.parse(JSON.stringify(err));
  assert(reParsed.kind === "refusal", "JSON.stringify round-trips");
  console.log(`  PASS`);
}

// ---- Test 8 — Missing safety_category defaults gracefully ----
console.log();
console.log("Test 8 (F3) — missing safety_category defaults to 'unspecified'");
{
  const dir = tempDir();
  const filePath = captureRefusalFailure({
    rawResponse: stubRefusalResponse({ category: undefined }),
    systemPrompt: "sys",
    userMessage: "user",
    safetyCategory: undefined,
    inputSummary: { protagonist: "X", subjects_count: 1, scenes_requested: 12, theme: "y" },
    failureDir: dir,
  });
  const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
  assert(parsed.safety_category === null, `null on missing, got ${parsed.safety_category}`);
  const err = new RefusalError({ safetyCategory: undefined, tokensUsed: null, inputSummary: {}, capturedToPath: filePath });
  assert(err.safety_category === "unspecified", `error defaults to 'unspecified'`);
  console.log(`  PASS`);
}

console.log();
console.log("=".repeat(72));
console.log("All max_tokens capture + refusal tests passed.");
console.log("=".repeat(72));
console.log();
