// QA gate (QA_GATE_ENABLED): page-qa.checkPage must SOFT-FAIL to "pass" — it can never block a book.
import { describe, it, expect, afterEach } from "vitest";
import { checkPage } from "../../src/page-qa.js";

describe("page-qa.checkPage soft-fail contract", () => {
  const saved = process.env.ANTHROPIC_API_KEY;
  afterEach(() => { if (saved === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = saved; });

  it("no API key → verdict 'pass' with an error note, no throw", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const r = await checkPage({ imagePath: "does-not-matter.png", scene: { page: 1, action: "x", narrative_text: "y" }, subjects: [] });
    expect(r.verdict).toBe("pass");
    expect(r.error).toBe("no_key");
  });

  it("unreadable page image → verdict 'pass' (error captured), no throw", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-test-not-real"; // client constructs; readFileSync throws first
    const r = await checkPage({ imagePath: "Z:/definitely/missing/page.png", scene: { page: 1, action: "x", narrative_text: "y" }, subjects: [] });
    expect(r.verdict).toBe("pass");
    expect(typeof r.error).toBe("string");
  });
});
