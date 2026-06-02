// scripts/test-prompt-3-typeC-reposition.js
// $0 validation of the prompt-3-iter-2 textRegion reposition (y 0.63 →
// 0.70, height 0.30 → 0.25, 2026-05-21) — moving the text box down so
// the first line clears standing-figure vignettes.
//
// 3 cases, all via imagePathOverride (no Gemini, $0):
//   BEDROOM  — override the fresh standing-figure vignette (typeC-fresh):
//              "did we fix it" — first line must clear her boots.
//   PAGE 5   — lying figure (phase2 PNG): the REAL test — moving the box
//   PAGE 11  — kneeling figure (phase2 PNG): down grows the cream gap on
//              these previously-pristine scenes; confirm it reads as
//              intentional clearing, not marooned/disconnected text.

import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderPageWithTemplate } from "../src/page-pipeline.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, "..");
const BOOK_DIR = path.join(PROJECT_ROOT, "output", "books", "2026-05-21-iris-1104");
const TEMPLATE_CONFIG = path.join(PROJECT_ROOT, "templates", "prompt-3-iter-2", "config.json");
const TEST_OUT = path.join(PROJECT_ROOT, "templates", "prompt-3-iter-2", "test-output");
const OUT_DIR = path.join(TEST_OUT, "typeC-reposition");

const CASES = [
  {
    page: 2, label: "bedroom-standing",
    override: path.join(TEST_OUT, "typeC-fresh", "page-02-fresh.png"),
    check: "first line must clear her boots → land on clean cream",
  },
  {
    page: 5, label: "page05-lying",
    override: path.join(TEST_OUT, "phase2", "page-05.png"),
    check: "was pristine — gap must read as intentional clearing, not disconnected",
  },
  {
    page: 11, label: "page11-kneeling",
    override: path.join(TEST_OUT, "phase2", "page-11.png"),
    check: "was pristine — gap must read as intentional clearing, not disconnected",
  },
];

function displayPath(p) {
  return path.relative(PROJECT_ROOT, p).replace(/\\/g, "/");
}

const story = JSON.parse(fs.readFileSync(path.join(BOOK_DIR, "story.json"), "utf8"));
const config = JSON.parse(fs.readFileSync(TEMPLATE_CONFIG, "utf8"));
const tr = config.textRegion;

fs.mkdirSync(OUT_DIR, { recursive: true });

console.log();
console.log("=".repeat(72));
console.log("prompt-3-iter-2 Type C — textRegion reposition validation ($0)");
console.log("=".repeat(72));
console.log();
console.log(`textRegion: x=${tr.x} y=${tr.y} w=${tr.width} h=${tr.height}  (box spans page y ${tr.y * 100}%-${(tr.y + tr.height) * 100}%)`);

const results = [];
for (const c of CASES) {
  const scene = story.scenes.find((s) => s.page === c.page);
  if (!fs.existsSync(c.override)) {
    console.error(`FAIL: override PNG missing: ${displayPath(c.override)}`);
    process.exit(1);
  }

  console.log();
  console.log("-".repeat(72));
  console.log(`Page ${c.page} — ${c.label} (${scene.narrative_text.length} chars)`);
  console.log(`  check: ${c.check}`);
  console.log("-".repeat(72));

  const result = await renderPageWithTemplate({
    templateConfigPath: TEMPLATE_CONFIG,
    scene: { page: `${String(c.page).padStart(2, "0")}-${c.label}`, action: scene.action },
    narrativeText: scene.narrative_text,
    outputDir: OUT_DIR,
    imagePathOverride: c.override,
  });

  results.push({ ...c, result });

  console.log(`  success:  ${result.success}`);
  if (result.error) console.log(`  error:    ${result.error}`);
  console.log(`  fontSize: ${result.diagnostics.fontSize}pt`);
  console.log(`  cost:     $${result.diagnostics.cost.toFixed(2)}`);
  if (result.pdfPath && fs.existsSync(result.pdfPath)) {
    const sz = (fs.statSync(result.pdfPath).size / 1024).toFixed(1);
    console.log(`  PDF:      ${displayPath(result.pdfPath)} (${sz} KB)`);
  }
}

const totalCost = results.reduce((s, r) => s + (r.result.diagnostics?.cost ?? 0), 0);
console.log();
console.log("=".repeat(72));
console.log(`Reposition validation: ${results.filter((r) => r.result.success).length}/3 rendered · cost $${totalCost.toFixed(2)}`);
console.log("=".repeat(72));
console.log();
console.log("PDFs for visual judgment:");
for (const r of results) {
  if (r.result.pdfPath) console.log(`  - ${displayPath(r.result.pdfPath)}`);
}
console.log();
