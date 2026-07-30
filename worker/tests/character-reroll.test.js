// worker/tests/character-reroll.test.js — OPERATOR sheet-re-roll assembly (2026-07-30).
// Pure logic + fs, $0 (no Gemini). Proves the four load-bearing seams:
//   - subjects_present (NAMES) → affected pages, resolved name→subjectId as the pipeline does
//   - a picked option LOCKS as the sheet → resolveSheetState returns LOCKED (fingerprint EXEMPT)
//     and reports views 2-3 as the re-chain plan (the CONTRACT; the meta shape is internal)
//   - generateOptions clears prior candidates + writes exactly N
//   - snapshot → mutate → revert restores the sheet AND the affected pages (reversible)
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  listRerollSubjects, affectedPagesFor, buildMintRequest, resolveArtStyleKey,
  generateOptions, lockPickedOption, snapshotCharacter, revertCharacter, viewCountOnDisk,
} from "../../tools/review-station/character-reroll.js";
import { resolveSheetState, SheetState } from "../../src/sheet-meta.js";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "char-reroll-"));
const pad2 = (n) => String(n).padStart(2, "0");
const silent = { log: () => {}, warn: () => {} };

// A minimal 2-companion book (mirrors the shape of a real story.json/meta.json).
const STORY = {
  title: "T", style: "loose watercolour illustration",
  character: "Jazzy, a nine-year-old girl",
  companion_characters: [{ name: "Byron" }, { name: "Pheonix" }],
  scenes: [
    { page: 1, subjects_present: ["Jazzy"] },
    { page: 2, subjects_present: ["Jazzy", "Byron", "Pheonix"] },
    { page: 3, subjects_present: ["Jazzy", "Pheonix"] },
    { page: 4, subjects_present: ["Jazzy", "Byron"] },
  ],
};
const META = {
  inputs: {
    child: { name: "Jazzy", age: 9, gender: "girl", subject_type: "human", appearance: "long dark hair", photo_paths: ["p/j1.png", "p/j2.png"] },
    secondaries: [
      { id: "companion-1", name: "Byron", age: 13, gender: "boy", subject_type: "human", appearance_markers: "tousled brown hair", photo_paths: ["p/b1.png"] },
      { id: "companion-2", name: "Pheonix", subject_type: "human", appearance_markers: "tall", photo_paths: [] },
    ],
  },
};

describe("affected-page detection (subjects_present names)", () => {
  it("maps each character to the pages it appears on", () => {
    expect(affectedPagesFor("Jazzy", STORY)).toEqual([1, 2, 3, 4]); // protagonist in every scene
    expect(affectedPagesFor("Byron", STORY)).toEqual([2, 4]);
    expect(affectedPagesFor("Pheonix", STORY)).toEqual([2, 3]);
    expect(affectedPagesFor("Nobody", STORY)).toEqual([]);
  });

  it("listRerollSubjects resolves name→subjectId + prefix like the pipeline", () => {
    const subs = listRerollSubjects(STORY, META);
    expect(subs.map((s) => [s.subjectId, s.name, s.prefix, s.role])).toEqual([
      ["protagonist", "Jazzy", "sheet", "protagonist"],
      ["companion-1", "Byron", "companion-1", "secondary"],
      ["companion-2", "Pheonix", "companion-2", "secondary"],
    ]);
    expect(subs[0].affectedPages).toEqual([1, 2, 3, 4]);
    expect(subs[1].affectedPages).toEqual([2, 4]);
    expect(subs[0].photoStoragePaths).toEqual(["p/j1.png", "p/j2.png"]);
    expect(subs[2].photoStoragePaths).toEqual([]); // Pheonix has no photos → UI blocks the re-roll
  });
});

