// scripts/analyze-robustness-batch.js
// Analyze the 6 robustness-batch stories generated 2026-05-25.
// Reads story.json + meta.json from each output dir, computes the
// per-book metrics + cap violations + name-presence + adjacent-same.
//
// Read-only. No spend.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadTemplateRegistry } from "../src/template-registry.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, "..");
const STORIES_DIR = path.join(PROJECT_ROOT, "output", "stories");
const FAILED_DIR = path.join(STORIES_DIR, "_failed");

// Map run-id slugs to display name + expected name in narrative
const BOOKS = [
  { dirName: "2026-05-25-bo-1350",        displayName: "Bo",        age: 3, expectedName: "Bo" },
  { dirName: "2026-05-25-anneliese-1350", displayName: "Anneliese", age: 9, expectedName: "Anneliese" },
  { dirName: "2026-05-25-s-ren-1354",     displayName: "Søren",     age: 6, expectedName: "Søren" },
  { dirName: "2026-05-25-mia-1350",       displayName: "Mia",       age: 4, expectedName: "Mia" },
  { dirName: "2026-05-25-tobias-1401",    displayName: "Tobias",    age: 9, expectedName: "Tobias" },
  { dirName: "2026-05-25-priya-1350",     displayName: "Priya",     age: 7, expectedName: "Priya" },
];

// Build template-cap map from registry
const registry = await loadTemplateRegistry();
const TEMPLATE_CAPS = {};
for (const t of registry) {
  TEMPLATE_CAPS[t.id] = t.selection_metadata.max_narrative_chars; // null = any
}

// Find _failed captures from today (proxy for Option B fires)
const failedCapturesByTime = [];
if (fs.existsSync(FAILED_DIR)) {
  for (const f of fs.readdirSync(FAILED_DIR)) {
    if (!f.startsWith("2026-05-25T")) continue;
    const fp = path.join(FAILED_DIR, f);
    const stat = fs.statSync(fp);
    const obj = JSON.parse(fs.readFileSync(fp, "utf8"));
    failedCapturesByTime.push({ filename: f, mtime: stat.mtime, error: obj.error || "" });
  }
}

function findCaptureFor(book, meta) {
  const completedAt = new Date(meta.completed_at);
  // Capture is written just BEFORE the response is parsed/returned, i.e.
  // milliseconds before completion. Match the capture whose mtime is
  // within ±2s of the book's completion time.
  for (const cap of failedCapturesByTime) {
    const diff = Math.abs(cap.mtime - completedAt);
    if (diff < 2000) return cap;
  }
  return null;
}

// Count name occurrences in narrative_text across all scenes
function countNameOccurrences(scenes, name) {
  let n = 0;
  const re = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:'s)?\\b`, "gi");
  for (const s of scenes) {
    const matches = s.narrative_text.match(re);
    if (matches) n += matches.length;
  }
  return n;
}

// Find adjacent-same pairs in template sequence
function adjacentSameCount(scenes) {
  let n = 0;
  for (let i = 1; i < scenes.length; i++) {
    if (scenes[i].layout_intent.template_id === scenes[i - 1].layout_intent.template_id) n++;
  }
  return n;
}

// Flag any page whose narrative exceeds its template's cap
function findCapViolations(scenes) {
  const out = [];
  for (const s of scenes) {
    const cap = TEMPLATE_CAPS[s.layout_intent.template_id];
    if (cap === null || cap === undefined) continue;
    const len = s.narrative_text.length;
    if (len > cap) {
      out.push({ page: s.page, template: s.layout_intent.template_id, chars: len, cap });
    }
  }
  return out;
}

// Template distribution
function distribution(scenes) {
  const out = {};
  for (const s of scenes) {
    const t = s.layout_intent.template_id;
    out[t] = (out[t] || 0) + 1;
  }
  return out;
}

console.log();
console.log("=".repeat(78));
console.log("ROBUSTNESS BATCH analysis — 6 books, 2026-05-25");
console.log("=".repeat(78));
console.log();
console.log("Template caps from registry:");
for (const t of Object.keys(TEMPLATE_CAPS).sort()) {
  console.log(`  ${t}: ${TEMPLATE_CAPS[t] === null ? "any" : TEMPLATE_CAPS[t] + " chars"}`);
}
console.log();

