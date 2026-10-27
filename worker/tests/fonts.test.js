// Self-hosted fonts (2026-10-27). Every Chromium → PDF render — interior story pages, the $0
// title / dedication / colophon, the cover voices — must embed STATIC TrueType only: the
// Google-served variable fonts came out as Type 3 glyph streams, which print prepress rejects.
// These pin (1) every family in the shared map has real static TTFs on disk, (2) every live
// template and the treatment CSS name only mapped families, at mapped weights, with no Google
// Fonts <link>, and (3) the injection helper does what the renderers rely on.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FONT_FILES, FONTS_DIR, FONTS_DIR_URL, fontFaceRules, familiesReferenced, localizeFonts } from "../../src/fonts.js";
import { loadTemplateRegistry } from "../../src/template-registry.js";
import { TREATMENT_CSS } from "../../src/page-pipeline.js";
import { FRONT_MATTER_TEMPLATE_DIRS } from "../../src/front-matter.js";
import { COVER_FONT_FILES, COVER_FONTS_DIR_URL } from "../../src/cover-voices.js";

const TEMPLATES_DIR = fileURLToPath(new URL("../../templates/", import.meta.url));
const GOOGLE_RE = /fonts\.g(?:oogleapis|static)\.com/;

/** Table tags of an sfnt (TrueType/OpenType) file: offset table, then 16-byte table records. */
function sfntTags(buf) {
  const n = buf.readUInt16BE(4);
  const tags = [];
  for (let i = 0; i < n; i++) tags.push(buf.toString("latin1", 12 + i * 16, 16 + i * 16));
  return tags;
}
function has(fam, weight, style) { return (FONT_FILES[fam] ?? []).some(([, w, s]) => w === weight && s === style); }
function weightsUsed(css) { return new Set([...css.matchAll(/font-weight:\s*(\d{3})\b/g)].map((m) => Number(m[1]))); }
/** First (non-generic) family of every font-family declaration in the CSS. */
function declaredFamilies(css) { return [...new Set([...css.matchAll(/font-family:\s*["']([^"']+)["']/g)].map((m) => m[1]))]; }

function readTemplate(dir) {
  const config = JSON.parse(fs.readFileSync(path.join(TEMPLATES_DIR, dir, "config.json"), "utf8"));
  const html = fs.readFileSync(path.join(TEMPLATES_DIR, dir, config.rendering.templateHtmlPath), "utf8");
  return { dir, config, html };
}
const registry = await loadTemplateRegistry();
const interior = registry.map((t) => readTemplate(path.basename(path.dirname(t.configPath))));
const frontMatter = Object.values(FRONT_MATTER_TEMPLATE_DIRS).map(readTemplate);
const live = [...interior, ...frontMatter];

describe("FONT_FILES (assets/fonts/)", () => {
  it("every file exists and is a STATIC TrueType font (glyf outlines, no fvar/gvar)", () => {
    for (const [fam, files] of Object.entries(FONT_FILES)) {
      expect(files.length, fam).toBeGreaterThan(0);
      for (const [file, weight, style] of files) {
        const p = path.join(FONTS_DIR, file);
        expect(fs.existsSync(p), `${fam}: ${file} missing`).toBe(true);
        const buf = fs.readFileSync(p);
        expect(buf.readUInt32BE(0), `${file}: not a TrueType sfnt`).toBe(0x00010000);
        const tags = sfntTags(buf);
        expect(tags, `${file}: no TrueType outlines`).toContain("glyf");
        expect(tags, `${file}: variable font (fvar) — Chromium would embed it as Type 3`).not.toContain("fvar");
        expect(tags, `${file}: variable font (gvar)`).not.toContain("gvar");
        expect([100, 200, 300, 400, 500, 600, 700, 800, 900], `${file}: weight`).toContain(weight);
        expect(["normal", "italic"], `${file}: style`).toContain(style);
      }
    }
  });
  it("ships the OFL licence texts next to the fonts", () => {
    const ofl = fs.readdirSync(FONTS_DIR).filter((f) => /^OFL-.+\.txt$/.test(f));
    expect(ofl).toEqual(expect.arrayContaining(["OFL-EBGaramond.txt", "OFL-ArchitectsDaughter.txt", "OFL-Fraunces.txt"]));
  });
  it("the cover module reuses the shared map (one source of truth)", () => {
    expect(COVER_FONT_FILES).toBe(FONT_FILES);
    expect(COVER_FONTS_DIR_URL).toBe(FONTS_DIR_URL);
    expect(FONTS_DIR_URL).toMatch(/^file:\/\/\/.*\/assets\/fonts\/$/);
  });
});

