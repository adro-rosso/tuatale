// scripts/regen-image-template-aware.js
// Template-aware image regen for Mateo's page 9, with prompt variations
// driven by a VARIATIONS map. Used to A/B prompt strategies for the
// prompt-2-iter-2 spike (see SESSION_NOTES "Pivot — Template architecture"
// and "Template architecture finding").
//
// Usage:
//   node scripts/regen-image-template-aware.js --variation <name>
//
// Output:
//   templates/prompt-2-iter-2/test-image-page-09-<variation>.png
//
// Cost: ~$0.04 USD per invocation (1 Gemini call).
// One-off spike script; hardcoded book / scene / character / age.

import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateImage, MODEL as GEMINI_MODEL } from "../src/gemini.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, "..");

// ---- Hardcoded targets -----------------------------------------------------
const BOOK_DIR = path.join(PROJECT_ROOT, "output", "books", "2026-05-17-mateo-0002");
const STORY_PATH = path.join(BOOK_DIR, "story.json");
const SHEETS_DIR = path.join(BOOK_DIR, "character-sheets");
const SHEET_FILENAMES = ["sheet-01.png", "sheet-02.png", "sheet-03.png"];
const SCENE_PAGE = 9;
const NAME = "Mateo";
const AGE = 6;
// OUTPUT_DIR is derived from variation.template_dir after CLI parse — each
// variation declares its own target template directory. See VARIATIONS map.

// ---- VARIATIONS map --------------------------------------------------------
// Each entry defines one prompt experiment. v1 is the validated baseline
// from Stage 1. v2/v3/v4 build on v1 with composition or style overrides.
const V1_BASE_TEMPLATE_COMPOSITION =
  "protagonist and main action positioned in the RIGHT 55% of the frame. " +
  "The left 40% of the frame should be open sky, distant landscape, or " +
  "atmospheric background — the kind of scene a watercolor painter would " +
  "paint to give the page room to breathe. Compose with text-overlay space " +
  "in mind.";

