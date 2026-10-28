// STORY_CRAFT (2026-10-27): storytelling rules for child + pet books, behind a flag.
import { describe, it, expect, afterEach } from "vitest";
import Anthropic from "@anthropic-ai/sdk";
import { buildReadingLevelRulesBlock, classifyError, READING_LEVELS, STORY_CRAFT_BLOCK, STORY_CRAFT_SIMPLEST_RULES } from "../../src/anthropic.js";

afterEach(() => { delete process.env.STORY_CRAFT; });

describe("STORY_CRAFT reading-level switch", () => {
  it("flag off: every level is byte-identical to before", () => {
    for (const lvl of Object.keys(READING_LEVELS)) expect(buildReadingLevelRulesBlock(lvl)).toBe(READING_LEVELS[lvl].rules);
  });
  it("flag on: only SIMPLEST changes; standard/advanced untouched", () => {
    process.env.STORY_CRAFT = "on";
    expect(buildReadingLevelRulesBlock("simplest")).toBe(STORY_CRAFT_SIMPLEST_RULES);
    expect(buildReadingLevelRulesBlock("standard")).toBe(READING_LEVELS.standard.rules);
    expect(buildReadingLevelRulesBlock("advanced")).toBe(READING_LEVELS.advanced.rules);
  });
  it("simplest under the flag keeps the length budget but drops the flatness rules", () => {
    expect(STORY_CRAFT_SIMPLEST_RULES).toMatch(/40 to 140 characters/);
    expect(STORY_CRAFT_SIMPLEST_RULES).toMatch(/Dialogue/);
    expect(STORY_CRAFT_SIMPLEST_RULES).not.toMatch(/single-clause subject-verb-object only/);
    expect(STORY_CRAFT_SIMPLEST_RULES).not.toMatch(/repeat it 3 to 5 times/);
  });
});

describe("STORY_CRAFT_BLOCK content", () => {
  it("asks for a want, a snag and the PROTAGONIST's choice; companion voices; dialogue; payoff; page-turns", () => {
    for (const re of [/WANT, A SNAG, A CHOICE/, /PROTAGONIST makes the decisive choice/, /COMPANIONS ARE CHARACTERS/, /PEOPLE TALK/, /PLANT AND PAY OFF/, /TURN THE PAGE/, /ENDING THAT ANSWERS THE BEGINNING/])
      expect(STORY_CRAFT_BLOCK).toMatch(re);
  });
  it("bans the generic phrasing found in Eddie's book", () => {
    for (const w of ["wonderful", "what a … to see", "safe and warm", "safe and sound"]) expect(STORY_CRAFT_BLOCK).toContain(w);
  });
  it("carries no real customer's details as examples (the model copies examples)", () => {
    for (const w of [/Eddie/, /Matthew/, /rocket/i]) {
      expect(STORY_CRAFT_BLOCK).not.toMatch(w);
      expect(STORY_CRAFT_SIMPLEST_RULES).not.toMatch(w);
    }
  });
  it("uses no em/en dashes itself (the prompt forbids them in prose)", () => {
    expect(STORY_CRAFT_BLOCK).not.toMatch(/[—–]/);
    expect(STORY_CRAFT_SIMPLEST_RULES.replace("READING LEVEL — SIMPLEST", "")).not.toMatch(/[—–]/);
  });
});

// Story-gen is STREAMED (2026-10-28) so long STORY_CRAFT generations don't hit the
// time-to-response caps. A streamed reply can fail after the 200 with no HTTP status.
describe("story-gen retry classification (streamed)", () => {
  it("retries an overload or server error that arrives mid-stream", () => {
    for (const type of ["overloaded_error", "api_error"]) {
      const err = new Anthropic.APIError(undefined, { type: "error", error: { type, message: "x" } }, undefined, undefined, type);
      expect(classifyError(err)?.reason).toMatch(/mid-stream/);
    }
  });
  it("does not retry a mid-stream request error", () => {
    const err = new Anthropic.APIError(undefined, { type: "error", error: { type: "invalid_request_error" } }, undefined, undefined, "invalid_request_error");
    expect(classifyError(err)).toBeNull();
  });
  it("still retries 529 and SDK connection timeouts; never 429", () => {
    expect(classifyError({ status: 529 })?.backoffs.length).toBe(2);
    expect(classifyError(new Anthropic.APIConnectionTimeoutError())).not.toBeNull();
    expect(classifyError({ status: 429 })).toBeNull();
  });
});
