// Fail-fast + retry + hedge for the Gemini image client (2026-07-07). Proves the
// guards without hitting Google: a fake generateContent is injected via `deps`.
//   1. STALL → fail-fast at the per-attempt timeout → retry → SUCCESS.
//   2. 429 RESOURCE_EXHAUSTED → fail-fast, NO retries (credits stay visible).
//   3. SUSTAINED stall (book) → terminates as WallCeilingError (→ D2 fatal-stop
//      + R3 resume behaviour unchanged).
//   4. PREVIEW hedge → 2 parallel branches, first success wins.
//   5. PREVIEW hedge + 429 on every branch → fail-fast credit error, no retries.
import { describe, it, expect } from "vitest";
import { generateImage } from "../../src/gemini.js";
import { WallCeilingError } from "../../src/wall-ceiling.js";

const PNG = { candidates: [{ content: { parts: [{ inlineData: { data: Buffer.from("fake-png").toString("base64"), mimeType: "image/png" } }] } }] };
// A call that hangs until its abortSignal fires (simulates a Gemini stall).
const hang = (args) => new Promise((_, reject) => {
  args.config.abortSignal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })), { once: true });
});
const err429 = () => { throw Object.assign(new Error("RESOURCE_EXHAUSTED: quota"), { status: 429 }); };

describe("gemini fail-fast + retry + hedge", () => {
  it("1. stall → fail-fast at per-attempt timeout → retry → success", async () => {
    let n = 0;
    const generateContent = (args) => { n += 1; return n === 1 ? hang(args) : Promise.resolve(PNG); };
    const t0 = Date.now();
    const buf = await generateImage("p", [], {}, { callKind: "page_render", perAttemptTimeoutMs: 150 }, { generateContent });
    const elapsed = Date.now() - t0;
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(n).toBe(2);                 // hung once, retried, succeeded
    expect(elapsed).toBeGreaterThanOrEqual(150);  // aborted at the per-attempt timeout
    expect(elapsed).toBeLessThan(3000);           // NOT the 300s ceiling
  });

  it("2. 429 → fail-fast, no retries, surfaces the credit error", async () => {
    let n = 0;
    const generateContent = () => { n += 1; return err429(); };
    const t0 = Date.now();
    await expect(
      generateImage("p", [], {}, { callKind: "page_render", perAttemptTimeoutMs: 150 }, { generateContent })
    ).rejects.toMatchObject({ status: 429 });
    expect(n).toBe(1);                              // NO retries on credits
    expect(Date.now() - t0).toBeLessThan(150);      // returned before the per-attempt timeout
  });

  it("3. sustained stall (book) → WallCeilingError (preserves D2 fatal-stop)", async () => {
    let n = 0;
    const generateContent = (args) => { n += 1; return hang(args); };  // always hangs
    let caught;
    try {
      // ceiling (2000) comfortably exceeds per-attempt (60) + book backoff (1500),
      // so >=2 attempts run before the ceiling fires — as in the real 300s/70s/1.5s case.
      await generateImage("p", [], {}, { callKind: "page_render", perAttemptTimeoutMs: 60, wallCeilingMs: 2000 }, { generateContent });
    } catch (e) { caught = e; }
    expect(caught).toBeInstanceOf(WallCeilingError);       // → classifyFailure "F" fatal-stop
    expect(caught.toJSON().kind).toBe("wall_ceiling_exceeded");
    expect(n).toBeGreaterThanOrEqual(2);                   // retried within the ceiling before it fired
  });

  it("4. preview hedge → 2 parallel branches, first success wins", async () => {
    let n = 0;
    const generateContent = () => { n += 1; return Promise.resolve(PNG); };
    const buf = await generateImage("p", [], {}, { callKind: "preview_mint" }, { generateContent });
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(n).toBe(2);                              // exactly 2 hedge branches (no book pages ever hedge)
  });

  it("5. preview hedge + 429 everywhere → fail-fast credit error, no retries", async () => {
    let n = 0;
    const generateContent = () => { n += 1; return err429(); };
    const t0 = Date.now();
    await expect(
      generateImage("p", [], {}, { callKind: "preview_mint" }, { generateContent })
    ).rejects.toMatchObject({ status: 429 });
    expect(n).toBe(2);                              // one per hedge branch, no retries
    expect(Date.now() - t0).toBeLessThan(1000);
  });
});