const VARIATIONS = {
  v1: {
    label: "baseline (validated)",
    template_dir: "prompt-2-iter-2",
    template_composition: V1_BASE_TEMPLATE_COMPOSITION,
    style_override: null,
  },
  v2_painted_edges: {
    label: "explicit painted edges",
    template_dir: "prompt-2-iter-2",
    template_composition:
      V1_BASE_TEMPLATE_COMPOSITION +
      " ALSO: the LEFT edge of the illustration should fade into the page " +
      "like watercolor wash absorbing into paper — irregular, organic, with " +
      "wet-edge bleeding rather than a clean rectangular boundary. The " +
      "painting should feel like it's spreading across the page, not pasted " +
      "onto it.",
    style_override: null,
  },
  v3_smaller_subject: {
    label: "smaller protagonist, more spread",
    template_dir: "prompt-2-iter-2",
    template_composition:
      V1_BASE_TEMPLATE_COMPOSITION +
      " ALSO: the protagonist is small in the frame — show the protagonist " +
      "at MEDIUM-DISTANCE, occupying perhaps 30-40% of the image height, " +
      "with the landscape and atmospheric space dominating. This is a wide " +
      "spread, not a portrait. The eye should take in the world first, then " +
      "find the protagonist within it.",
    style_override: null,
  },
  v4_painter_vocab: {
    label: "art-historical painter vocabulary",
    template_dir: "prompt-2-iter-2",
    template_composition: V1_BASE_TEMPLATE_COMPOSITION,
    style_override:
      "watercolor on cold-press paper, wet-on-wet wash technique, visible " +
      "pigment granulation, organic uneven boundaries where wash absorbs " +
      "into paper fiber. Loose, painterly, with intentional white space and " +
      "atmospheric bleeding. Inspired by contemporary picture book " +
      "illustration in the style of Sophie Blackall. Warm earthy palette.",
  },
  v5a_untouched_paper: {
    label: "stronger cream clearing — untouched paper language",
    template_dir: "prompt-3-iter-2",
    template_composition:
      "The image fills a 1408×768 landscape frame. The composition will be " +
      "cropped at render to a 1.29:1 aspect ratio (cropping ~15% from each " +
      "horizontal edge), so all critical framing elements MUST be " +
      "positioned within the CENTRAL 70% of the source image width to " +
      "survive the crop. " +
      "The upper 65% of the frame is the painted scene (the main " +
      "illustration). " +
      "BELOW the painted scene, in the lower 30% of the frame, there is a " +
      "rectangular zone of UNTOUCHED CREAM PAPER — completely blank, no " +
      "paint, no wash, no texture, no scene content, no ground, no hills, " +
      "no terrain. This blank cream zone measures approximately 60% of " +
      "frame width × 25% of frame height, centered horizontally at the " +
      "bottom of the frame. " +
      "FRAMING THE CREAM ZONE on three sides (left, right, bottom): tall " +
      "grasses with seedheads along the left and right edges of the " +
      "clearing, autumn leaves and small sprigs at the bottom corners, " +
      "watercolor splatter scattered around the clearing edges. These " +
      "framing elements are painted decorations on the cream paper itself, " +
      "sitting at the edges of the blank zone. " +
      "CRITICAL: do NOT extend the landscape, hills, ground, or any " +
      "painted scene content into the cream zone. The cream zone is bare " +
      "paper. The painted scene above has a defined lower boundary; below " +
      "that boundary the paper is untouched except for the decorative " +
      "framing elements at the edges. " +
      "Watercolor wash with visible pigment granulation in the scene area. " +
      "NO hard rectangular edges anywhere — the upper scene bleeds " +
      "organically to the page on the top, left, and right sides.",
    style_override:
      "watercolor on cold-press paper, wet-on-wet wash technique, visible " +
      "pigment granulation, organic uneven boundaries where wash absorbs " +
      "into paper fiber. Loose, painterly, with intentional white space and " +
      "atmospheric bleeding. Inspired by contemporary picture book " +
      "illustration in the style of Sophie Blackall. Warm earthy palette.",
  },
  v5b_smaller_scene: {
    label: "v5a with smaller scene (55%) and bigger clearing band (40%)",
    template_dir: "prompt-3-iter-2",
    template_composition:
      "The image fills a 1408×768 landscape frame. The composition will be " +
      "cropped at render to a 1.29:1 aspect ratio (cropping ~15% from each " +
      "horizontal edge), so all critical framing elements MUST be " +
      "positioned within the CENTRAL 70% of the source image width to " +
      "survive the crop. " +
      "The upper 55% of the frame is the painted scene (the main " +
      "illustration). " +
      "BELOW the painted scene, in the lower 40% of the frame, there is a " +
      "rectangular zone of UNTOUCHED CREAM PAPER — completely blank, no " +
      "paint, no wash, no texture, no scene content, no ground, no hills, " +
      "no terrain. This blank cream zone measures approximately 60% of " +
      "frame width × 25% of frame height, centered horizontally at the " +
      "bottom of the frame. " +
      "FRAMING THE CREAM ZONE on three sides (left, right, bottom): tall " +
      "grasses with seedheads along the left and right edges of the " +
      "clearing, autumn leaves and small sprigs at the bottom corners, " +
      "watercolor splatter scattered around the clearing edges. These " +
      "framing elements are painted decorations on the cream paper itself, " +
      "sitting at the edges of the blank zone. " +
      "CRITICAL: do NOT extend the landscape, hills, ground, or any " +
      "painted scene content into the cream zone. The cream zone is bare " +
      "paper. The painted scene above has a defined lower boundary; below " +
      "that boundary the paper is untouched except for the decorative " +
      "framing elements at the edges. " +
      "Watercolor wash with visible pigment granulation in the scene area. " +
      "NO hard rectangular edges anywhere — the upper scene bleeds " +
      "organically to the page on the top, left, and right sides.",
    style_override:
      "watercolor on cold-press paper, wet-on-wet wash technique, visible " +
      "pigment granulation, organic uneven boundaries where wash absorbs " +
      "into paper fiber. Loose, painterly, with intentional white space and " +
      "atmospheric bleeding. Inspired by contemporary picture book " +
      "illustration in the style of Sophie Blackall. Warm earthy palette.",
  },
  v5c_book_margin: {
    label: "v5b geometry + published-picture-book metaphor",
    template_dir: "prompt-3-iter-2",
    template_composition:
      "The image fills a 1408×768 landscape frame. The composition will be " +
      "cropped at render to a 1.29:1 aspect ratio (cropping ~15% from each " +
      "horizontal edge), so all critical framing elements MUST be " +
      "positioned within the CENTRAL 70% of the source image width to " +
      "survive the crop. " +
      "The upper 55% of the frame is the painted scene (the main " +
      "illustration). " +
      "BELOW the painted scene, in the lower 40% of the frame: this is " +
      "composed like a real published picture book page where text sits on " +
      "the paper margin below an illustration. The cream zone is the page " +
      "margin, untouched and outside the painted area. The painted scene " +
      "has a defined lower boundary, and below that boundary is bare " +
      "paper. The blank cream zone measures approximately 60% of frame " +
      "width × 25% of frame height, centered horizontally at the bottom " +
      "of the frame. " +
      "FRAMING THE CREAM ZONE on three sides (left, right, bottom): tall " +
      "grasses with seedheads along the left and right edges of the " +
      "clearing, autumn leaves and small sprigs at the bottom corners, " +
      "watercolor splatter scattered around the clearing edges. These " +
      "framing elements are painted decorations on the cream paper itself, " +
      "sitting at the edges of the blank zone. " +
      "CRITICAL: do NOT extend the landscape, hills, ground, or any " +
      "painted scene content into the cream zone. " +
      "Watercolor wash with visible pigment granulation in the scene area. " +
      "NO hard rectangular edges anywhere — the upper scene bleeds " +
      "organically to the page on the top, left, and right sides.",
    style_override:
      "watercolor on cold-press paper, wet-on-wet wash technique, visible " +
      "pigment granulation, organic uneven boundaries where wash absorbs " +
      "into paper fiber. Loose, painterly, with intentional white space and " +
      "atmospheric bleeding. Inspired by contemporary picture book " +
      "illustration in the style of Sophie Blackall. Warm earthy palette.",
  },
};