describe("buildMintRequest — maps meta inputs to the picker mint", () => {
  it("secondary: appearance from appearance_markers, secondary role, style resolved", () => {
    const req = buildMintRequest(listRerollSubjects(STORY, META)[1], STORY, META);
    expect(req.role).toBe("secondary");
    expect(req.inputs).toMatchObject({ id: "companion-1", name: "Byron", appearance: "tousled brown hair", subject_type: "human" });
    expect(req.artStyle).toBe("watercolour"); // reverse-mapped from story.style
  });
  it("protagonist: child inputs, protagonist role", () => {
    const req = buildMintRequest(listRerollSubjects(STORY, META)[0], STORY, META);
    expect(req.role).toBe("protagonist");
    expect(req.inputs).toMatchObject({ name: "Jazzy", appearance: "long dark hair" });
  });
  it("resolveArtStyleKey prefers an explicit recorded key, else default", () => {
    expect(resolveArtStyleKey(STORY, { inputs: { art_style: "ink_wash" } })).toBe("ink_wash");
    expect(resolveArtStyleKey({ style: "no-such-style" }, {})).toBe("watercolour");
  });
});

describe("generateOptions", () => {
  it("clears prior candidates and writes exactly N", async () => {
    const dir = tmp();
    const outDir = path.join(dir, "_candidates", "protagonist");
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, "opt-9.png"), Buffer.from("STALE")); // must be cleared
    let calls = 0;
    const mint = async () => { calls++; return Buffer.from(`PNG${calls}`); };
    const opts = await generateOptions({ role: "protagonist", inputs: { name: "Jazzy" }, artStyle: "watercolour" }, ["/tmp/x.png"], { n: 3, outDir, mint, log: silent });
    expect(calls).toBe(3);
    expect(opts.map((o) => o.optId)).toEqual(["opt-1", "opt-2", "opt-3"]);
    expect(fs.readdirSync(outDir).sort()).toEqual(["opt-1.png", "opt-2.png", "opt-3.png"]); // opt-9 gone
  });
});

describe("lockPickedOption → the LOCK contract", () => {
  it("DECISIVE: a picked option resolves LOCKED (fingerprint EXEMPT) with views 2-3 as the re-chain plan", () => {
    const dir = tmp();
    const sheetsDir = path.join(dir, "character-sheets");
    fs.mkdirSync(sheetsDir, { recursive: true });
    // Pre-existing 3-view protagonist sheet.
    [1, 2, 3].forEach((v) => fs.writeFileSync(path.join(sheetsDir, `sheet-${pad2(v)}.png`), Buffer.from(`OLD${v}`)));
    const src = path.join(dir, "chosen.png");
    fs.writeFileSync(src, Buffer.from("NEWFACE"));

    const r = lockPickedOption({ sheetsDir, subjectId: "protagonist", prefix: "sheet", viewCount: 3, srcFile: src });
    expect(r.deleted).toEqual(["sheet-02.png", "sheet-03.png"]); // stale views removed → re-chained
    expect(fs.readFileSync(path.join(sheetsDir, "sheet-01.png")).toString()).toBe("NEWFACE"); // view-0 replaced
    expect(fs.existsSync(path.join(sheetsDir, "sheet-02.png"))).toBe(false);

    // The real guarantee: even a MISMATCHING fingerprint resolves LOCKED (the pick is authoritative).
    const st = resolveSheetState({ subjectId: "protagonist", sheetPathPrefix: "sheet", expectedViewCount: 3, currentFingerprint: "DIFFERENT", sheetsDir });
    expect(st.state).toBe(SheetState.LOCKED);
    expect(st.missingViewIndices).toEqual([2, 3]);
  });

  it("companion: locks companion-1 with a 2-view chain plan", () => {
    const dir = tmp();
    const sheetsDir = path.join(dir, "character-sheets");
    fs.mkdirSync(sheetsDir, { recursive: true });
    [1, 2].forEach((v) => fs.writeFileSync(path.join(sheetsDir, `companion-1-${pad2(v)}.png`), Buffer.from(`OLD${v}`)));
    fs.writeFileSync(path.join(dir, "c.png"), Buffer.from("NEW"));
    lockPickedOption({ sheetsDir, subjectId: "companion-1", prefix: "companion-1", viewCount: 2, srcFile: path.join(dir, "c.png") });
    const st = resolveSheetState({ subjectId: "companion-1", sheetPathPrefix: "companion-1", expectedViewCount: 2, currentFingerprint: "X", sheetsDir });
    expect(st.state).toBe(SheetState.LOCKED);
    expect(st.missingViewIndices).toEqual([2]);
    expect(fs.existsSync(path.join(sheetsDir, "companion-1-meta.json"))).toBe(true);
  });
});

