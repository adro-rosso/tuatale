// Cover system (2026-10-27): voices × placements are pure, deterministic and viewer-proof.
import { describe, it, expect } from "vitest";
import {
  COVER_VOICES, COVER_PLACEMENTS, COVER_PALETTES, COVER_ENERGIES, COVER_AGE_BANDS,
  hashSeed, coverEnergyFor, ageBandFor, selectCoverVoice, selectCoverPlacement,
  balanceTwoLines, stackLines, buildCoverPageHtml, lintCoverHtml, HERO_COMPOSITIONS,
} from "../../src/cover-voices.js";

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

describe("page HTML", () => {
  it("builds every voice × placement with no gradients, masks, blur, shadows or transparency", () => {
    for (const v of Object.keys(COVER_VOICES)) for (const p of Object.keys(COVER_PLACEMENTS)) {
      const html = buildCoverPageHtml({ voiceKey: v, placementId: p, heroUrl: "file:///hero.jpg", title: T, name: "Eddie", palette: COVER_PALETTES[v.split("-")[0]][0], torn: true });
      expect(lintCoverHtml(html), `${v} × ${p}`).toEqual([]);
      expect(html).toContain("for Eddie");
      expect(html).toContain("A Tuatale Book");
      expect(html).toContain("__coverFitDone");
      expect(html).toContain("fonts.googleapis.com/css2?family=");
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
