// B — rich likeness anchor (ART_NATURAL_ENABLED). enrichThinPhotoAnchors supplements the
// page-time description of THIN, photo-anchored subjects from the minted sheet, soft-failing.
import { describe, it, expect, vi } from "vitest";
import { enrichThinPhotoAnchors, THIN_MARKERS_MAXLEN } from "../../src/book-pipeline.js";

const sheet = Buffer.from([0x89, 0x50, 0x4e, 0x47]); // PNG magic; content irrelevant (derive is faked)

function fixture(markers, { photo = true, skipped = false } = {}) {
  const subjectList = [{
    name: "Benji",
    markers,
    animalKind: "labradoodle",
    photoPaths: photo ? ["uploads/x.png"] : null,
  }];
  const subjectMetaByName = {
    Benji: { name: "Benji", subjectType: "non_human", description: "Benji is a labradoodle.", allSheets: [sheet], skipped },
  };
  return { subjectList, subjectMetaByName };
}

describe("enrichThinPhotoAnchors", () => {
  it("THIN + photo-anchored: supplements the anchor from the sheet", async () => {
    const { subjectList, subjectMetaByName } = fixture("a white patch of fur on his chest"); // ~33 chars
    const derive = vi.fn().mockResolvedValue("a curly brown labradoodle with amber eyes and a sturdy build");
    await enrichThinPhotoAnchors(subjectMetaByName, subjectList, { derive });
    expect(derive).toHaveBeenCalledOnce();
    expect(subjectMetaByName.Benji.description).toBe(
      "Benji is a labradoodle. Reference likeness: a curly brown labradoodle with amber eyes and a sturdy build",
    );
  });

  it("RICH customer appearance (>= threshold): left untouched, no derive call", async () => {
    const rich = "x".repeat(THIN_MARKERS_MAXLEN); // exactly at the cap → not thin
    const { subjectList, subjectMetaByName } = fixture(rich);
    const derive = vi.fn();
    await enrichThinPhotoAnchors(subjectMetaByName, subjectList, { derive });
    expect(derive).not.toHaveBeenCalled();
    expect(subjectMetaByName.Benji.description).toBe("Benji is a labradoodle.");
  });

  it("NOT photo-anchored: left untouched", async () => {
    const { subjectList, subjectMetaByName } = fixture("short", { photo: false });
    const derive = vi.fn();
    await enrichThinPhotoAnchors(subjectMetaByName, subjectList, { derive });
    expect(derive).not.toHaveBeenCalled();
    expect(subjectMetaByName.Benji.description).toBe("Benji is a labradoodle.");
  });

  it("derive returns null → anchor unchanged (soft-fail)", async () => {
    const { subjectList, subjectMetaByName } = fixture("short");
    await enrichThinPhotoAnchors(subjectMetaByName, subjectList, { derive: vi.fn().mockResolvedValue(null) });
    expect(subjectMetaByName.Benji.description).toBe("Benji is a labradoodle.");
  });

  it("derive THROWS → swallowed, anchor unchanged, no throw", async () => {
    const { subjectList, subjectMetaByName } = fixture("short");
    await expect(
      enrichThinPhotoAnchors(subjectMetaByName, subjectList, { derive: vi.fn().mockRejectedValue(new Error("boom")) }),
    ).resolves.toBeTruthy();
    expect(subjectMetaByName.Benji.description).toBe("Benji is a labradoodle.");
  });

  it("skipped subject: left untouched", async () => {
    const { subjectList, subjectMetaByName } = fixture("short", { skipped: true });
    const derive = vi.fn();
    await enrichThinPhotoAnchors(subjectMetaByName, subjectList, { derive });
    expect(derive).not.toHaveBeenCalled();
  });
});