describe("snapshot → mutate → revert (reversible)", () => {
  it("restores the sheet files AND the affected page PDFs exactly", () => {
    const dir = tmp();
    const sheetsDir = path.join(dir, "character-sheets");
    const pagesDir = path.join(dir, "pages");
    fs.mkdirSync(sheetsDir, { recursive: true });
    fs.mkdirSync(pagesDir, { recursive: true });
    [1, 2, 3].forEach((v) => fs.writeFileSync(path.join(sheetsDir, `sheet-${pad2(v)}.png`), Buffer.from(`ORIG-SHEET-${v}`)));
    fs.writeFileSync(path.join(sheetsDir, "protagonist-meta.json"), JSON.stringify({ marker_fingerprint: "ORIG" }));
    [1, 2].forEach((p) => fs.writeFileSync(path.join(pagesDir, `page-${pad2(p)}.pdf`), Buffer.from(`ORIG-PAGE-${p}`)));

    const snap = snapshotCharacter({ bookDir: dir, subjectId: "protagonist", prefix: "sheet", affectedPages: [1, 2], id: "snap1" });
    expect(snap.pages).toEqual([1, 2]);

    // Mutate: lock a new face (deletes 2-3), overwrite the pages (as a re-render would).
    lockPickedOption({ sheetsDir, subjectId: "protagonist", prefix: "sheet", viewCount: 3, srcFile: (() => { const f = path.join(dir, "n.png"); fs.writeFileSync(f, Buffer.from("REROLLED")); return f; })() });
    [1, 2].forEach((p) => fs.writeFileSync(path.join(pagesDir, `page-${pad2(p)}.pdf`), Buffer.from(`REROLLED-PAGE-${p}`)));
    expect(fs.readFileSync(path.join(sheetsDir, "sheet-01.png")).toString()).toBe("REROLLED");
    expect(fs.existsSync(path.join(sheetsDir, "sheet-02.png"))).toBe(false); // deleted by the lock

    const rev = revertCharacter({ bookDir: dir, subjectId: "protagonist" });
    expect(rev.pages).toEqual([1, 2]);
    // Sheet restored to the ORIGINAL 3 views + original meta; pages restored.
    expect(fs.readFileSync(path.join(sheetsDir, "sheet-01.png")).toString()).toBe("ORIG-SHEET-1");
    expect(fs.readFileSync(path.join(sheetsDir, "sheet-02.png")).toString()).toBe("ORIG-SHEET-2");
    expect(fs.readFileSync(path.join(sheetsDir, "sheet-03.png")).toString()).toBe("ORIG-SHEET-3");
    expect(JSON.parse(fs.readFileSync(path.join(sheetsDir, "protagonist-meta.json"), "utf8")).marker_fingerprint).toBe("ORIG");
    expect(fs.readFileSync(path.join(pagesDir, "page-01.pdf")).toString()).toBe("ORIG-PAGE-1");
  });

  it("viewCountOnDisk counts a prefix's view PNGs (not another subject's, not meta)", () => {
    const dir = tmp();
    const sheetsDir = path.join(dir, "character-sheets");
    fs.mkdirSync(sheetsDir, { recursive: true });
    fs.writeFileSync(path.join(sheetsDir, "companion-1-01.png"), Buffer.from("a"));
    fs.writeFileSync(path.join(sheetsDir, "companion-1-02.png"), Buffer.from("b"));
    fs.writeFileSync(path.join(sheetsDir, "companion-11-01.png"), Buffer.from("c")); // different subject
    fs.writeFileSync(path.join(sheetsDir, "companion-1-meta.json"), "{}");
    expect(viewCountOnDisk(sheetsDir, "companion-1", 2)).toBe(2);
  });
});
