// worker/tests/photo-selection.test.js — selectBestPhotos (2026-07-24).
// Ranks a HUMAN subject's downloaded photos by face size (YuNet) and anchors the mint
// on the clear-face ones. Tested with an INJECTED scorer (no onnxruntime in unit tests);
// the real YuNet decode is parity-checked separately against the Python calibration.
import { describe, it, expect, vi } from "vitest";
import { selectBestPhotos } from "../src/run-pipeline.js";

// Calibration-shaped scores (Nicki): faceH is the signal, quality ∝ faceH.
const FACEH = { "p1": 0.096, "p2": 0.102, "p3": 0.362, "p4": 0.468 };
// readFile returns the path itself (fake buffer); scorer maps it → quality.
const deps = (faceH = FACEH) => ({
  readFile: async (p) => p,
  photoFaceQuality: async (p) => ({ quality: (faceH[p] ?? 0) * 0.92, faceH: faceH[p] ?? 0 }),
  log: { log: () => {}, warn: () => {} },
});

describe("selectBestPhotos", () => {
  it("human secondary: keeps ONLY clear-face photos, ranked best-first (Nicki case)", async () => {
    const input = { child: { subject_type: "non_human", photo_paths: ["pet1", "pet2"] },
      secondaries: [{ name: "Nicki", subject_type: "human", photo_paths: ["p1", "p2", "p3", "p4"] }] };
    await selectBestPhotos(input, deps());
    // p1 (cap) + p2 (half-body) drop below the 20% floor; p4 > p3 by size.
    expect(input.secondaries[0].photo_paths).toEqual(["p4", "p3"]);
  });

  it("PET GUARD: a non_human subject is SKIPPED — photos unchanged, scorer NEVER called", async () => {
    const spy = vi.fn(async () => ({ quality: 1, faceH: 1 }));
    const input = { child: { subject_type: "non_human", photo_paths: ["pet1", "pet2", "pet3"] }, secondaries: [] };
    await selectBestPhotos(input, { readFile: async (p) => p, photoFaceQuality: spy, log: { log() {}, warn() {} } });
    expect(input.child.photo_paths).toEqual(["pet1", "pet2", "pet3"]); // byte-identical
    expect(spy).not.toHaveBeenCalled(); // guard short-circuits before any detection
  });

  it("NEVER-ZERO: no photo clears the floor → keep ALL, unchanged", async () => {
    const input = { child: { subject_type: "non_human", photo_paths: [] },
      secondaries: [{ name: "Blur", subject_type: "human", photo_paths: ["p1", "p2"] }] }; // both ~10%, below floor
    await selectBestPhotos(input, deps());
    expect(input.secondaries[0].photo_paths).toEqual(["p1", "p2"]); // never emptied
  });

  it("caps at 3 even when more photos clear the floor", async () => {
    const faceH = { a: 0.5, b: 0.45, c: 0.4, d: 0.35 };
    const input = { child: { subject_type: "non_human", photo_paths: [] },
      secondaries: [{ name: "Many", subject_type: "human", photo_paths: ["d", "a", "c", "b"] }] };
    await selectBestPhotos(input, deps(faceH));
    expect(input.secondaries[0].photo_paths).toEqual(["a", "b", "c"]); // top-3 by size, d dropped
  });

  it("BYTE-IDENTICAL: single-photo human is untouched", async () => {
    const input = { child: { subject_type: "non_human", photo_paths: [] },
      secondaries: [{ name: "Solo", subject_type: "human", photo_paths: ["p3"] }] };
    await selectBestPhotos(input, deps());
    expect(input.secondaries[0].photo_paths).toEqual(["p3"]);
  });

  it("BYTE-IDENTICAL: subject with no photo_paths is untouched (no crash)", async () => {
    const input = { child: { subject_type: "non_human" }, secondaries: [{ name: "Text", subject_type: "human" }] };
    await selectBestPhotos(input, deps());
    expect(input.secondaries[0].photo_paths).toBeUndefined();
  });

  it("human PROTAGONIST (subject_type not non_human) is ALSO ranked", async () => {
    const input = { child: { subject_type: undefined, name: "Kid", photo_paths: ["p1", "p3", "p4"] }, secondaries: [] };
    await selectBestPhotos(input, deps());
    expect(input.child.photo_paths).toEqual(["p4", "p3"]); // p1 dropped, ranked
  });

  it("BYTE-IDENTICAL: single-protagonist book with no secondaries + no photos", async () => {
    const input = { child: { subject_type: undefined, name: "Kid" }, secondaries: [] };
    await selectBestPhotos(input, deps());
    expect(input.child.photo_paths).toBeUndefined();
  });
});
