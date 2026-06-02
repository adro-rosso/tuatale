// scripts/probe-multisubject.mjs
// PROBE (throwaway, not a feature): does minting a reference sheet for a
// NON-PROTAGONIST subject (Bolt the robot) hold it on-model across varied
// scenes, the way the protagonist's sheets hold the protagonist — and does
// adding it cost the protagonist's fidelity?
//
// Mechanism: 3 Søren sheets + 1 freshly-minted Bolt sheet = 4 refs (the max).
// A manual multi-subject prompt distinguishes "refs 1-3 = child, ref 4 =
// robot". 3 varied scenes. Raw Gemini images (no template crop). NOT wired
// into the main pipeline.

import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateImage } from "../src/gemini.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const OUT = path.join(ROOT, "templates", "_multisubject-probe");
fs.mkdirSync(OUT, { recursive: true });

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
const sorenDesc = maskName(story.character, "Søren");

// Fixed, specific Bolt design — the consistency target.
const BOLT_DESIGN =
  "Bolt is a child's handmade toy robot built from craft junk: a square silver-grey cereal-box body with a single yellow five-pointed star painted on its chest; a smaller cube head; two round bottle-cap eyes that glow soft amber; a short triangular tin-can nose; two bent-wire antennae topped with small red beads; cylindrical tin-can arms with simple flat pincer hands; stubby boxy legs. He looks lovingly handmade, a little wobbly, and friendly.";

// ---- 1. Mint Bolt's reference sheet (text-only, like a protagonist sheet) --
const boltSheetPrompt = [
  `Subject: a child's handmade toy robot named Bolt. Reference sheet, single front-facing full-body view, neutral standing pose.`,
  `Appearance: ${BOLT_DESIGN}`,
  `Style: ${STYLE}.`,
  `Composition: the whole robot centered and fully visible on a plain cream background, no other objects, no child, no text.`,
  `Avoid: ${NEG}.`,
].join("\n");

console.log("PROBE — multi-subject (Søren + Bolt)\n" + "=".repeat(60));
let cost = 0;
console.log("Minting Bolt reference sheet...");
const boltBuf = await generateImage(boltSheetPrompt);
cost += 0.04;
const boltSheetPath = path.join(OUT, "bolt-sheet.png");
fs.writeFileSync(boltSheetPath, boltBuf);
console.log(`  → ${rel(boltSheetPath)}`);

// ---- 2. Load Søren's 3 sheets + Bolt's sheet (= 4 refs, the max) ----------
const sorenSheets = ["sheet-01.png", "sheet-02.png", "sheet-03.png"]
  .map((f) => fs.readFileSync(path.join(SOREN_DIR, "character-sheets", f)));
const refs = [...sorenSheets, boltBuf]; // refs[0..2]=Søren, refs[3]=Bolt

// ---- 3. Three varied scenes with BOTH subjects ---------------------------
const SCENES = [
  { name: "probe-A-close-fixing", action: "The boy kneels on his bedroom floor, leaning in close to tighten a small screw on Bolt's tin-can arm with a toy screwdriver. Bolt stands patiently beside him. A close, tender working moment — both faces visible." },
  { name: "probe-B-wide-walking", action: "The boy and Bolt walk side by side through a sunny green meadow under a wide sky, the boy pointing ahead with a grin while Bolt waddles along beside him. A wide, cheerful outdoor scene." },
  { name: "probe-C-mid-reading", action: "The boy sits cross-legged on a rug reading a picture book aloud, while Bolt leans over his shoulder to peer at the open pages. A cozy mid-distance indoor scene." },
];

function buildPrompt(action) {
  return [
    `Subject: a 6-year-old human child together with his handmade toy robot, Bolt. TWO distinct subjects in one illustration.`,
    `Appearance — the child: ${sorenDesc}.`,
    `Appearance — Bolt the robot: ${BOLT_DESIGN}`,
    `Style: ${STYLE}.`,
    `Composition: both subjects clearly visible as two SEPARATE characters; do not merge them into one figure.`,
    `Avoid: ${NEG}.`,
    `Reference images: the FIRST THREE reference images show the CHILD — match his face, hair, and clothes. The FOURTH reference image shows BOLT the robot — match his construction and design exactly. Keep the child fully human and Bolt fully mechanical; do NOT bleed robot metal/cardboard texture onto the child, or skin onto the robot.`,
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
console.log(`Probe complete. Total Gemini cost: $${cost.toFixed(2)}`);
console.log("Bolt sheet:  " + rel(boltSheetPath));
for (const p of outputs) console.log("Page:        " + rel(p));
