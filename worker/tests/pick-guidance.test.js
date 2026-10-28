// Picker guidance (2026-10-28): the customer's requested change on a re-roll reaches the
// picker prompt, rides the pick into the order, and lands in the book's description.
import { describe, it, expect, vi } from "vitest";
import { cleanPickGuidance, pickerGuidanceClause, applyPickGuidance, PICK_GUIDANCE_MAX } from "../../src/pick-guidance.js";
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

describe("pickerGuidanceClause", () => {
  it("null without guidance (picker prompt unchanged)", () => {
    expect(pickerGuidanceClause(undefined)).toBeNull();
    expect(pickerGuidanceClause("  ")).toBeNull();
  });
  it("quotes the change and keeps likeness + style", () => {
    const c = pickerGuidanceClause("shorter hair");
    expect(c).toContain('"shorter hair"');
    expect(c).toMatch(/likeness to the reference photos/);
    expect(c).toMatch(/art style/);
  });
});

describe("applyPickGuidance", () => {
  const fresh = () => ({
    story: { character: "Benji is a scruffy terrier.", companion_characters: [{ name: "Matthew", character_description: "Matthew is Eddie's uncle." }, { name: "Nana", character_description: "Nana." }] },
    meta: { inputs: { child: { name: "Benji", pick_guidance: "fluffier ears" }, secondaries: [{ name: "Matthew", pick_guidance: "shorter beard." }, { name: "Nana" }] } },
  });
  it("appends to the protagonist and the matching companion only", () => {
    const { story, meta } = fresh();
    expect(applyPickGuidance(story, meta)).toEqual(["Benji", "Matthew"]);
    expect(story.character).toBe("Benji is a scruffy terrier. The family approved this look: fluffier ears.");
    expect(story.companion_characters[0].character_description).toBe("Matthew is Eddie's uncle. The family approved this look: shorter beard.");
    expect(story.companion_characters[1].character_description).toBe("Nana.");
  });
  it("is idempotent (resume / re-render never doubles it)", () => {
    const { story, meta } = fresh();
    applyPickGuidance(story, meta);
    const once = JSON.stringify(story);
    applyPickGuidance(story, meta);
    expect(JSON.stringify(story)).toBe(once);
  });
  it("no guidance anywhere → story untouched", () => {
    const story = { character: "A.", companion_characters: [{ name: "B", character_description: "B." }] };
    const before = JSON.stringify(story);
    expect(applyPickGuidance(story, { inputs: { child: { name: "A" }, secondaries: [{ name: "B" }] } })).toEqual([]);
    expect(JSON.stringify(story)).toBe(before);
  });
});

describe("adapter carries pick guidance", () => {
  const card = { name: "Matthew", subject_type: "human", gender: "boy", relationship: "uncle", appearance: "x" };
  it("companion: a usable pick's guidance → pick_guidance", () => {
    const out = adaptSecondary({ ...card, chosen_sheet: { imagePath: "orders/o/chosen/c.png", guidance: " shorter beard " } }, 0);
    expect(out.pick_guidance).toBe("shorter beard");
  });
  it("companion: degraded pick or no guidance → no key (byte-identical)", () => {
    expect(adaptSecondary({ ...card, chosen_sheet: { imagePath: "", degraded: true, guidance: "x" } }, 0)).not.toHaveProperty("pick_guidance");
    expect(adaptSecondary({ ...card, chosen_sheet: { imagePath: "p.png" } }, 0)).not.toHaveProperty("pick_guidance");
    expect(adaptSecondary(card, 0)).not.toHaveProperty("pick_guidance");
  });
  it("protagonist: order.chosen_sheet.guidance → child.pick_guidance", () => {
    const base = { book_type: "pet", child_name: "Benji", child_age: 5, child_appearance: "terrier", theme: "t", age_range: "3-5", secondaries: [] };
    expect(adaptOrderToPipelineInput({ ...base, chosen_sheet: { imagePath: "p.png", guidance: "fluffier ears" } }).child.pick_guidance).toBe("fluffier ears");
    expect(adaptOrderToPipelineInput(base).child).not.toHaveProperty("pick_guidance");
  });
});

// The real prompt path: generatePickerOption with generateImage stubbed to echo the prompt.
vi.mock("../../src/gemini.js", () => ({ generateImage: vi.fn(async (prompt) => prompt) }));

describe("generatePickerOption prompt", () => {
  const SECONDARY = { id: "companion-1", name: "Nicki", subject_type: "human", gender: "girl", is_adult: true, appearance: "a grown woman with bangs", photoPaths: [] };
  it("no guidance → the exact pre-guidance prompt; guidance → that prompt + the clause", async () => {
    const { generatePickerOption } = await import("../../src/picker-mint.js");
    const plain = await generatePickerOption({ role: "secondary", inputs: SECONDARY, artStyle: "watercolour", variantIndex: 1 }, []);
    const guided = await generatePickerOption({ role: "secondary", inputs: SECONDARY, artStyle: "watercolour", variantIndex: 1, guidance: "shorter fringe" }, []);
    expect(guided).toBe(`${plain}\n\n${pickerGuidanceClause("shorter fringe")}`);
  });
});
