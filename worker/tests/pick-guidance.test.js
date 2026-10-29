// Picker guidance (2026-10-28, revised 2026-10-29): the customer's requested change on a re-roll
// reaches the picker prompt (safely scoped); an option picked from a guided batch is flagged
// `guided`; the book then describes that character from the PICKED picture. The guidance text
// itself never reaches the book.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { cleanPickGuidance, isPickGuidanceAllowed, pickerGuidanceClause, PICK_GUIDANCE_MAX } from "../../src/pick-guidance.js";
import { applyPhotoAppearance } from "../../src/book-pipeline.js";
import { adaptOrderToPipelineInput, adaptSecondary } from "../src/adapter.js";

describe("cleanPickGuidance", () => {
  it("absent / blank / non-string → null", () => {
    for (const v of [undefined, null, "", "   ", 42, {}]) expect(cleanPickGuidance(v)).toBeNull();
  });
  it("one safe line: no newlines or control chars, double quotes softened, capped", () => {
    expect(cleanPickGuidance('  shorter hair\n\nand "round" glasses\u0007 ')).toBe("shorter hair and 'round' glasses");
    expect(cleanPickGuidance("x".repeat(500))).toHaveLength(PICK_GUIDANCE_MAX);
  });
});

describe("guidance safety", () => {
  it("allows ordinary appearance changes", () => {
    for (const g of ["shorter hair, rounder glasses", "a red jumper instead of blue", "curlier hair and a beard", "less smiley, more freckles"])
      expect(isPickGuidanceAllowed(g)).toBe(true);
  });
  it("refuses nudity, sexual content, violence, substances and explicit ages", () => {
    for (const g of ["make him shirtless", "in a bikini", "sexy pose", "holding a gun", "with a cigarette", "make her look 25 years old", "blood on his shirt"])
      expect(isPickGuidanceAllowed(g)).toBe(false);
  });
  it("a refused request produces NO clause (the picker prompt is unchanged)", () => {
    expect(pickerGuidanceClause("make him shirtless")).toBeNull();
  });
});

describe("pickerGuidanceClause", () => {
  it("null without guidance (picker prompt unchanged)", () => {
    expect(pickerGuidanceClause(undefined)).toBeNull();
    expect(pickerGuidanceClause("  ")).toBeNull();
  });
  it("quotes the change, scopes it to visible details, keeps age/body/clothing, likeness and style", () => {
    const c = pickerGuidanceClause("shorter hair");
    expect(c).toContain('"shorter hair"');
    expect(c).toMatch(/only to visible details/);
    expect(c).toMatch(/Keep their age, body shape and full everyday clothing/);
    expect(c).toMatch(/never add written words/);
    expect(c).toMatch(/likeness to the reference photos/);
  });
});

describe("adapter flags a guided pick (and only a usable one)", () => {
  const card = { name: "Matthew", subject_type: "human", gender: "boy", relationship: "uncle", appearance: "x" };
  it("companion: a usable guided pick → pick_guided", () => {
    expect(adaptSecondary({ ...card, chosen_sheet: { imagePath: "orders/o/chosen/c.png", guided: true } }, 0).pick_guided).toBe(true);
  });
  it("companion: unguided, degraded or pathless pick → no key (byte-identical)", () => {
    expect(adaptSecondary({ ...card, chosen_sheet: { imagePath: "p.png" } }, 0)).not.toHaveProperty("pick_guided");
    expect(adaptSecondary({ ...card, chosen_sheet: { imagePath: "", degraded: true, guided: true } }, 0)).not.toHaveProperty("pick_guided");
    expect(adaptSecondary({ ...card, chosen_sheet: { guided: true } }, 0)).not.toHaveProperty("pick_guided");
    expect(adaptSecondary(card, 0)).not.toHaveProperty("pick_guided");
  });
  it("protagonist: order.chosen_sheet.guided → child.pick_guided", () => {
    const base = { book_type: "pet", child_name: "Benji", child_age: 5, child_appearance: "terrier", theme: "t", age_range: "3-5", secondaries: [] };
    expect(adaptOrderToPipelineInput({ ...base, chosen_sheet: { imagePath: "p.png", guided: true } }).child.pick_guided).toBe(true);
    expect(adaptOrderToPipelineInput(base).child).not.toHaveProperty("pick_guided");
  });
});

