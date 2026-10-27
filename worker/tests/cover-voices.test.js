// Cover system (2026-10-27): voices × placements are pure, deterministic and viewer-proof.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import {
  COVER_FONT_FILES, COVER_FONTS_DIR_URL, voiceFontFamilies,
  COVER_VOICES, COVER_PLACEMENTS, COVER_PALETTES, COVER_ENERGIES, COVER_AGE_BANDS,
  hashSeed, coverEnergyFor, ageBandFor, selectCoverVoice, selectCoverPlacement,
  balanceTwoLines, stackLines, breakLongWords, coverSeedFor, buildCoverPageHtml, lintCoverHtml, HERO_COMPOSITIONS,
} from "../../src/cover-voices.js";
import { assertCoverFontsOnDisk } from "../../src/front-matter.js";

const T = "Eddie and the Shining Door";

describe("selection", () => {
  it("every energy × band has a voice, and every voice names its real cover + TTF fonts", () => {
    for (const e of COVER_ENERGIES) for (const b of COVER_AGE_BANDS) {
      const key = selectCoverVoice({ energy: e, ageRange: b });
      expect(COVER_VOICES[key], key).toBeDefined();
      expect(COVER_VOICES[key].ref).toMatch(/\d{4}/);
      expect(COVER_VOICES[key].fonts.length).toBeGreaterThan(0);
    }
  });
  it("energy: story tag wins, then vibe, then wonder", () => {
    expect(coverEnergyFor({ coverEnergy: "playful", vibe: "memorial" })).toBe("playful");
    expect(coverEnergyFor({ vibe: "memorial" })).toBe("gentle");
    expect(coverEnergyFor({ vibe: "happy" })).toBe("playful");
    expect(coverEnergyFor({})).toBe("wonder");
    expect(ageBandFor("7-9")).toBe("7-9"); expect(ageBandFor(undefined)).toBe("5-7");
  });
  it("placement is deterministic per seed and spreads across placements", () => {
    const a = selectCoverPlacement({ seed: "x|Eddie", energy: "wonder" });
    expect(selectCoverPlacement({ seed: "x|Eddie", energy: "wonder" })).toEqual(a);
    const seen = new Set(Array.from({ length: 200 }, (_, i) => selectCoverPlacement({ seed: `book-${i}`, energy: "gentle" }).placement));
    expect(seen.size).toBe(Object.keys(COVER_PLACEMENTS).length);
    expect(hashSeed("a")).not.toBe(hashSeed("b"));
    expect(COVER_PALETTES.playful.map((p) => p.name)).toContain("sun");
  });
});

describe("line breaking", () => {
  it("balances wide titles into two lines and leaves short ones alone", () => {
    expect(balanceTwoLines(T)).toEqual(["Eddie and the", "Shining Door"]);
    expect(balanceTwoLines("Zog")).toEqual(["Zog"]);
    expect(balanceTwoLines("Oi Frog Again")).toEqual(["Oi Frog Again"]);
  });
  it("stacks narrow titles word-wise, joining short words, never more than 5 lines", () => {
    expect(stackLines(T)).toEqual(["Eddie and", "the", "Shining", "Door"]);
    expect(stackLines("Maximilian-Alexander and the Very Long Wonderful Secret Garden Adventure").length).toBeLessThanOrEqual(5);
  });
});

