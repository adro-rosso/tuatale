// scripts/eval-harness.mjs
// Item 3 / Stage D — $0 template eval harness.
//
// Renders the FULL set of page templates (every registry template) + the cover
// using EXISTING rendered-book images (reused as image overrides) and that
// book's REAL narrative text — through the SAME layout path the real pipeline
// uses (renderPageWithTemplate's imagePathOverride seam + renderCover). NO
// Gemini, NO Anthropic: zero API cost. The point is to preview typography /
// layout / composition (stages A + C) instantly and eyeball them against a real
// picture book.
//
// Output: a flat review dir of laid-out pages (PNG + PDF), one per template,
// plus the cover, plus a manifest. Re-run after ANY template.html / config.json
// edit to see the change — still $0 (it reads templates fresh each run and never
// touches an image model).
//
// Usage:
//   node scripts/eval-harness.mjs [--book <dir>] [--label <name>]
//   default book  = output/books/2026-06-16-leo-fatherson  (the Leo father-son book)
//   default label = baseline  → output/_eval-harness/baseline/

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadTemplateRegistry } from "../src/template-registry.js";
import { renderPageWithTemplate } from "../src/page-pipeline.js";
import { renderCover } from "./render-cover.mjs";
import { renderFrontMatterPage, buildTitleSubs, buildDedicationSubs, buildColophonSubs } from "../src/front-matter.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");

// ---- args ----
const argv = process.argv.slice(2);
const getArg = (flag, def) => {
  const i = argv.indexOf(flag);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : def;
};
const BOOK = path.resolve(ROOT, getArg("--book", "output/books/2026-06-16-leo-fatherson"));
const LABEL = getArg("--label", "baseline");
const REVIEW_DIR = path.join(ROOT, "output", "_eval-harness", LABEL);
const RAW_DIR = path.join(REVIEW_DIR, "_raw");
const COVER_CONFIG = path.join(ROOT, "templates", "cover-iter-1", "config.json");

const rel = (p) => path.relative(ROOT, p).replace(/\\/g, "/");
const imageForPage = (page) => path.join(BOOK, "pages", `page-${String(page).padStart(2, "0")}.png`);

// Order candidate scenes for a template by how snugly their narrative fits its
// char ceiling (closest-under-limit first) — so a borrowed scene reads naturally
// in that template instead of overflowing auto-fit.
function rankScenes(scenes, maxChars) {
  const fits = (n) => maxChars == null || n <= maxChars;
  return [...scenes]
    .filter((s) => fs.existsSync(imageForPage(s.page)) && (s.narrative_text || "").length > 0)
    .sort((a, b) => {
      const la = (a.narrative_text || "").length, lb = (b.narrative_text || "").length;
      const fa = fits(la), fb = fits(lb);
      if (fa !== fb) return fa ? -1 : 1;          // fitting scenes first
      return (maxChars ?? 1e9) - la - ((maxChars ?? 1e9) - lb); // then closest-under-limit
    });
}

