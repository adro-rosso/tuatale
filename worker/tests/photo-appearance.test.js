// PHOTO_APPEARANCE (2026-10-21): photo-derived physical description for photo-anchored humans,
// applied before planBook, cached per book dir, soft-failing, flag-gated (off → byte-identical).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { applyPhotoAppearance, PHOTO_APPEARANCE_CACHE_PREFIX } from "../../src/book-pipeline.js";

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

function fixture() {
  const story = {
    character: "Eddie is 4 years old, a little boy with an easy, joyful manner. He wears a cobalt-blue top, grey joggers, and white trainers.",
    companion_characters: [{
      name: "Matthew",
      character_description: "Matthew is Eddie's uncle, a grown man with a tall, lean frame and a strong, square jaw. A wide, easy grin sits on his face. He wears a dark grey crewneck sweatshirt, dark jeans, and clean white trainers.",
    }],
  };
  const meta = { inputs: {
    child: { name: "Eddie", age: 4, gender: "boy", photo_paths: ["/p/child-1.png", "/p/child-2.png"] },
    secondaries: [{ name: "Matthew", subject_type: "human", gender: "boy", relationship: "uncle", photo_paths: ["/p/c-1.png"] }],
  } };
  return { story, meta };
}

let tmp;
beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), "photo-appearance-")); delete process.env.PHOTO_APPEARANCE; });
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); delete process.env.PHOTO_APPEARANCE; });

