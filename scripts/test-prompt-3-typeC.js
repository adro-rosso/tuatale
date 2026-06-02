// scripts/test-prompt-3-typeC.js
// $0 validation of the prompt-3-iter-2 Type C migration (region-detection
// → fixed config.textRegion box + auto-fit, 2026-05-21).
//
// Renders 4 scenes through Type C via imagePathOverride pointing at the
// existing Phase-2 vignette PNGs — tests the TEMPLATE/placement/backdrop
// change only, NOT image generation. No Gemini calls, $0.
//   pages 2, 4 — the previously-escalating cases (rug-tail, tall vignette):
//     does text land cleanly + legibly despite vignette intrusion?
//   pages 5, 11 — the clean-cream passes: backdrop must stay INVISIBLE,
//     floating-on-cream intimacy preserved (no regression).
//
// The validation reuses Phase-2 PNGs generated under the OLD composition
// prompt — it does NOT exercise the rewritten composition prompt. A fresh
// ~$0.04 Gemini render is owed after backdrop sign-off to confirm the
// rewritten prompt still forms a contained vignette at generation time.

import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderPageWithTemplate } from "../src/page-pipeline.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, "..");
const BOOK_DIR = path.join(PROJECT_ROOT, "output", "books", "2026-05-21-iris-1104");
const TEMPLATE_CONFIG = path.join(PROJECT_ROOT, "templates", "prompt-3-iter-2", "config.json");
const PHASE2_DIR = path.join(PROJECT_ROOT, "templates", "prompt-3-iter-2", "test-output", "phase2");
const OUT_DIR = path.join(PROJECT_ROOT, "templates", "prompt-3-iter-2", "test-output", "typeC");

// pageNum → which Phase-2 vignette PNG to override with, and what it tests.
const CASES = [
  { page: 2,  png: "page-02.png", kind: "intrusion (bedroom rug-tail)" },
  { page: 4,  png: "page-04.png", kind: "intrusion (tall vignette)" },
  { page: 5,  png: "page-05.png", kind: "clean cream (no-regression)" },
  { page: 11, png: "page-11.png", kind: "clean cream (no-regression)" },
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
console.log("prompt-3-iter-2 Type C validation ($0 — imagePathOverride)");
console.log("=".repeat(72));
console.log();
console.log(`textRegion: x=${tr.x} y=${tr.y} w=${tr.width} h=${tr.height} (fractional page)`);
console.log(`Backdrop:   feathered cream #F0E8D8, opacity 0.55 (template.html)`);

const results = [];
for (const c of CASES) {
  const scene = story.scenes.find((s) => s.page === c.page);
  const overridePath = path.join(PHASE2_DIR, c.png);

  if (!fs.existsSync(overridePath)) {
    console.error(`FAIL: Phase-2 PNG missing: ${displayPath(overridePath)}`);
    process.exit(1);
  }

  console.log();
  console.log("-".repeat(72));
  console.log(`Page ${c.page} — ${c.kind} (${scene.narrative_text.length} chars)`);
  console.log("-".repeat(72));

  const tStart = Date.now();
  const result = await renderPageWithTemplate({
    templateConfigPath: TEMPLATE_CONFIG,
    scene: { page: c.page, action: scene.action },
    narrativeText: scene.narrative_text,
    outputDir: OUT_DIR,
    imagePathOverride: overridePath,
  });
  const wallMs = Date.now() - tStart;

  results.push({ ...c, result, wallMs });

  console.log(`  success:   ${result.success}`);
  if (result.error) console.log(`  error:     ${result.error}`);
  console.log(`  fontSize:  ${result.diagnostics.fontSize}pt  (auto-fit into fixed box)`);
  console.log(`  cost:      $${result.diagnostics.cost.toFixed(2)}`);
  console.log(`  wall:      ${(wallMs / 1000).toFixed(1)}s`);
  if (result.pdfPath && fs.existsSync(result.pdfPath)) {
    const sz = (fs.statSync(result.pdfPath).size / 1024).toFixed(1);
    console.log(`  PDF:       ${displayPath(result.pdfPath)} (${sz} KB)`);
  }
}

const successCount = results.filter((r) => r.result.success).length;
const totalCost = results.reduce((s, r) => s + (r.result.diagnostics?.cost ?? 0), 0);

console.log();
console.log("=".repeat(72));
console.log(`Type C validation: ${successCount}/4 rendered  ·  cost $${totalCost.toFixed(2)}`);
console.log("=".repeat(72));
console.log();
console.log("PDFs for visual judgment:");
console.log("  Intrusion cases — text should land legibly:");
for (const r of results.filter((x) => x.kind.startsWith("intrusion"))) {
  if (r.result.pdfPath) console.log(`    - ${displayPath(r.result.pdfPath)}`);
}
console.log("  Clean-cream cases — backdrop must be INVISIBLE:");
for (const r of results.filter((x) => x.kind.startsWith("clean"))) {
  if (r.result.pdfPath) console.log(`    - ${displayPath(r.result.pdfPath)}`);
}
console.log();