describe("review hardening (2026-10-27)", () => {
  it("breakLongWords splits a hyphenated word that cannot fit a narrow zone, leaves others alone", () => {
    expect(breakLongWords(["Maximilian-Alexander", "and the", "Door"], 11)).toEqual(["Maximilian-", "Alexander", "and the", "Door"]);
    expect(breakLongWords(["Eddie and", "Door"], 11)).toEqual(["Eddie and", "Door"]);
    expect(stackLines("Maximilian-Alexander and the Door").length).toBeLessThanOrEqual(5);
  });
  it("stackLines merges the shortest pair when over 5 lines (no NaN precedence)", () => {
    const out = stackLines("a b c d e f g h i", 1);
    expect(out.length).toBe(5);
    expect(out.join(" ")).toBe("a b c d e f g h i");
  });
  it("coverSeedFor is the single seed and tolerates missing parts", () => {
    expect(coverSeedFor({ title: "T", childName: "N", theme: "th" })).toBe("T|N|th");
    expect(coverSeedFor({ title: "T", childName: "N" })).toBe("T|N|");
  });
  it("lint inspects CSS only: a title mentioning 'linear-gradient' or 'opacity' is not an offence", () => {
    const html = buildCoverPageHtml({ voiceKey: "wonder-7-9", placementId: "band", heroUrl: "file:///h.jpg", title: "The linear-gradient opacity:.5 rgba( book", name: "Bo", palette: COVER_PALETTES.wonder[0] });
    expect(lintCoverHtml(html)).toEqual([]);
    expect(lintCoverHtml('<div style="background:rgba(0,0,0,.4)"></div>')).toContain("transparency");
    expect(lintCoverHtml('<style>.x{color:#ffffff80}</style>')).toContain("transparency");
  });
  it("the fitter always signals completion and reports font errors", () => {
    const html = buildCoverPageHtml({ voiceKey: "gentle-3-5", placementId: "sky", heroUrl: "file:///h.jpg", title: T, name: "Eddie", palette: COVER_PALETTES.gentle[0] });
    expect(html).toMatch(/finally \{\s*window\.__coverFitDone = true;/);
    expect(html).toContain("dataset.fontErrors");
    expect(html).not.toContain('class="dots"');
    expect(html).not.toContain("radial-gradient");
  });
  it("assertCoverFontsOnDisk passes for every voice (fonts are shipped in the repo)", () => {
    for (const v of Object.keys(COVER_VOICES)) expect(() => assertCoverFontsOnDisk(v)).not.toThrow();
  });
});

describe("page HTML", () => {
  it("builds every voice × placement with no gradients, masks, blur, shadows or transparency", () => {
    for (const v of Object.keys(COVER_VOICES)) for (const p of Object.keys(COVER_PLACEMENTS)) {
      const html = buildCoverPageHtml({ voiceKey: v, placementId: p, heroUrl: "file:///hero.jpg", title: T, name: "Eddie", palette: COVER_PALETTES[v.split("-")[0]][0], torn: true });
      expect(lintCoverHtml(html), `${v} × ${p}`).toEqual([]);
      expect(html).toContain("for Eddie");
      expect(html).toContain("A Tuatale Book");
      expect(html).toContain("__coverFitDone");
      expect(html).toContain("@font-face{font-family:");
      expect(html).not.toContain("fonts.googleapis.com");
    }
  });
  it("every voice's font families are self-hosted static TTFs that exist on disk", () => {
    const dir = fileURLToPath(COVER_FONTS_DIR_URL);
    for (const v of Object.keys(COVER_VOICES)) for (const fam of voiceFontFamilies(v)) {
      expect(COVER_FONT_FILES[fam], `${v} uses ${fam}`).toBeDefined();
      for (const [file] of COVER_FONT_FILES[fam]) expect(fs.existsSync(dir + file), `${fam}: ${file}`).toBe(true);
    }
  });

  it("lint catches the constructs Edge drops", () => {
    expect(lintCoverHtml("<style>.x{background:linear-gradient(red,blue)}</style>")).toContain("gradient");
    expect(lintCoverHtml("<style>.x{mask-image:url(a)}</style>")).toContain("mask/blend/filter/shadow");
    expect(lintCoverHtml("<style>.x{background:rgba(0,0,0,.4)}</style>")).toContain("transparency");
  });
  it("escapes titles and names", () => {
    const html = buildCoverPageHtml({ voiceKey: "playful-3-5", placementId: "sky", heroUrl: "file:///h.jpg", title: "Bo & <Mo>", name: "Bo", palette: COVER_PALETTES.playful[0] });
    expect(html).toContain("Bo &amp; &lt;Mo&gt;");
  });
  it("every placement declares a hero composition + aspect ratio", () => {
    for (const [id, p] of Object.entries(COVER_PLACEMENTS)) {
      expect(HERO_COMPOSITIONS[p.hero], id).toMatch(/FRAMING/);
      expect(["4:3", "3:4", "16:9"]).toContain(p.aspectRatio);
    }
  });
});
