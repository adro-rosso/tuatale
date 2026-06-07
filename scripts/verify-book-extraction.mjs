// scripts/verify-book-extraction.mjs — B.3 behaviour-preservation check.
//
// Proves the generateBook() extraction (src/book-pipeline.js) reproduces the
// pre-extraction pipeline's output, at $0 and deterministically:
//
//   - Replays a fixture book's existing page-NN.png images via the
//     resolveImageOverride seam, so NO Gemini call fires.
//   - Reuses the fixture's character-sheets (fingerprint match → FULL_SKIP),
//     so NO sheet-mint call fires.
//   - Asserts every page-NN-rendered.png is BYTE-IDENTICAL to the fixture's
//     (the deterministic artifact — see the B.3 determinism probe: PNG is
//     reproducible; PDF embeds a Puppeteer wall-clock so it is not).
//   - Asserts book.pdf STRUCTURE: page count + each page's dimensions.
//
// Usage:
//   node scripts/verify-book-extraction.mjs [--fixture output/books/<id>]
// Default fixture: output/books/2026-06-01-elena-1500
//
// Exit 0 = all checks pass; exit 1 = any mismatch.

import "dotenv/config"; // src/gemini.js reads GEMINI_API_KEY at import time
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { PDFDocument } from "pdf-lib";
import { loadTemplateRegistry } from "../src/template-registry.js";
import { generateBook } from "../src/book-pipeline.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, "..");

// ---- Args ------------------------------------------------------------------
const argv = process.argv.slice(2);
let fixtureArg = "output/books/2026-06-01-elena-1500";
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === "--fixture") fixtureArg = argv[++i];
  else if (argv[i].startsWith("--fixture=")) fixtureArg = argv[i].slice("--fixture=".length);
}
const FIX = path.resolve(PROJECT_ROOT, fixtureArg);
if (!fs.existsSync(path.join(FIX, "story.json"))) {
  console.error(`FAIL: fixture not found or missing story.json: ${FIX}`);
  process.exit(1);
}

const sha = (buf) => crypto.createHash("sha256").update(buf).digest("hex");
const shaFile = (p) => sha(fs.readFileSync(p));
const pad2 = (n) => String(n).padStart(2, "0");

// Quiet logger so the extraction's progress chatter doesn't drown the report.
const quiet = { log: () => {}, warn: () => {}, error: (...a) => console.error(...a) };

async function main() {
  // ---- Stage the fixture into a fresh temp book dir ----
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "verify-book-"));
  fs.mkdirSync(path.join(tmp, "character-sheets"), { recursive: true });
  fs.copyFileSync(path.join(FIX, "story.json"), path.join(tmp, "story.json"));
  fs.copyFileSync(path.join(FIX, "meta.json"), path.join(tmp, "meta.json"));
  for (const f of fs.readdirSync(path.join(FIX, "character-sheets"))) {
    fs.copyFileSync(
      path.join(FIX, "character-sheets", f),
      path.join(tmp, "character-sheets", f),
    );
  }

  const story = JSON.parse(fs.readFileSync(path.join(tmp, "story.json"), "utf8"));
  const meta = JSON.parse(fs.readFileSync(path.join(tmp, "meta.json"), "utf8"));
  const childName = meta.inputs.child.name;
  const childAge = meta.inputs.child.age;
  const registry = await loadTemplateRegistry();

  // Replay the fixture's page images — no Gemini call.
  const resolveImageOverride = (scene) =>
    path.join(FIX, "pages", `page-${pad2(scene.page)}.png`);

  console.log(`Fixture: ${path.relative(PROJECT_ROOT, FIX).replace(/\\/g, "/")}`);
  console.log(`Child:   ${childName}, age ${childAge}  (${story.scenes.length} scenes)`);
  console.log(`Temp:    ${tmp}\n`);

  const t0 = Date.now();
  const result = await generateBook({
    story, meta, childName, childAge,
    outputDir: tmp,
    registry,
    resolveImageOverride,
    logger: quiet,
  });
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

  // ---- Check 1: rendered-PNG byte identity, all pages ----
  let pngPass = 0, pngFail = 0;
  console.log("Rendered-PNG byte identity (page-NN-rendered.png vs fixture):");
  for (const scene of story.scenes) {
    const name = `page-${pad2(scene.page)}-rendered.png`;
    const newPath = path.join(tmp, "pages", name);
    const fixPath = path.join(FIX, "pages", name);
    if (!fs.existsSync(newPath)) { console.log(`  ✗ page ${pad2(scene.page)}: NOT PRODUCED`); pngFail++; continue; }
    if (!fs.existsSync(fixPath)) { console.log(`  ? page ${pad2(scene.page)}: no fixture artifact to compare`); continue; }
    const match = shaFile(newPath) === shaFile(fixPath);
    console.log(`  ${match ? "✓" : "✗"} page ${pad2(scene.page)}  ${shaFile(newPath).slice(0, 12)}${match ? "" : ` != ${shaFile(fixPath).slice(0, 12)}`}`);
    match ? pngPass++ : pngFail++;
  }

  // ---- Check 2: book.pdf structure ----
  console.log("\nbook.pdf structure:");
  const doc = await PDFDocument.load(result.bookPdfBytes);
  const pageCount = doc.getPageCount();
  const expectedPages = story.scenes.length;
  const countOk = pageCount === expectedPages;
  console.log(`  ${countOk ? "✓" : "✗"} page count: ${pageCount} (expected ${expectedPages})`);

  let dimsOk = true;
  for (let i = 0; i < pageCount; i++) {
    const { width, height } = doc.getPage(i).getSize();
    const ok = Math.abs(width - 792) < 1 && Math.abs(height - 612) < 1;
    if (!ok) { dimsOk = false; console.log(`  ✗ page ${i + 1} dims: ${width.toFixed(1)}x${height.toFixed(1)}pt (expected 792x612)`); }
  }
  if (dimsOk) console.log(`  ✓ all pages 792x612pt (11x8.5in landscape)`);

  // ---- Verdict ----
  const fixturePageCount = (await PDFDocument.load(fs.readFileSync(path.join(FIX, "book.pdf")))).getPageCount();
  console.log(`\n(reference: fixture book.pdf = ${fixturePageCount} pages)`);
  const allPass = pngFail === 0 && pngPass > 0 && countOk && dimsOk;
  console.log("\n" + "=".repeat(60));
  console.log(`PNG identity: ${pngPass} match / ${pngFail} mismatch`);
  console.log(`PDF structure: count ${countOk ? "OK" : "FAIL"}, dims ${dimsOk ? "OK" : "FAIL"}`);
  console.log(`Sheet/Gemini calls: ${result.totalCalls} (expected 0 — fully replayed)`);
  console.log(`Wall time: ${elapsed}s`);
  console.log(allPass ? "RESULT: ✅ PASS — extraction is behaviour-preserving" : "RESULT: ❌ FAIL");
  console.log("=".repeat(60));

  fs.rmSync(tmp, { recursive: true, force: true });
  process.exit(allPass ? 0 : 1);
}

main().catch((err) => {
  console.error("\nVERIFY HARNESS ERROR:");
  console.error(err);
  process.exit(1);
});