describe("live templates (registry interior pages + title/dedication/colophon)", () => {
  it("there are live templates to check", () => {
    expect(interior.length).toBeGreaterThan(0);
    expect(frontMatter.length).toBe(3);
  });
  it("load no fonts from Google", () => {
    for (const t of live) expect(t.html, t.dir).not.toMatch(GOOGLE_RE);
  });
  it("name only self-hosted families, and the configured body face is one of them", () => {
    for (const t of live) {
      const fams = declaredFamilies(t.html);
      expect(fams.length, `${t.dir}: no font-family declaration`).toBeGreaterThan(0);
      for (const fam of fams) expect(FONT_FILES[fam], `${t.dir} uses "${fam}"`).toBeDefined();
      expect(familiesReferenced(t.html), t.dir).toEqual(expect.arrayContaining(fams));
      if (t.config.typography?.fontFamily) expect(FONT_FILES[t.config.typography.fontFamily], `${t.dir} typography.fontFamily`).toBeDefined();
    }
  });
  it("every weight / italic a template uses has a static file for its family", () => {
    for (const t of live) {
      const fams = declaredFamilies(t.html);
      expect(fams.length, `${t.dir}: weights are checked per single family`).toBe(1);
      const fam = fams[0];
      for (const w of new Set([400, ...weightsUsed(t.html)])) expect(has(fam, w, "normal"), `${t.dir}: ${fam} ${w}`).toBe(true);
      if (/font-style:\s*italic/.test(t.html)) expect(has(fam, 400, "italic"), `${t.dir}: ${fam} italic`).toBe(true);
    }
  });
});

describe("typography treatments (TREATMENT_CSS, injected into every interior page)", () => {
  it("name only self-hosted families at shipped weights", () => {
    const fams = familiesReferenced(TREATMENT_CSS);
    expect(fams.sort()).toEqual(["Architects Daughter", "EB Garamond"]);
    expect(TREATMENT_CSS).not.toMatch(GOOGLE_RE);
    for (const w of weightsUsed(TREATMENT_CSS)) expect(has("EB Garamond", w, "normal"), `EB Garamond ${w}`).toBe(true); // tz-em / drop cap 500
    expect(has("EB Garamond", 400, "italic")).toBe(true);     // tz-line
    expect(has("Architects Daughter", 400, "normal")).toBe(true); // tz-sfx
  });
});

describe("localizeFonts()", () => {
  const page = `<!doctype html><html><head><meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=EB+Garamond:ital,wght@0,400;0,500;1,400&display=swap" rel="stylesheet">
<style>.p{font-family:"EB Garamond",Garamond,serif}</style></head><body><p class="p">x</p></body></html>`;
  it("strips the Google <link>s and injects local @font-face rules for the families the page names", () => {
    const out = localizeFonts(page);
    expect(out).not.toMatch(GOOGLE_RE);
    expect(out).not.toContain("<link");
    expect(out).toContain(`@font-face{font-family:'EB Garamond';font-weight:400;font-style:normal;font-display:block;src:url('${FONTS_DIR_URL}EBGaramond-Regular.ttf') format('truetype');}`);
    expect(out).toContain("font-weight:500;font-style:normal");
    expect(out).toContain("font-weight:400;font-style:italic");
    expect(out).not.toContain("Fraunces"); // only what the page names
    expect(out.indexOf("@font-face")).toBeLessThan(out.indexOf("</head>"));
    expect(out).toContain('<p class="p">x</p>'); // body untouched
  });
  it("extraFamilies are added; a family that is not self-hosted throws instead of falling back", () => {
    expect(localizeFonts("<html><head></head></html>", { extraFamilies: ["Architects Daughter"] })).toContain("ArchitectsDaughter-Regular.ttf");
    expect(localizeFonts("<html><head></head><body>plain</body></html>")).toBe("<html><head></head><body>plain</body></html>");
    expect(() => fontFaceRules(["Comic Sans MS"])).toThrow(/Comic Sans MS/);
  });
});