async function main() {
  if (!fs.existsSync(BOOK)) throw new Error(`book dir not found: ${BOOK}`);
  const story = JSON.parse(fs.readFileSync(path.join(BOOK, "story.json"), "utf8"));
  const scenes = story.scenes || [];
  const registry = await loadTemplateRegistry(); // page templates only (cover is kind:"cover")

  fs.rmSync(REVIEW_DIR, { recursive: true, force: true });
  fs.mkdirSync(RAW_DIR, { recursive: true });

  console.log(`\n${"=".repeat(72)}`);
  console.log(`Template eval harness ($0) — book: ${rel(BOOK)}  → ${rel(REVIEW_DIR)}`);
  console.log(`${"=".repeat(72)}\n`);

  const manifest = { book: rel(BOOK), label: LABEL, title: story.title, pages: [] };

  // ---- 0. Cover (renderCover; hero = page-01 image as a $0 stand-in) ----
  {
    const name = (story.cover_subjects && story.cover_subjects[0]) || "the reader";
    const hero = imageForPage(1);
    let entry = { slot: "00", kind: "cover", template: "cover-iter-1", title: story.title, heroImage: rel(hero) };
    try {
      const r = await renderCover({
        title: story.title,
        subtitle: `A story for ${name}`,
        imagePath: hero,
        outputDir: RAW_DIR,
        configPath: COVER_CONFIG,
        outName: "cover",
      });
      fs.copyFileSync(r.pngPath, path.join(REVIEW_DIR, "00-cover.png"));
      fs.copyFileSync(r.pdfPath, path.join(REVIEW_DIR, "00-cover.pdf"));
      entry = { ...entry, success: true, fontSize: r.fontSize, fits: r.fits, out: "00-cover.png" };
      console.log(`  00  cover-iter-1        ✓  title "${story.title}" @ ${r.fontSize}pt (fits=${r.fits})`);
    } catch (e) {
      entry = { ...entry, success: false, error: e.message };
      console.log(`  00  cover-iter-1        ✗  ${e.message}`);
    }
    manifest.pages.push(entry);
  }

  // ---- Front matter (title / dedication / colophon) — $0 text pages (B.1) ----
  // Sequence in the delivered book: cover(00) → title(00b) → [story ×12] →
  // dedication(97) → colophon(98). Here we render each artifact for review.
  const fmName = (story.cover_subjects && story.cover_subjects[0]) || "the reader";
  let generatedAtIso = "";
  try { generatedAtIso = JSON.parse(fs.readFileSync(path.join(BOOK, "meta.json"), "utf8")).generatedAt || ""; } catch {}
  // Custom-dedication example (the optional field, when a parent writes one).
  const customDedication = `For ${fmName}, on your sixth birthday, with all our love from Mum and Dad.`;
  const frontMatter = [
    { kind: "title", out: "00b-title", subs: buildTitleSubs({ title: story.title, childName: fmName }) },
    { kind: "dedication", out: "97-dedication-default", subs: buildDedicationSubs({ childName: fmName }) },
    { kind: "dedication", out: "97b-dedication-custom", subs: buildDedicationSubs({ childName: fmName, message: customDedication }) },
    { kind: "colophon", out: "98-colophon", subs: buildColophonSubs({ childName: fmName, generatedAtIso }) },
  ];
  for (const fm of frontMatter) {
    let entry = { slot: fm.out, kind: "front-matter", template: `${fm.kind}-iter-1` };
    try {
      const r = await renderFrontMatterPage({ kind: fm.kind, subs: fm.subs, outputDir: path.join(RAW_DIR, fm.out), outName: fm.kind });
      fs.copyFileSync(r.pngPath, path.join(REVIEW_DIR, `${fm.out}.png`));
      fs.copyFileSync(r.pdfPath, path.join(REVIEW_DIR, `${fm.out}.pdf`));
      entry = { ...entry, success: true, out: `${fm.out}.png` };
      console.log(`  ${fm.out.padEnd(13)} ${(fm.kind + "-iter-1").padEnd(18)} ✓`);
    } catch (e) {
      entry = { ...entry, success: false, error: e.message };
      console.log(`  ${fm.out.padEnd(13)} ${(fm.kind + "-iter-1").padEnd(18)} ✗  ${e.message}`);
    }
    manifest.pages.push(entry);
  }

  // ---- 1..N. Each page template ----
  let slot = 1;
  for (const tmpl of registry) {
    const maxChars = tmpl.selection_metadata?.max_narrative_chars ?? null;
    // Prefer a scene that NATIVELY chose this template in the real book; else
    // borrow the best-fitting scene. Either way, try scenes in fit-order until
    // one renders (a borrowed image may fail region detection).
    const native = scenes.filter((s) => s.layout_intent?.template_id === tmpl.id);
    const ranked = rankScenes(scenes, maxChars);
    const ordered = [...rankScenes(native, maxChars), ...ranked.filter((s) => !native.includes(s))];
    const slotStr = String(slot).padStart(2, "0");

    let done = null;
    for (const sc of ordered) {
      const tmpOut = path.join(RAW_DIR, tmpl.id);
      fs.mkdirSync(tmpOut, { recursive: true });
      const res = await renderPageWithTemplate({
        templateConfigPath: tmpl.configPath,
        scene: { page: sc.page, action: sc.action },
        narrativeText: sc.narrative_text,
        outputDir: tmpOut,
        imagePathOverride: imageForPage(sc.page),
      });
      if (res.success) {
        fs.copyFileSync(res.renderedPngPath, path.join(REVIEW_DIR, `${slotStr}-${tmpl.id}.png`));
        fs.copyFileSync(res.pdfPath, path.join(REVIEW_DIR, `${slotStr}-${tmpl.id}.pdf`));
        done = {
          slot: slotStr, kind: "page", template: tmpl.id,
          sourceScenePage: sc.page, sourceImage: rel(imageForPage(sc.page)),
          narrativeChars: (sc.narrative_text || "").length, maxNarrativeChars: maxChars,
          borrowed: !native.includes(sc), fontSize: res.diagnostics?.fontSize ?? null,
          success: true, out: `${slotStr}-${tmpl.id}.png`,
        };
        break;
      }
      done = { slot: slotStr, kind: "page", template: tmpl.id, success: false, error: res.error, triedScenePage: sc.page };
    }
    if (done?.success) {
      const tag = done.borrowed ? "borrowed" : "native ";
      console.log(`  ${slotStr}  ${tmpl.id.padEnd(16)}  ✓  ${tag} p${done.sourceScenePage} (${done.narrativeChars} chars${maxChars ? `/${maxChars}` : ""}) @ ${done.fontSize}pt`);
    } else {
      console.log(`  ${slotStr}  ${tmpl.id.padEnd(16)}  ✗  ${done?.error ?? "no renderable scene"}`);
    }
    manifest.pages.push(done);
    slot++;
  }

  fs.writeFileSync(path.join(REVIEW_DIR, "manifest.json"), JSON.stringify(manifest, null, 2));
  const ok = manifest.pages.filter((p) => p?.success).length;
  console.log(`\n${ok}/${manifest.pages.length} slots rendered (0 API calls). Review: ${rel(REVIEW_DIR)}`);
  console.log(`Open the PNGs (00-cover … ${String(registry.length).padStart(2, "0")}-*) side by side; manifest.json maps each slot.\n`);
}

main().catch((e) => { console.error("eval-harness failed:", e.message); process.exit(1); });
