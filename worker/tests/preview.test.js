// runPreview orchestration (S-C). Mints → uploads → marks the row, with all
// external deps injected. No network / Supabase / Gemini.
import { describe, it, expect, vi } from "vitest";
import sharp from "sharp";
import { runPreview } from "../src/preview.js";
import { sampleBackgroundColor } from "../../src/image-bg.js";

function deps(over = {}) {
  return {
    generateCharacterPreview: vi.fn().mockResolvedValue(Buffer.from("png")),
    markRunning: vi.fn().mockResolvedValue(),
    markDone: vi.fn().mockResolvedValue(),
    markFailed: vi.fn().mockResolvedValue(),
    upload: vi.fn().mockResolvedValue("https://x/previews/p.png"),
    getPhoto: vi.fn().mockResolvedValue(Buffer.from("photo")),
    ...over,
  };
}

describe("runPreview", () => {
  const ev = { previewId: "p1", age: 7, name: "Mia", features: { hair_colour: "brown" }, freeText: "freckles", style: "ink_wash" };

  it("structured: marks running → mints → uploads → marks done", async () => {
    const d = deps();
    const r = await runPreview(ev, d);
    expect(d.markRunning).toHaveBeenCalledWith("p1");
    expect(d.generateCharacterPreview).toHaveBeenCalledOnce();
    expect(d.generateCharacterPreview.mock.calls[0][0]).toMatchObject({ age: 7, features: ev.features, freeText: "freckles", style: "ink_wash" });
    expect(d.generateCharacterPreview.mock.calls[0][0].photoBuf).toBeUndefined();
    expect(d.getPhoto).not.toHaveBeenCalled();
    expect(d.upload).toHaveBeenCalledWith({ previewId: "p1", pngBytes: expect.any(Buffer) });
    // bgColor is sampled from the minted PNG; the stub "png" buffer isn't a real
    // image so the sampler returns null (best-effort). markDone still gets the key.
    expect(d.markDone).toHaveBeenCalledWith("p1", { imageUrl: "https://x/previews/p.png", bgColor: null });
    expect(r).toEqual({ previewId: "p1", status: "done", imageUrl: "https://x/previews/p.png", bgColor: null });
  });

  it("photo mode: downloads the photo and passes it as the anchor", async () => {
    const d = deps();
    await runPreview({ ...ev, photoPath: "uploads/p1.png" }, d);
    expect(d.getPhoto).toHaveBeenCalledWith("uploads/p1.png");
    expect(d.generateCharacterPreview.mock.calls[0][0].photoBuf).toBeInstanceOf(Buffer);
  });

  it("on mint failure: marks the row failed and rethrows", async () => {
    const boom = new Error("wall ceiling");
    const d = deps({ generateCharacterPreview: vi.fn().mockRejectedValue(boom) });
    await expect(runPreview(ev, d)).rejects.toThrow("wall ceiling");
    expect(d.markFailed).toHaveBeenCalledWith("p1", { errorMessage: "wall ceiling" });
    expect(d.markDone).not.toHaveBeenCalled();
  });

  it("samples bgColor from a real minted PNG and stores it on the row", async () => {
    // A solid-colour PNG → all 4 corners are that colour → exact hex.
    const png = await sharp({ create: { width: 24, height: 24, channels: 3, background: { r: 247, g: 242, b: 225 } } })
      .png().toBuffer();
    const d = deps({ generateCharacterPreview: vi.fn().mockResolvedValue(png) });
    await runPreview(ev, d);
    expect(d.markDone).toHaveBeenCalledWith("p1", { imageUrl: "https://x/previews/p.png", bgColor: "#f7f2e1" });
  });
});

describe("runPreview — cover scene (mode:'cover')", () => {
  function coverDeps(over = {}) {
    return {
      generateImage: vi.fn().mockResolvedValue(Buffer.from("cover-png")),
      markRunning: vi.fn().mockResolvedValue(),
      markDone: vi.fn().mockResolvedValue(),
      markFailed: vi.fn().mockResolvedValue(),
      upload: vi.fn().mockResolvedValue("https://x/previews/cover.png"),
      getPhoto: vi.fn().mockResolvedValue(Buffer.from("anchor")),
      ...over,
    };
  }

  it("photo anchor: downloads it, builds a cover prompt (canned concept + PHOTO_COND + 4:3), uploads, marks done", async () => {
    const d = coverDeps();
    const ev = { previewId: "c1", mode: "cover", style: "watercolour", themeTemplateId: "milestone_first_bike",
      anchorPath: "uploads/draft-1/abc.png", anchorKind: "photo", bookType: "child", age: 6 };
    const r = await runPreview(ev, d);
    expect(d.markRunning).toHaveBeenCalledWith("c1");
    expect(d.getPhoto).toHaveBeenCalledWith("uploads/draft-1/abc.png");
    expect(d.generateImage).toHaveBeenCalledOnce();
    const [prompt, refs, opts] = d.generateImage.mock.calls[0];
    expect(prompt).toContain("Scene:");
    expect(prompt).toContain("rides a bicycle"); // the canned concept for this theme
    expect(prompt).toContain("PHOTOGRAPH"); // photo anchor → PHOTO_COND
    expect(prompt).toContain("completely EMPTY"); // positive empty-panel instruction
    expect(refs).toHaveLength(1);
    expect(opts).toEqual({ aspectRatio: "4:3" });
    expect(d.upload).toHaveBeenCalledWith({ previewId: "c1", pngBytes: expect.any(Buffer) });
    expect(d.markDone).toHaveBeenCalledWith("c1", { imageUrl: "https://x/previews/cover.png", bgColor: null, faceQuality: undefined });
    expect(r.status).toBe("done");
  });

  it("no anchor (structured): does NOT download a photo; composes appearance; refs empty", async () => {
    const d = coverDeps();
    const ev = { previewId: "c2", mode: "cover", style: "cutpaper", themeTemplateId: "adventure_stars",
      anchorKind: "none", bookType: "child", age: 8, features: { hair_colour: "brown" }, freeText: "freckles" };
    await runPreview(ev, d);
    expect(d.getPhoto).not.toHaveBeenCalled();
    const [prompt, refs] = d.generateImage.mock.calls[0];
    expect(refs).toEqual([]);
    expect(prompt).not.toContain("PHOTOGRAPH"); // no photo anchor
    expect(prompt).toContain("cut-paper collage scene"); // style medium swapped for cutpaper
  });

  it("unknown theme → generic concept still yields a cover prompt", async () => {
    const d = coverDeps();
    await runPreview({ previewId: "c3", mode: "cover", style: "watercolour", themeTemplateId: "does_not_exist", anchorKind: "none", bookType: "child" }, d);
    const [prompt] = d.generateImage.mock.calls[0];
    expect(prompt).toContain("Scene:");
    expect(d.markDone).toHaveBeenCalled();
  });
});

describe("sampleBackgroundColor", () => {
  it("returns the corner colour as #rrggbb for a solid image", async () => {
    const png = await sharp({ create: { width: 20, height: 20, channels: 3, background: { r: 250, g: 249, b: 240 } } })
      .png().toBuffer();
    expect(await sampleBackgroundColor(png)).toBe("#faf9f0");
  });
  it("returns null on a non-image buffer (best-effort)", async () => {
    expect(await sampleBackgroundColor(Buffer.from("not-an-image"))).toBeNull();
  });
});
