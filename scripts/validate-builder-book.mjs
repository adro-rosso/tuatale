// scripts/validate-builder-book.mjs
// Pre-build validation gen (~$0.72 + cover, PAID). Generates ONE full
// watercolour book from a BUILDER-ONLY structured input (structured-complete
// features, NO free-text appearance), with FEATURES_COMPOSE=on +
// FEATURES_FRONTMATTER=on, on the CURRENT main code (Stage A/C + B.1).
//
// Validates: (1) composed features actually drive the character (the input uses
// distinctive, checkable features — red braids, deep-brown skin, green eyes,
// glasses, purple tee — so it's obvious whether they reached the art), and
// (2) the full assembled book reads right (front matter + A/C typography,
// em-dash sanitizer). Runs LOCALLY (never the prod worker — verify-spike rule).
//
// On API drag / credit depletion the underlying error propagates → we log + exit.

process.env.FEATURES_COMPOSE = "on";
process.env.FEATURES_FRONTMATTER = "on";

import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateStory } from "../src/anthropic.js";
import { generateBook } from "../src/book-pipeline.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const OUT = path.join(ROOT, "output", "_validation", "builder-book");
const rel = (p) => path.relative(ROOT, p).replace(/\\/g, "/");

// BUILDER-ONLY structured input: the 4 structured-complete axes + glasses/build/
// outfit, and DELIBERATELY no free-text appearance — so the only way the art can
// match is if the composed features drove it (FEATURES_COMPOSE=on).
const input = {
  child: {
    name: "Maya",
    age: 6,
    gender: "girl",
    features: {
      hair_colour: "red",
      hair_style: "braids",
      skin_tone: "deep-brown",
      eye_colour: "green",
      glasses: "yes",
      build: "average",
      outfit: { tee: "purple", shorts: "denim-blue", shoes: "white-sneakers" },
    },
    // appearance intentionally OMITTED (builder-only path)
  },
  theme: "spending a sunny afternoon exploring the backyard vegetable garden",
  style: "watercolour",
  secondaries: [],
  ageRange: "5-7",
};

async function main() {
  console.log(`\n${"=".repeat(72)}`);
  console.log(`Builder-book validation gen (PAID ~$0.72+cover) — FEATURES_COMPOSE=on, FEATURES_FRONTMATTER=on`);
  console.log(`builder-only input: ${input.child.name}, ${input.child.gender}, age ${input.child.age}`);
  console.log(`features: ${JSON.stringify(input.child.features)}`);
  console.log(`${"=".repeat(72)}\n`);

  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });

  console.log("→ generateStory (Sonnet)…");
  const { story, usage } = await generateStory(input);
  console.log(`  title: "${story.title}"`);
  console.log(`  COMPOSED CHARACTER PROSE (should reflect red braids / deep-brown skin / green eyes / glasses):`);
  console.log(`  ${JSON.stringify(story.character)}\n`);
  fs.writeFileSync(path.join(OUT, "story.json"), JSON.stringify(story, null, 2));

  const meta = {
    inputs: { child: input.child, secondaries: input.secondaries, theme: input.theme, ageRange: input.ageRange },
    story: { title: story.title },
    generatedAt: new Date().toISOString(),
    usage,
  };
  fs.writeFileSync(path.join(OUT, "meta.json"), JSON.stringify(meta, null, 2));

  console.log("→ generateBook (sheets + 12 pages + front-matter assembly + merge)…");
  const result = await generateBook({
    story, meta,
    childName: input.child.name, childAge: input.child.age,
    outputDir: OUT,
  });

  console.log(`\n${"=".repeat(72)}`);
  console.log(`pages: ${JSON.stringify(result.summary?.pages ?? result.counts)}`);
  console.log(`total Gemini cost: ~$${(result.totalCost ?? 0).toFixed(2)}`);
  console.log(`book.pdf: ${rel(path.join(OUT, "book.pdf"))}`);
  console.log(`cover hero: ${rel(path.join(OUT, "front-matter", "cover-hero.png"))}`);
  console.log(`${"=".repeat(72)}\n`);
}

main().catch((e) => {
  console.error(`\nVALIDATION GEN STOPPED — ${e?.message ?? e}`);
  console.error(`(If RESOURCE_EXHAUSTED / timeout, that's API drag/credits — not a code bug. STOP + flag.)`);
  process.exit(1);
});