// ---- Brand-override for this template --------------------------------------
// story.composition_rules says "full body, centered subject, clean
// uncluttered background, consistent framing, face clearly visible." The
// "centered subject" rule directly conflicts with the template-aware
// guidance (right-55% protagonist placement), so it's dropped here. In
// production, each template will need a way to override brand constants
// per-template — this hardcoded override is the spike's stand-in for that
// mechanism.
const CUSTOM_COMPOSITION_RULES =
  "full body, clean uncluttered background, consistent framing, face clearly visible.";

// ---- Helpers ---------------------------------------------------------------
function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) {
      throw new Error(`Unexpected positional argument: ${a}.`);
    }
    const eqIdx = a.indexOf("=");
    if (eqIdx >= 0) {
      args[a.slice(2, eqIdx)] = a.slice(eqIdx + 1);
    } else {
      const k = a.slice(2);
      const v = argv[i + 1];
      if (v === undefined || v.startsWith("--")) {
        throw new Error(`Missing value for --${k}`);
      }
      args[k] = v;
      i++;
    }
  }
  return args;
}

function maskName(text, name) {
  const tokens = name.trim().split(/\s+/);
  let result = text;
  for (const token of tokens) {
    const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(`\\b${escaped}(?:'s)?\\b`, "g");
    result = result.replace(pattern, "");
  }
  result = result.replace(/\s+/g, " ").trim();
  if (result.startsWith("is a ")) result = "A " + result.slice(5);
  else if (result.startsWith("is an ")) result = "An " + result.slice(6);
  return result;
}

function replaceName(text, name, replacement = "the child") {
  const tokens = name.trim().split(/\s+/);
  let result = text;
  for (const token of tokens) {
    const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    result = result.replace(new RegExp(`\\b${escaped}\\b`, "g"), replacement);
  }
  return result.replace(/\s+/g, " ").trim();
}

