// scripts/render-cover-batch.mjs
// Part 4 (paid): render 3 front covers. For each protagonist: build the
// cover-hero Gemini prompt (cover composition template + the SAME character
// reference sheets the interior used), generate the hero, then composite the
// Variant-C title panel via renderCover(). Reuses existing sheets → 1 Gemini
// call per cover (~$0.04). If a render fails, log + move on (per instruction).

import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateImage } from "../src/gemini.js";
import { maskName } from "../src/text-utils.js";
import { renderCover } from "./render-cover.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const COVER_CONFIG = path.join(ROOT, "templates", "cover-iter-1", "config.json");
const config = JSON.parse(fs.readFileSync(COVER_CONFIG, "utf8"));
const OUT = path.join(ROOT, "output", "covers");
const GEMINI_USD = 0.04;
const GAP_MS = 6000;

const rel = (p) => path.relative(ROOT, p).replace(/\\/g, "/");

const COVERS = [
  {
    label: "Iris — gentle outdoor (easy calm-zone baseline)",
    name: "Iris", age: 5,
    titleStory: "output/stories/2026-05-29-iris-0003/story.json",      // title + guardrailed cover_concept (face right-side-up)
    charStory:  "output/books/2026-05-22-iris-1333/story.json",        // char desc matching the 1333 sheets
    sheetsDir:  "output/books/2026-05-22-iris-1333/character-sheets",
    outName: "cover-iris",
  },
  {
    label: "Anneliese — underwater shipwreck (BUSY scene stress test)",
    name: "Anneliese", age: 9,
    titleStory: "output/stories/2026-05-28-anneliese-2344/story.json", // title + cover_concept (fresh regen)
    charStory:  "output/books/2026-05-25-anneliese-1350/story.json",   // char desc matching the batch sheets
    sheetsDir:  "output/books/2026-05-25-anneliese-1350/character-sheets",
    outName: "cover-anneliese",
  },
  {
    label: "Søren — robot (cross-kid consistency check)",
    name: "Søren", age: 6,
    titleStory: "output/stories/2026-05-28-soren-2344/story.json",     // title + cover_concept (fresh regen)
    charStory:  "output/books/2026-05-25-s-ren-1354/story.json",       // char desc matching the batch sheets
    sheetsDir:  "output/books/2026-05-25-s-ren-1354/character-sheets",
    outName: "cover-soren",
  },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ig = config.imageGeneration;
let totalCost = 0;
const results = [];

// Optional filter: `--only <name>` renders just that protagonist (others
// left untouched). Default: all covers.
const onlyIdx = process.argv.indexOf("--only");
const onlyName = onlyIdx >= 0 ? (process.argv[onlyIdx + 1] || "").toLowerCase() : null;
const toRender = onlyName ? COVERS.filter((c) => c.name.toLowerCase() === onlyName) : COVERS;
if (onlyName && toRender.length === 0) {
  console.error(`No cover matches --only "${onlyName}". Names: ${COVERS.map((c) => c.name).join(", ")}`);
  process.exit(1);
}

console.log();
console.log("=".repeat(72));
console.log(`Cover render — ${toRender.length} of ${COVERS.length} (cover-iter-1, Variant C)${onlyName ? ` [--only ${onlyName}]` : ""}`);
console.log("=".repeat(72));

for (let i = 0; i < toRender.length; i++) {
  const c = toRender[i];
  console.log();
  console.log("-".repeat(72));
  console.log(c.label);
  try {
    const titleStory = JSON.parse(fs.readFileSync(path.join(ROOT, c.titleStory), "utf8"));
    const charStory = JSON.parse(fs.readFileSync(path.join(ROOT, c.charStory), "utf8"));
    const title = titleStory.title;
    if (!title) throw new Error(`no title in ${c.titleStory}`);
    // The cover scene is Sonnet's story-specific cover_concept (Part 1 field),
    // NOT a hand-written action. The composition template (config) supplies the
    // structural scaffold; cover_concept supplies WHAT is depicted.
    const coverConcept = titleStory.cover_concept;
    if (!coverConcept) throw new Error(`no cover_concept in ${c.titleStory} (regen with the cover_concept field)`);
    const charDesc = maskName(charStory.character, c.name);
    const negativePrompt = charStory.negative_prompt;
    const sheets = ["sheet-01.png", "sheet-02.png", "sheet-03.png"].map((f) => {
      const p = path.join(ROOT, c.sheetsDir, f);
      if (!fs.existsSync(p)) throw new Error(`missing sheet ${f} in ${c.sheetsDir}`);
      return fs.readFileSync(p);
    });

    const prompt = [
      `Subject: a ${c.age}-year-old child.`,
      `Appearance: ${charDesc}.`,
      `Style: ${ig.styleOverride}.`,
      `Composition: ${ig.customCompositionRules}`,
      `Template composition: ${ig.compositionPromptTemplate}`,
      `Avoid: ${negativePrompt}.`,
    ].join("\n") + `\n\nScene: ${coverConcept}\n\nUse the provided reference images of the character to keep their appearance, clothing, and proportions consistent.`;

    console.log(`  title:    "${title}"`);
    console.log(`  concept:  ${coverConcept.slice(0, 90)}...`);
    console.log(`  generating hero (Gemini, aspect ${ig.aspectRatio})...`);
    const t0 = Date.now();
    const buf = await generateImage(prompt, sheets, { aspectRatio: ig.aspectRatio });
    totalCost += GEMINI_USD;
    const outDir = path.join(OUT, c.outName);
    fs.mkdirSync(outDir, { recursive: true });
    const heroPath = path.join(outDir, "hero.png");
    fs.writeFileSync(heroPath, buf);
    const heroWall = ((Date.now() - t0) / 1000).toFixed(1);

    const r = await renderCover({
      title, subtitle: `A story for ${c.name}`,
      imagePath: heroPath, outputDir: outDir, configPath: COVER_CONFIG, outName: c.outName,
    });
    console.log(`  hero:     ${rel(heroPath)} (${heroWall}s)`);
    console.log(`  cover:    ${rel(r.pngPath)}  (title fontSize ${r.fontSize}pt, fits=${r.fits})`);
    results.push({ name: c.name, ok: true, pngPath: r.pngPath, fontSize: r.fontSize });
  } catch (err) {
    console.error(`  ✗ FAILED — ${err?.message ?? err}  (logged, moving on)`);
    results.push({ name: c.name, ok: false, error: err?.message ?? String(err) });
  }
  if (i < toRender.length - 1) await sleep(GAP_MS);
}

console.log();
console.log("=".repeat(72));
console.log("Cover batch summary");
console.log("=".repeat(72));
for (const r of results) {
  if (r.ok) console.log(`  ✓ ${r.name}: ${rel(r.pngPath)} (title ${r.fontSize}pt)`);
  else console.log(`  ✗ ${r.name}: FAILED — ${r.error}`);
}
console.log(`  Total Gemini cost: $${totalCost.toFixed(2)}  (${results.filter(r => r.ok).length}/${toRender.length} rendered)`);
console.log();
