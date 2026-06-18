// scripts/probe-frontmatter-assembly.mjs
// Stage B.1 probe (~$0.04, gated): exercise the REAL front-matter assembly
// (src/front-matter.js assembleFrontMatter — the same code book-pipeline calls
// when FEATURES_FRONTMATTER=on) on an EXISTING single-protagonist book, gening
// ONLY the cover hero and REUSING the 12 story-page PDFs. Then merge the full
// sequence into one book.pdf:  cover → title → [story ×12] → dedication → colophon.
//
// Isolates cover + assembly at ~$0.04 (one Gemini hero call). Does NOT regen the
// 12 story pages. On API drag / credit depletion the generateImage error
// propagates → we log + exit (no thrash).
//
// Usage: node scripts/probe-frontmatter-assembly.mjs [--book <dir>]

import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PDFDocument } from "pdf-lib";
import { assembleFrontMatter } from "../src/front-matter.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const argv = process.argv.slice(2);
const gi = argv.indexOf("--book");
const BOOK = path.resolve(ROOT, gi >= 0 && argv[gi + 1] ? argv[gi + 1] : "output/books/2026-06-16-leo-fatherson");
const OUT = path.join(ROOT, "output", "_eval-harness", "stageB1-probe");
const rel = (p) => path.relative(ROOT, p).replace(/\\/g, "/");

async function main() {
  const story = JSON.parse(fs.readFileSync(path.join(BOOK, "story.json"), "utf8"));
  const meta = JSON.parse(fs.readFileSync(path.join(BOOK, "meta.json"), "utf8"));
  const child = meta.inputs?.child ?? {};
  const childName = child.name ?? story.cover_subjects?.[0];
  const childAge = child.age ?? 6;

  // Protagonist sheets (reuse — no mint).
  const sheets = ["sheet-01.png", "sheet-02.png", "sheet-03.png"]
    .map((f) => path.join(BOOK, "character-sheets", f))
    .filter((p) => fs.existsSync(p)).map((p) => fs.readFileSync(p));
  if (!sheets.length) throw new Error(`no protagonist sheets in ${rel(BOOK)}/character-sheets`);

  // The 12 existing story-page PDFs (reuse — no regen).
  const storyPdfs = [];
  for (let i = 1; i <= 12; i++) {
    const p = path.join(BOOK, "pages", `page-${String(i).padStart(2, "0")}.pdf`);
    if (!fs.existsSync(p)) throw new Error(`missing story page PDF: ${rel(p)}`);
    storyPdfs.push(p);
  }

  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });

  console.log(`\n${"=".repeat(72)}`);
  console.log(`Stage B.1 front-matter assembly probe — source: ${rel(BOOK)} (reusing 12 story PDFs)`);
  console.log(`child: ${childName}, age ${childAge}, ${sheets.length} sheets reused — gening ONLY the cover (~$0.04)`);
  console.log(`${"=".repeat(72)}\n`);

  // REAL production assembly: gens cover hero (paid) + renders title/dedication/colophon ($0).
  const fm = await assembleFrontMatter({
    story, childName, childAge, sheets,
    generatedAtIso: meta.generatedAt, outputDir: OUT, withCover: true,
  });
  console.log(`  front matter: ${fm.front.length} front + ${fm.back.length} back page(s); cover gen $${fm.cost.toFixed(2)}`);

  // Merge full sequence: front (cover, title) + story ×12 + back (dedication, colophon).
  const ordered = [...fm.front, ...storyPdfs, ...fm.back];
  const merged = await PDFDocument.create();
  for (const p of ordered) {
    const src = await PDFDocument.load(fs.readFileSync(p));
    (await merged.copyPages(src, src.getPageIndices())).forEach((pg) => merged.addPage(pg));
  }
  const bookPath = path.join(OUT, "book.pdf");
  fs.writeFileSync(bookPath, await merged.save());

  console.log(`\n  ✓ merged ${merged.getPageCount()} pages → ${rel(bookPath)}`);
  console.log(`  sequence: cover, title, story-01..12, dedication, colophon (expect 16 pages)`);
  console.log(`  cover PNG for quick view: ${rel(path.join(OUT, "00-cover.png"))}`);
  console.log(`\n  TOTAL SPENT: ~$${fm.cost.toFixed(2)}\n`);
}

main().catch((e) => { console.error(`\nPROBE STOPPED — ${e.message}\n(If this is RESOURCE_EXHAUSTED / a timeout, it's API drag/credits — not a code bug.)`); process.exit(1); });