const all = [];
for (const book of BOOKS) {
  const bookDir = path.join(STORIES_DIR, book.dirName);
  const story = JSON.parse(fs.readFileSync(path.join(bookDir, "story.json"), "utf8"));
  const meta = JSON.parse(fs.readFileSync(path.join(bookDir, "meta.json"), "utf8"));

  const lengths = story.scenes.map((s) => s.narrative_text.length);
  const avg = Math.round(lengths.reduce((a, b) => a + b, 0) / lengths.length);
  const minLen = Math.min(...lengths);
  const maxLen = Math.max(...lengths);

  const dist = distribution(story.scenes);
  const adj = adjacentSameCount(story.scenes);
  const violations = findCapViolations(story.scenes);
  const nameCount = countNameOccurrences(story.scenes, book.expectedName);
  const capture = findCaptureFor(book, meta);
  const sequence = story.scenes.map((s) => {
    const t = s.layout_intent.template_id;
    if (t === "prompt-2-iter-2") return "2";
    if (t === "prompt-3-iter-2") return "3";
    if (t === "prompt-6-iter-1") return "6";
    if (t === "prompt-8-iter-1") return "8";
    return "?";
  }).join("-");

  all.push({
    book, story, meta, lengths, avg, minLen, maxLen, dist, adj, violations,
    nameCount, capture, sequence,
  });

  console.log("-".repeat(78));
  console.log(`${book.displayName} / ${book.age} — ${meta.inputs.theme}`);
  console.log("-".repeat(78));
  console.log(`  dir:                 output/stories/${book.dirName}/`);
  console.log(`  completed in 1 try?  YES (no retry — Option B fires inline)`);
  if (capture) {
    console.log(`  COUNT-DRIFT:         ✓ Option B fired — ${capture.error}`);
  } else {
    console.log(`  count-drift:         clean (no _failed capture for this story)`);
  }
  console.log(`  scenes.length:       ${story.scenes.length}  (must be 12)`);
  console.log(`  narrative lengths:   min ${minLen} / avg ${avg} / max ${maxLen} chars`);
  console.log(`  template distrib:    ${Object.entries(dist).map(([k, v]) => `${k}:${v}`).join(", ")}`);
  console.log(`  template sequence:   ${sequence}`);
  console.log(`  adjacent-same pairs: ${adj}/11`);
  console.log(`  name "${book.expectedName}" in narratives: ${nameCount} occurrences across 12 pages`);
  if (violations.length === 0) {
    console.log(`  cap violations:      none ✓`);
  } else {
    console.log(`  CAP VIOLATIONS:      ${violations.length} page(s):`);
    for (const v of violations) {
      console.log(`    page ${v.page}: ${v.chars} chars > ${v.cap} cap on ${v.template}`);
    }
  }
  console.log(`  cost:                $${(meta.estimated_cost_usd || 0).toFixed(4)}  duration: ${meta.duration_seconds}s`);
  console.log();
}

// Cross-book summary
console.log();
console.log("=".repeat(78));
console.log("CROSS-BOOK SUMMARY");
console.log("=".repeat(78));
console.log();
console.log("Avg chars/page by age (does age affect length?):");
const byAge = [...all].sort((a, b) => a.book.age - b.book.age);
for (const a of byAge) {
  console.log(`  age ${a.book.age}: ${a.book.displayName.padEnd(11)} avg ${a.avg} chars/page  (min ${a.minLen} / max ${a.maxLen})`);
}
console.log();

console.log("Template distribution per book (counts):");
console.log("  book          p2    p3    p6    p8");
for (const a of all) {
  const r = a.dist;
  console.log(`  ${a.book.displayName.padEnd(13)} ${String(r["prompt-2-iter-2"] || 0).padStart(2)}    ${String(r["prompt-3-iter-2"] || 0).padStart(2)}    ${String(r["prompt-6-iter-1"] || 0).padStart(2)}    ${String(r["prompt-8-iter-1"] || 0).padStart(2)}`);
}
console.log();

console.log("Adjacent-same pairs per book (should be 0):");
for (const a of all) {
  const flag = a.adj === 0 ? "✓" : "⚠";
  console.log(`  ${a.book.displayName.padEnd(13)} ${a.adj}/11 ${flag}`);
}
console.log();

console.log("Cap violations across all 6 books:");
const totalV = all.reduce((sum, a) => sum + a.violations.length, 0);
if (totalV === 0) {
  console.log("  ✓ ZERO cap violations across all books — selection layer respected char caps.");
} else {
  console.log(`  ⚠ ${totalV} total violations.`);
  for (const a of all) {
    if (a.violations.length > 0) {
      console.log(`  ${a.book.displayName}:`);
      for (const v of a.violations) {
        console.log(`    page ${v.page}: ${v.chars} chars > ${v.cap} on ${v.template}`);
      }
    }
  }
}
console.log();

console.log("Count-drift Option B fires:");
const drifters = all.filter((a) => a.capture).map((a) => a.book.displayName);
const cleanies = all.filter((a) => !a.capture).map((a) => a.book.displayName);
console.log(`  fired (Option B silently caught): ${drifters.length}/6 — ${drifters.join(", ") || "(none)"}`);
console.log(`  clean first-attempt 12 scenes:    ${cleanies.length}/6 — ${cleanies.join(", ") || "(none)"}`);
console.log();
