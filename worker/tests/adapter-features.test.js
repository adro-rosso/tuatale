// worker/tests/adapter-features.test.js — Spec structured inputs (2026-06-11).
// adaptOrderToPipelineInput maps order.child_features → meta.inputs.child.features
// through the validateChildFeatures boundary (throws loud on bad/unknown values;
// null/absent = current free-text behaviour).
import { describe, it, expect } from "vitest";
import { adaptOrderToPipelineInput } from "../src/adapter.js";

const baseOrder = {
  child_name: "Adrian", child_age: 8, child_gender: "boy", child_appearance: "freckly",
  secondaries: [], theme: "a bike adventure", age_range: "7-9",
};

describe("adaptOrderToPipelineInput — child_features", () => {
  it("absent / null child_features → no features key (current behaviour)", () => {
    expect(adaptOrderToPipelineInput({ ...baseOrder }).child.features).toBeUndefined();
    expect(adaptOrderToPipelineInput({ ...baseOrder, child_features: null }).child.features).toBeUndefined();
  });
  it("valid child_features → mapped onto child.features (region defaulted)", () => {
    const order = { ...baseOrder, child_features: {
      hair_colour: "brown", hair_style: "tousled", skin_tone: "tan", eye_colour: "brown",
      outfit: { tee: "green" }, marks: [{ type: "mole", side: "left" }] } };
    const out = adaptOrderToPipelineInput(order);
    expect(out.child.features.hair_style).toBe("tousled");
    expect(out.child.features.outfit).toEqual({ tee: "green" });
    expect(out.child.features.marks).toEqual([{ type: "mole", side: "left", region: "cheek" }]);
  });
  it("bad value THROWS at the boundary (never reaches the pipeline silently)", () => {
    expect(() => adaptOrderToPipelineInput({ ...baseOrder, child_features: { hair_colour: "neon" } })).toThrow(/hair_colour/);
  });
  it("gender-gate enforced at the boundary too", () => {
    expect(() => adaptOrderToPipelineInput({ ...baseOrder, child_gender: "boy", child_features: { hair_style: "long" } }))
      .toThrow(/not allowed for gender/);
  });
  it("structured-only order (no free-text appearance) maps cleanly", () => {
    const order = { ...baseOrder, child_appearance: null, child_features: {
      hair_colour: "blonde", hair_style: "long", skin_tone: "fair", eye_colour: "blue" } };
    const out = adaptOrderToPipelineInput({ ...order, child_gender: "girl" });
    expect(out.child.appearance).toBeNull();
    expect(out.child.features.hair_style).toBe("long");
  });
});
