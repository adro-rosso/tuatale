// scripts/probe-antennae-lever.mjs
// LEVER TEST (~$0.04, one render): does emphasizing a fine high-frequency
// detail in the per-page prompt pull it back on-model? Bolt's curled-wire
// antennae drifted STRAIGHT on probe-C (mid-reading) while everything else
// held. Reuse the SAME Bolt sheet + Søren sheets + same scene; the ONLY
// change is making the antennae salient/defining in the Bolt description.
// Throwaway; nothing wired in.

import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateImage } from "../src/gemini.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const OUT = path.join(ROOT, "templates", "_multisubject-probe");
const rel = (p) => path.relative(ROOT, p).replace(/\\/g, "/");

const SOREN_DIR = path.join(ROOT, "output", "books", "2026-05-25-s-ren-1354");
const story = JSON.parse(fs.readFileSync(path.join(SOREN_DIR, "story.json"), "utf8"));
const STYLE = story.style;
const NEG = story.negative_prompt;

function maskName(text, name) {
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return text.replace(new RegExp(`\\b${esc}(?:'s)?\\b`, "g"), "").replace(/\s+/g, " ").trim();
}
const sorenDesc = maskName(story.character, "Søren");

// Bolt design — IDENTICAL to the probe EXCEPT the antennae clause is now
// salient/defining (was: "two bent-wire antennae topped with small red beads").
const BOLT_DESIGN_EMPHASIZED =
  "Bolt is a child's handmade toy robot built from craft junk: a square silver-grey cereal-box body with a single yellow five-pointed star painted on its chest; a smaller cube head; two round bottle-cap eyes that glow soft amber; a short triangular tin-can nose; cylindrical tin-can arms with simple flat pincer hands; stubby boxy legs. DEFINING FEATURE — Bolt's antennae: two springy hand-bent wire antennae rising from the top of his head, EACH WITH A DISTINCT CURL OR LOOP partway up, topped with a small red bead. The antennae are always CURLED/LOOPED wire, never straight — this curl is a signature part of Bolt's look. He is lovingly handmade, a little wobbly, and friendly.";

// Reuse the EXISTING Bolt sheet + Søren's 3 sheets (no re-mint).
const boltBuf = fs.readFileSync(path.join(OUT, "bolt-sheet.png"));
const sorenSheets = ["sheet-01.png", "sheet-02.png", "sheet-03.png"]
  .map((f) => fs.readFileSync(path.join(SOREN_DIR, "character-sheets", f)));
const refs = [...sorenSheets, boltBuf];

// Same scene-C action as the probe.
const ACTION = "The boy sits cross-legged on a rug reading a picture book aloud, while Bolt leans over his shoulder to peer at the open pages. A cozy mid-distance indoor scene.";

const prompt = [
  `Subject: a 6-year-old human child together with his handmade toy robot, Bolt. TWO distinct subjects in one illustration.`,
  `Appearance — the child: ${sorenDesc}.`,
  `Appearance — Bolt the robot: ${BOLT_DESIGN_EMPHASIZED}`,
  `Style: ${STYLE}.`,
  `Composition: both subjects clearly visible as two SEPARATE characters; do not merge them into one figure.`,
  `Avoid: ${NEG}.`,
  `Reference images: the FIRST THREE reference images show the CHILD — match his face, hair, and clothes. The FOURTH reference image shows BOLT the robot — match his construction and design exactly, INCLUDING his curled/looped wire antennae. Keep the child fully human and Bolt fully mechanical; do NOT bleed robot texture onto the child or skin onto the robot.`,
].join("\n") + `\n\nScene: ${ACTION}`;

console.log("Antennae lever test — re-rendering mid-reading scene with emphasized antennae...");
const buf = await generateImage(prompt, refs, { aspectRatio: "4:3" });
const outPath = path.join(OUT, "probe-C-mid-reading-antennae-emphasized.png");
fs.writeFileSync(outPath, buf);
console.log(`  → ${rel(outPath)}`);
console.log("Cost: $0.04");
