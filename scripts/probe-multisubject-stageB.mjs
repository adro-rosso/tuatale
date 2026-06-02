// scripts/probe-multisubject-stageB.mjs
// STAGE B PROBE (throwaway): two HUMAN children. Søren + Theo, deliberately
// confusable (both small pale Western kids), distinguished by 3 markers each
// across hair / face / clothes. 2+2 reference budget (= 4-ref ceiling).
// Per-kid feature emphasis kept; meta "don't blend" instruction NOT used —
// the test is whether sheets + emphasis hold faces distinct on their own.

import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateImage } from "../src/gemini.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const OUT = path.join(ROOT, "templates", "_multisubject-probe");

const SOREN_DIR = path.join(ROOT, "output", "books", "2026-05-25-s-ren-1354");
const story = JSON.parse(fs.readFileSync(path.join(SOREN_DIR, "story.json"), "utf8"));
const STYLE = story.style;
const NEG = story.negative_prompt;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rel = (p) => path.relative(ROOT, p).replace(/\\/g, "/");

function maskName(text, name) {
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return text.replace(new RegExp(`\\b${esc}(?:'s)?\\b`, "g"), "").replace(/\s+/g, " ").trim();
}
const sorenBaseDesc = maskName(story.character, "Søren");

// Søren's 3 defining markers (re-stated each page so emphasis is parallel
// to Theo's).
const SOREN_MARKERS = "DEFINING IDENTITY MARKERS — Søren has: (1) short, tousled brown hair that sticks up a little; (2) WARM GREEN EYES (clearly green, not blue or brown); (3) a plain red t-shirt with a small white ROCKET motif on the chest, worn with blue jeans.";

// Theo's description — 3 defining markers spanning hair / face / clothes,
// per Adjustments 1 + 2 (eye colour replaces glasses; same broad type as
// Søren so the test is on whether the model holds two SIMILAR kids distinct).
const THEO_BASE_DESC =
  "Theo is a 7-year-old child, small and slim, pale skin with a few light freckles, a gentle small smile. Same broad type as a typical Western child his age.";
const THEO_MARKERS = "DEFINING IDENTITY MARKERS — Theo has: (1) longer STRAIGHT BLACK hair that falls to about his jawline, with a clear side part (NOT short, NOT tousled); (2) WARM BROWN EYES (clearly brown, not green or blue); (3) a navy-blue-and-white HORIZONTAL-STRIPED t-shirt worn with brown corduroy overalls.";

// Theo sheets — front-facing + three-quarter (matching the protagonist sheet
// convention; drops side profile per the 2-view budget).
const THEO_VIEWS = [
  { name: "theo-sheet-01-front", view: "front-facing portrait, neutral expression, plain cream background, whole body visible, standing neutrally" },
  { name: "theo-sheet-02-threequarter", view: "three-quarter view, slight smile, plain cream background, whole body visible, standing neutrally" },
];

console.log("STAGE B PROBE — two HUMAN children (Søren + Theo)\n" + "=".repeat(60));
let cost = 0;

// ---- 1. Mint Theo's 2 reference sheets (text-only, no refs) --------------
console.log("Minting Theo's 2 reference sheets...");
const theoSheets = [];
for (const v of THEO_VIEWS) {
  const sheetPrompt = [
    `Subject: a 7-year-old child named Theo. Reference sheet.`,
    `Appearance: ${THEO_BASE_DESC} ${THEO_MARKERS}`,
    `Style: ${STYLE}.`,
    `Composition: the whole child centered and fully visible on a plain cream background, no other characters or objects, no text. View for this image: ${v.view}.`,
    `Avoid: ${NEG}.`,
  ].join("\n");
  const buf = await generateImage(sheetPrompt);
  cost += 0.04;
  const p = path.join(OUT, `${v.name}.png`);
  fs.writeFileSync(p, buf);
  theoSheets.push(buf);
  console.log(`  → ${rel(p)}`);
  await sleep(6000);
}

// ---- 2. Load 2 Søren sheets (front-facing + three-quarter; drop side) ----
// Per CHARACTER_SHEET_PROMPTS: sheet-01 = front, sheet-02 = three-quarter,
// sheet-03 = side profile. Keep 01 + 02.
const sorenSheets = ["sheet-01.png", "sheet-02.png"]
  .map((f) => fs.readFileSync(path.join(SOREN_DIR, "character-sheets", f)));

// refs: [Søren-01, Søren-02, Theo-01, Theo-02] = 4 total (the ceiling)
const refs = [...sorenSheets, ...theoSheets];

// ---- 3. Three varied scenes -----------------------------------------------
const SCENES = [
  {
    name: "stageB-A-close-cards",
    action: "The two boys sit cross-legged on a soft bedroom rug, leaning in close together, trading picture cards from a small stack on the rug between them. Both faces are clearly visible and near each other in the frame, mid-conversation. A warm cozy bedroom in the background.",
  },
  {
    name: "stageB-B-wide-racing",
    action: "The two boys are out on the sunny garden lawn racing two small toy cars down a sloped wooden ramp. Both are crouched low on the grass, watching intently as the cars roll mid-frame. A wider outdoor scene under a clear sky.",
  },
  {
    name: "stageB-C-breakfast-count",
    action: "The two boys sit across from each other at a sunlit kitchen breakfast table eating cereal. Between them on the table there are TWO cereal bowls and TWO glasses of orange juice. Warm morning sunlight slants in through the window behind them. A cozy domestic morning scene.",
  },
];

function buildPrompt(action) {
  return [
    `Subject: two human children together in one illustration — a 6-year-old boy named Søren and a 7-year-old boy named Theo.`,
    ``,
    `Appearance — Søren: ${sorenBaseDesc} ${SOREN_MARKERS}`,
    ``,
    `Appearance — Theo: ${THEO_BASE_DESC} ${THEO_MARKERS}`,
    ``,
    `Style: ${STYLE}.`,
    `Composition: both children fully visible in the scene.`,
    `Avoid: ${NEG}.`,
    ``,
    `Reference images: the FIRST TWO reference images show Søren — match his face, hair, and clothes to those references. The THIRD and FOURTH reference images show Theo — match his face, hair, and clothes to those references.`,
  ].join("\n") + `\n\nScene: ${action}`;
}

const outputs = [];
for (let i = 0; i < SCENES.length; i++) {
  const s = SCENES[i];
  console.log(`\nRendering ${s.name} ...`);
  const t0 = Date.now();
  const buf = await generateImage(buildPrompt(s.action), refs, { aspectRatio: "4:3" });
  cost += 0.04;
  const p = path.join(OUT, `${s.name}.png`);
  fs.writeFileSync(p, buf);
  console.log(`  → ${rel(p)} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  outputs.push(p);
  if (i < SCENES.length - 1) await sleep(6000);
}

console.log("\n" + "=".repeat(60));
console.log(`Stage B probe complete. Total Gemini cost: $${cost.toFixed(2)}`);
console.log("Theo sheets:");
for (const v of THEO_VIEWS) console.log("  " + rel(path.join(OUT, v.name + ".png")));
console.log("Pages:");
for (const p of outputs) console.log("  " + rel(p));