describe("applyPhotoAppearance", () => {
  it("flag off → no-op, derive never called, story byte-identical", async () => {
    const { story, meta } = fixture();
    const snapshot = JSON.stringify(story);
    const derive = vi.fn();
    const applied = await applyPhotoAppearance(story, meta, { outputDir: tmp, derive, readFile: () => PNG });
    expect(applied).toEqual([]);
    expect(derive).not.toHaveBeenCalled();
    expect(JSON.stringify(story)).toBe(snapshot);
  });

  it("flag on → humans with photos get a photo-derived description; outfit sentence kept; lead is neutral", async () => {
    process.env.PHOTO_APPEARANCE = "on";
    const { story, meta } = fixture();
    const derive = vi.fn()
      .mockResolvedValueOnce("A person with a round face and fair hair.")
      .mockResolvedValueOnce("A person with a fuller face, heavy brows, and a sturdy build.");
    const readFile = vi.fn(() => PNG);
    const applied = await applyPhotoAppearance(story, meta, { outputDir: tmp, derive, readFile });
    expect(applied).toEqual(["Eddie", "Matthew"]);
    expect(derive).toHaveBeenCalledTimes(2);
    expect(derive.mock.calls[0][0]).toHaveLength(2); // both child photos sent
    expect(story.character).toBe("Eddie is 4 years old. A person with a round face and fair hair. He wears a cobalt-blue top, grey joggers, and white trainers.");
    expect(story.companion_characters[0].character_description).toBe(
      "Matthew is Eddie's uncle. A person with a fuller face, heavy brows, and a sturdy build. He wears a dark grey crewneck sweatshirt, dark jeans, and clean white trainers.",
    );
    // No story-written build/attitude words survive.
    expect(story.companion_characters[0].character_description).not.toMatch(/\blean\b|square jaw|\bgrin/);
  });

  it("caches the derived text per book dir so a re-render reuses the same words (no re-mint drift)", async () => {
    process.env.PHOTO_APPEARANCE = "on";
    const first = fixture();
    const derive = vi.fn().mockResolvedValue("A person with a fuller face.");
    await applyPhotoAppearance(first.story, first.meta, { outputDir: tmp, derive, readFile: () => PNG });
    expect(fs.existsSync(path.join(tmp, "character-sheets", `${PHOTO_APPEARANCE_CACHE_PREFIX}companion-1.json`))).toBe(true);
    const second = fixture();
    const derive2 = vi.fn().mockResolvedValue("DIFFERENT words");
    await applyPhotoAppearance(second.story, second.meta, { outputDir: tmp, derive: derive2, readFile: () => PNG });
    expect(derive2).not.toHaveBeenCalled();
    expect(second.story.character).toBe(first.story.character);
    expect(second.story.companion_characters[0].character_description).toBe(first.story.companion_characters[0].character_description);
  });

  it("flag OFF but a cache file exists → cached words are applied (station re-render keeps the fingerprint)", async () => {
    process.env.PHOTO_APPEARANCE = "on";
    const first = fixture();
    await applyPhotoAppearance(first.story, first.meta, { outputDir: tmp, derive: vi.fn().mockResolvedValue("A person with a fuller face."), readFile: () => PNG });
    delete process.env.PHOTO_APPEARANCE;
    const again = fixture();
    const derive = vi.fn();
    const applied = await applyPhotoAppearance(again.story, again.meta, { outputDir: tmp, derive, readFile: () => PNG });
    expect(derive).not.toHaveBeenCalled();
    expect(applied).toEqual(["Eddie", "Matthew"]);
    expect(again.story.character).toBe(first.story.character);
    expect(again.story.companion_characters[0].character_description).toBe(first.story.companion_characters[0].character_description);
  });

  it("re-application is idempotent: an already-rewritten description is left byte-identical", async () => {
    process.env.PHOTO_APPEARANCE = "on";
    const { story, meta } = fixture();
    const derive = vi.fn().mockResolvedValue("A person with a fuller face. He wears glasses."); // clothing slip in the descriptor
    await applyPhotoAppearance(story, meta, { outputDir: tmp, derive, readFile: () => PNG });
    const once = JSON.stringify(story);
    expect(story.character).not.toMatch(/glasses/); // the slipped wear-sentence is dropped, never duplicated
    await applyPhotoAppearance(story, meta, { outputDir: tmp, derive, readFile: () => PNG });
    expect(JSON.stringify(story)).toBe(once);
  });

  it("outfit sentences: 'dressed in' and 'wore' are kept, 'Mr.' does not fragment, missing outfit logs", async () => {
    process.env.PHOTO_APPEARANCE = "on";
    const { story, meta } = fixture();
    story.character = "Eddie is 4 years old. Mr. Bun is his toy. He is dressed in a red jumper and shorts";
    story.companion_characters[0].character_description = "Matthew is tall. No clothing here.";
    const log = { log: vi.fn() };
    await applyPhotoAppearance(story, meta, { outputDir: tmp, derive: vi.fn().mockResolvedValue("A person with a round face."), readFile: () => PNG, log });
    expect(story.character).toBe("Eddie is 4 years old. A person with a round face. He is dressed in a red jumper and shorts.");
    expect(story.companion_characters[0].character_description).toBe("Matthew is Eddie's uncle. A person with a round face.");
    expect(log.log.mock.calls.some((c) => /no outfit sentence/.test(String(c[0])))).toBe(true);
  });

  it("skips non-human and photo-less subjects; derive null → untouched (soft-fail)", async () => {
    process.env.PHOTO_APPEARANCE = "on";
    const { story, meta } = fixture();
    meta.inputs.secondaries[0].subject_type = "non_human";
    delete meta.inputs.child.photo_paths;
    const derive = vi.fn().mockResolvedValue(null);
    const before = JSON.stringify(story);
    const applied = await applyPhotoAppearance(story, meta, { outputDir: tmp, derive, readFile: () => PNG });
    expect(applied).toEqual([]);
    expect(derive).not.toHaveBeenCalled();
    expect(JSON.stringify(story)).toBe(before);
    // derive returning null on a valid target → untouched
    meta.inputs.child.photo_paths = ["/p/child-1.png"];
    const applied2 = await applyPhotoAppearance(story, meta, { outputDir: tmp, derive, readFile: () => PNG });
    expect(applied2).toEqual([]);
    expect(JSON.stringify(story)).toBe(before);
  });
});
