// scripts/probe-stageC-calmzone.mjs
// Item 3 / Stage C — GATED gen probe: does Gemini actually honor the calm-zone
// composition steering? This can only be judged on FRESH gens (the eval harness
// reuses old images painted for the old specs), so this probe runs the REAL
// render path (renderPageWithTemplate WITHOUT imagePathOverride → a true Gemini
// image gen) for one scene per live template, then lays it out.
//
// $0 reuse to isolate cost: reuse an existing SINGLE-PROTAGONIST book's
// character sheets (no sheet-mint) + its existing scenes (no story-gen). N=1
// only (isolates calm-zone steering from multichar canvas-seam drift).
//
// COST: 1 Gemini image call per template (~$0.04 each) = ~$0.16 for 4 templates.
// SAFETY: DRY-RUN by default (prints the plan + cost, calls NOTHING). Pass --go
// to actually spend. Per the probe-before-build discipline, the spend is gated.
//
// Usage:
//   node scripts/probe-stageC-calmzone.mjs              # dry run, $0, shows plan
//   node scripts/probe-stageC-calmzone.mjs --go         # SPENDS ~$0.16

import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadTemplateRegistry } from "../src/template-registry.js";
import { renderPageWithTemplate } from "../src/page-pipeline.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const USD_PER_CALL = 0.04;

const argv = process.argv.slice(2);
const GO = argv.includes("--go");
const getArg = (flag, def) => { const i = argv.indexOf(flag); return i >= 0 && argv[i + 1] ? argv[i + 1] : def; };
const BOOK = path.resolve(ROOT, getArg("--book", "output/books/2026-05-24-iris-2229"));
const REVIEW_DIR = path.join(ROOT, "output", "_eval-harness", "stageC-probe");
const rel = (p) => path.relative(ROOT, p).replace(/\\/g, "/");

// Pick, for a template, a scene that NATIVELY chose it in the source book,
// preferring the one whose narrative fits its char ceiling most snugly.
function pickScene(scenes, tmpl) {
  const maxChars = tmpl.selection_metadata?.max_narrative_chars ?? null;
  const fits = (n) => maxChars == null || n <= maxChars;
  const native = scenes.filter((s) => s.layout_intent?.template_id === tmpl.id && (s.narrative_text || "").length > 0);
  const pool = native.length ? native : scenes.filter((s) => (s.narrative_text || "").length > 0);
  return [...pool].sort((a, b) => {
    const la = (a.narrative_text || "").length, lb = (b.narrative_text || "").length;
    if (fits(la) !== fits(lb)) return fits(la) ? -1 : 1;
    return (maxChars ?? 1e9) - la - ((maxChars ?? 1e9) - lb);
  })[0];
}

async function main() {
  if (!fs.existsSync(BOOK)) throw new Error(`book dir not found: ${BOOK}`);
  const meta = JSON.parse(fs.readFileSync(path.join(BOOK, "meta.json"), "utf8"));
  const story = JSON.parse(fs.readFileSync(path.join(BOOK, "story.json"), "utf8"));
  const child = meta.inputs?.child ?? {};
  if ((story.companion_characters || []).length > 0) {
    throw new Error(`probe requires a single-protagonist book (N=1); ${rel(BOOK)} has companions`);
  }

  // Reuse the protagonist's character sheets as references (no mint).
  const sheetsDir = path.join(BOOK, "character-sheets");
  const sheetFiles = fs.readdirSync(sheetsDir).filter((f) => /^sheet-\d+\.png$/i.test(f)).sort();
  if (!sheetFiles.length) throw new Error(`no sheet-NN.png in ${rel(sheetsDir)}`);
  const sheets = sheetFiles.map((f) => fs.readFileSync(path.join(sheetsDir, f)));

  const subject = {
    name: child.name ?? story.cover_subjects?.[0] ?? "Child",
    age: child.age ?? 5,
    description: story.character,            // rich protagonist appearance paragraph
    subjectType: "human",
    sheets,                                  // refs anchor appearance; sheets dominate
  };

  const registry = await loadTemplateRegistry();
  const plan = registry.map((tmpl, i) => {
    const sc = pickScene(story.scenes || [], tmpl);
    return { slot: String(i + 1).padStart(2, "0"), tmpl, scene: sc };
  });

  console.log(`\n${"=".repeat(72)}`);
  console.log(`Stage C calm-zone probe ${GO ? "(LIVE — SPENDING)" : "(DRY RUN — $0)"} — source: ${rel(BOOK)} (N=1)`);
  console.log(`subject: ${subject.name}, age ${subject.age}, ${sheets.length} sheets reused`);
  console.log(`${"=".repeat(72)}\n`);
  for (const p of plan) {
    console.log(`  ${p.slot}  ${p.tmpl.id.padEnd(16)} ← p${p.scene.page} (${(p.scene.narrative_text || "").length} chars)  "${(p.scene.action || "").slice(0, 56)}…"`);
  }
  const est = (plan.length * USD_PER_CALL).toFixed(2);
  console.log(`\nGemini image calls: ${plan.length} × $${USD_PER_CALL} = ~$${est}  (story-gen + sheets reused = $0)`);

  if (!GO) {
    console.log(`\nDRY RUN — nothing generated, $0 spent. Re-run with --go to spend ~$${est}.\n`);
    return;
  }

  fs.rmSync(REVIEW_DIR, { recursive: true, force: true });
  fs.mkdirSync(REVIEW_DIR, { recursive: true });
  let spent = 0;
  const results = [];
  for (const p of plan) {
    const tmpOut = path.join(REVIEW_DIR, "_raw", p.tmpl.id);
    fs.mkdirSync(tmpOut, { recursive: true });
    const res = await renderPageWithTemplate({
      templateConfigPath: p.tmpl.configPath,
      scene: { page: p.scene.page, action: p.scene.action },
      narrativeText: p.scene.narrative_text,
      subjects: [subject],
      sceneStyle: story.style,
      sceneNegativePrompt: story.negative_prompt,
      outputDir: tmpOut,
      callContext: { callKind: "stageC_probe", subjectName: subject.name },
    });
    spent += res.diagnostics?.cost ?? 0;
    if (res.success) {
      fs.copyFileSync(res.renderedPngPath, path.join(REVIEW_DIR, `${p.slot}-${p.tmpl.id}.png`));
      if (res.imagePath) fs.copyFileSync(res.imagePath, path.join(REVIEW_DIR, `${p.slot}-${p.tmpl.id}-rawgen.png`));
      console.log(`  ${p.slot}  ${p.tmpl.id.padEnd(16)} ✓  rendered (fontSize ${res.diagnostics?.fontSize})`);
    } else {
      console.log(`  ${p.slot}  ${p.tmpl.id.padEnd(16)} ✗  ${res.error}`);
    }
    results.push({ ...p, tmpl: p.tmpl.id, scene: p.scene.page, success: res.success, error: res.error ?? null });
  }
  fs.writeFileSync(path.join(REVIEW_DIR, "manifest.json"), JSON.stringify({ book: rel(BOOK), spent, results }, null, 2));
  console.log(`\nSPENT ~$${spent.toFixed(2)} on ${plan.length} Gemini calls. Review: ${rel(REVIEW_DIR)}`);
  console.log(`Judge each: (1) text-zone calm/uncluttered? (2) edge feather melts to cream? (3) image+text cohesive?\n`);
}

main().catch((e) => { console.error("probe failed:", e.message); process.exit(1); });