describe("book describes a guided pick from the PICKED picture", () => {
  const PHOTO = Buffer.from("photo");
  const PICKED = Buffer.from("picked");
  let tmp;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pick-guided-")); process.env.PHOTO_APPEARANCE = "on"; });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); delete process.env.PHOTO_APPEARANCE; });

  const fixture = (guided) => ({
    story: { character: "Eddie is 4.", companion_characters: [{ name: "Matthew", character_description: "Matthew is tall. He wears a grey sweatshirt." }] },
    meta: { inputs: {
      child: { name: "Eddie", age: 4, gender: "boy" },
      secondaries: [{ id: "companion-1", name: "Matthew", subject_type: "human", relationship: "uncle", photo_paths: ["/p/m.png"], ...(guided ? { pick_guided: true } : {}) }],
    } },
  });

  it("guided + locked picked sheet on disk → derived from that picture, not the photos", async () => {
    fs.mkdirSync(path.join(tmp, "character-sheets"), { recursive: true });
    fs.writeFileSync(path.join(tmp, "character-sheets", "companion-1-01.png"), PICKED);
    const { story, meta } = fixture(true);
    const derive = vi.fn().mockResolvedValue("A man with long wavy hair.");
    const deriveSheet = vi.fn().mockResolvedValue("A man with short cropped hair.");
    const readFile = (f) => (String(f).endsWith("companion-1-01.png") ? PICKED : PHOTO);
    await applyPhotoAppearance(story, meta, { outputDir: tmp, derive, deriveSheet, readFile });
    expect(derive).not.toHaveBeenCalled();
    expect(deriveSheet).toHaveBeenCalledWith(PICKED, { subjectType: "human", physicalOnly: true });
    expect(story.companion_characters[0].character_description).toBe("Matthew is Eddie's uncle. A man with short cropped hair. He wears a grey sweatshirt.");
  });

  it("picked-picture description that is only clothing (or empty) → falls back to the photos", async () => {
    fs.mkdirSync(path.join(tmp, "character-sheets"), { recursive: true });
    fs.writeFileSync(path.join(tmp, "character-sheets", "companion-1-01.png"), PICKED);
    for (const bad of ["A man wearing a grey hoodie.", null]) {
      const { story, meta } = fixture(true);
      fs.rmSync(path.join(tmp, "character-sheets", "photo-appearance-companion-1.json"), { force: true });
      const derive = vi.fn().mockResolvedValue("A man with long wavy hair.");
      const deriveSheet = vi.fn().mockResolvedValue(bad);
      await applyPhotoAppearance(story, meta, { outputDir: tmp, derive, deriveSheet, readFile: (f) => (String(f).endsWith("-01.png") ? PICKED : PHOTO) });
      expect(derive).toHaveBeenCalledWith([PHOTO]);
      expect(story.companion_characters[0].character_description).toContain("A man with long wavy hair.");
    }
  });

  it("not guided → photos as before (deriveSheet never called)", async () => {
    const { story, meta } = fixture(false);
    const derive = vi.fn().mockResolvedValue("A man with long wavy hair.");
    const deriveSheet = vi.fn();
    await applyPhotoAppearance(story, meta, { outputDir: tmp, derive, deriveSheet, readFile: () => PHOTO });
    expect(deriveSheet).not.toHaveBeenCalled();
    expect(derive).toHaveBeenCalledWith([PHOTO]);
  });

  it("guided but the picked sheet is missing (degraded at gen time) → falls back to the photos", async () => {
    const { story, meta } = fixture(true);
    const derive = vi.fn().mockResolvedValue("A man with long wavy hair.");
    const deriveSheet = vi.fn();
    await applyPhotoAppearance(story, meta, { outputDir: tmp, derive, deriveSheet, readFile: () => PHOTO });
    expect(deriveSheet).not.toHaveBeenCalled();
    expect(derive).toHaveBeenCalled();
  });
});

// The real prompt path: generatePickerOption with generateImage stubbed to echo the prompt.
vi.mock("../../src/gemini.js", () => ({ generateImage: vi.fn(async (prompt) => prompt) }));

describe("generatePickerOption prompt", () => {
  const SECONDARY = { id: "companion-1", name: "Nicki", subject_type: "human", gender: "girl", is_adult: true, appearance: "a grown woman with bangs", photoPaths: [] };
  it("no guidance → the exact pre-guidance prompt; guidance → that prompt + the clause; refused → unchanged", async () => {
    const { generatePickerOption } = await import("../../src/picker-mint.js");
    const plain = await generatePickerOption({ role: "secondary", inputs: SECONDARY, artStyle: "watercolour", variantIndex: 1 }, []);
    const guided = await generatePickerOption({ role: "secondary", inputs: SECONDARY, artStyle: "watercolour", variantIndex: 1, guidance: "shorter fringe" }, []);
    const refused = await generatePickerOption({ role: "secondary", inputs: SECONDARY, artStyle: "watercolour", variantIndex: 1, guidance: "in a bikini" }, []);
    expect(guided).toBe(`${plain}\n\n${pickerGuidanceClause("shorter fringe")}`);
    expect(refused).toBe(plain);
  });
});
