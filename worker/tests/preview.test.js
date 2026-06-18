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
