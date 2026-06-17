// runPreview orchestration (S-C). Mints → uploads → marks the row, with all
// external deps injected. No network / Supabase / Gemini.
import { describe, it, expect, vi } from "vitest";
import { runPreview } from "../src/preview.js";

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
    expect(d.markDone).toHaveBeenCalledWith("p1", { imageUrl: "https://x/previews/p.png" });
    expect(r).toEqual({ previewId: "p1", status: "done", imageUrl: "https://x/previews/p.png" });
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
});