function displayPath(p) {
  return path.relative(PROJECT_ROOT, p).replace(/\\/g, "/");
}

// ---- Parse --variation flag ------------------------------------------------
let cliArgs;
try {
  cliArgs = parseArgs(process.argv.slice(2));
} catch (err) {
  console.error(`FAIL: ${err.message}`);
  process.exit(1);
}

const variationName = cliArgs.variation;
if (!variationName) {
  console.error(
    `FAIL: --variation required. Valid: ${Object.keys(VARIATIONS).join(", ")}`
  );
  process.exit(1);
}
const variation = VARIATIONS[variationName];
if (!variation) {
  console.error(
    `FAIL: unknown --variation "${variationName}". ` +
    `Valid: ${Object.keys(VARIATIONS).join(", ")}`
  );
  process.exit(1);
}

if (!variation.template_dir) {
  console.error(`FAIL: variation "${variationName}" missing template_dir field`);
  process.exit(1);
}
const OUTPUT_DIR = path.join(PROJECT_ROOT, "templates", variation.template_dir);
const OUTPUT_PATH = path.join(OUTPUT_DIR, `test-image-page-09-${variationName}.png`);

// ---- Load story + character sheets -----------------------------------------
const story = JSON.parse(fs.readFileSync(STORY_PATH, "utf8"));
const scene = story.scenes.find((s) => s.page === SCENE_PAGE);
if (!scene) {
  console.error(`FAIL: scene page ${SCENE_PAGE} not found in story.json`);
  process.exit(1);
}

const sheetBuffers = SHEET_FILENAMES.map((fn) => {
  const p = path.join(SHEETS_DIR, fn);
  if (!fs.existsSync(p)) {
    console.error(`FAIL: character sheet missing: ${displayPath(p)}`);
    process.exit(1);
  }
  return fs.readFileSync(p);
});

// ---- Resolve variation-driven prompt pieces --------------------------------
const styleLine = variation.style_override || story.style;
const templateComposition = variation.template_composition;

// ---- Build the prompt ------------------------------------------------------
const appearance = maskName(story.character, NAME);
const actionMasked = replaceName(scene.action, NAME);
const basePrompt = [
  `Subject: a ${AGE}-year-old child.`,
  `Appearance: ${appearance}.`,
  `Style: ${styleLine}.`,
  `Composition: ${CUSTOM_COMPOSITION_RULES}`,
  `Template composition: ${templateComposition}`,
  `Avoid: ${story.negative_prompt}.`,
].join("\n");
const fullPrompt =
  `${basePrompt}\n\n` +
  `Scene: ${actionMasked}\n\n` +
  `Use the provided reference images of the character to keep their appearance, clothing, and proportions consistent.`;

// ---- Surface the plan ------------------------------------------------------
console.log();
console.log("=".repeat(70));
console.log(`Template-aware image regen — Mateo page 9 [${variationName}]`);
console.log(`  Variation:     ${variation.label}`);
console.log("=".repeat(70));
console.log(`  Model:         ${GEMINI_MODEL}`);
console.log(`  References:    ${SHEET_FILENAMES.length} character sheets`);
console.log(`  Estimated:     ~$0.04 USD (1 Gemini call)`);
console.log(`  Output:        ${displayPath(OUTPUT_PATH)}`);
console.log();
console.log("Prompt being sent to Gemini:");
console.log("-".repeat(70));
console.log(fullPrompt);
console.log("-".repeat(70));
console.log();

// ---- Generate ---------------------------------------------------------------
const t0 = Date.now();
let buf;
try {
  buf = await generateImage(fullPrompt, sheetBuffers);
} catch (err) {
  console.error(`FAIL: Gemini call failed: ${err?.message ?? err}`);
  process.exit(1);
}
const ms = Date.now() - t0;

fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
fs.writeFileSync(OUTPUT_PATH, buf);

console.log(`OK image saved to ${displayPath(OUTPUT_PATH)}  (${(ms / 1000).toFixed(1)}s, ${(buf.length / 1024).toFixed(1)} KB)`);
console.log();
