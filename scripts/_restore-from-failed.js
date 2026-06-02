// scripts/_restore-from-failed.js
// One-shot helper for Item 9 PART 3 (2026-06-01): reconstruct a usable
// story.json + meta.json from the Sonnet response that was wrongly rejected
// by the pre-fix validator. The Elena+Pepper smoke captured a complete,
// valid story to _failed/; rather than burn another ~$0.20 on a fresh
// story-gen, we extract it, validate against the now-fixed
// validateStoryShape, and stage it for generate-book.js.

import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateStoryShape } from "../src/anthropic.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");

const CAPTURED_FILE = path.join(
  PROJECT_ROOT,
  "output/stories/_failed/2026-06-01T04-39-35-560Z-attempt2-raw.json",
);
const TARGET_RUN_ID = "2026-06-01-elena-1500";
const TARGET_DIR = path.join(PROJECT_ROOT, "output/stories", TARGET_RUN_ID);

// The original Elena+Pepper input (preserved for meta.json so generate-book
// can drive sheet-mint + render off the same schema fields).
const ORIGINAL_INPUT = {
  child: {
    name: "Elena",
    age: 5,
    gender: "girl",
    appearance: "wavy auburn hair to her shoulders, fair skin with a sprinkle of freckles across her nose, hazel eyes, yellow rain boots, denim overalls over a white t-shirt with a small embroidered butterfly patch on the chest",
  },
  secondaries: [
    {
      id: "companion-1",
      name: "Pepper",
      age: 3,
      relationship: "pet",
      subject_type: "non_human",
      anchor: "tier1",
      appearance_markers: "a small scruffy grey-and-white mixed-breed dog, one ear that flops down and the other that stands up, red collar with a brass tag",
    },
  ],
  theme: "the day Elena and Pepper got lost in the park and found their way home",
};

console.log(`Reading captured Sonnet response:`);
console.log(`  ${path.relative(PROJECT_ROOT, CAPTURED_FILE)}`);
const captured = JSON.parse(fs.readFileSync(CAPTURED_FILE, "utf8"));

console.log(`Parsing raw_text (${captured.raw_text?.length ?? "?"} chars)...`);
const story = JSON.parse(captured.raw_text);

console.log(`Validating with the fixed validateStoryShape...`);
try {
  validateStoryShape(story, { input: ORIGINAL_INPUT });
} catch (err) {
  console.error(`  ✗ validation failed: ${err.message}`);
  console.error(`    Refusing to write a story that won't pass the validator.`);
  process.exit(1);
}
console.log(`  ✓ story passes validation under the post-Item-9-fix validator`);

// Add the brand constants the wrapper normally adds (style /
// composition_rules / negative_prompt). Sonnet doesn't emit these — they're
// merged in generateStory(). We mirror them here so the on-disk story.json
// matches the shape generate-book.js expects.
const STYLE = "soft watercolor children's book illustration, warm lighting, gentle shadows, storybook style, muted earthy palette";
const COMPOSITION_RULES = "full body, centered subject, clean uncluttered background, consistent framing, face clearly visible";
const NEGATIVE_PROMPT = "photorealistic, scary, dark, blurry, deformed hands, extra fingers, text, watermark";

const finalStory = {
  title: story.title,
  character: story.character,
  companion_characters: story.companion_characters,
  style: STYLE,
  composition_rules: COMPOSITION_RULES,
  negative_prompt: NEGATIVE_PROMPT,
  scenes: story.scenes,
  cover_concept: story.cover_concept,
  cover_subjects: story.cover_subjects,
};

const meta = {
  run_id: TARGET_RUN_ID,
  started_at: captured.captured_at,
  completed_at: captured.captured_at,
  duration_seconds: 0,
  model: captured.model,
  effort: "medium",
  thinking: "adaptive",
  inputs: ORIGINAL_INPUT,
  usage: captured.usage,
  // Item 9 PART 3 provenance: this story.json was reconstructed from a
  // pre-Item-9-validator-fix captured response, not freshly generated. The
  // raw Sonnet output is identical to what the now-fixed validator would
  // have accepted; we save story-gen $ by reusing it.
  derived_from: {
    source_file: path.basename(CAPTURED_FILE),
    captured_at: captured.captured_at,
    original_failed_run: "2026-06-01-elena-1431",
    reason: "Item 9 PART 3: pre-fix validator wrongly rejected tier-1-only response; raw text reused after fix verified.",
  },
};

console.log(`Writing target dir: ${path.relative(PROJECT_ROOT, TARGET_DIR)}/`);
fs.mkdirSync(TARGET_DIR, { recursive: true });
fs.writeFileSync(
  path.join(TARGET_DIR, "story.json"),
  JSON.stringify(finalStory, null, 2),
);
fs.writeFileSync(
  path.join(TARGET_DIR, "meta.json"),
  JSON.stringify(meta, null, 2),
);
console.log(`  ✓ story.json written (${finalStory.scenes.length} scenes)`);
console.log(`  ✓ meta.json written with derived_from provenance`);
console.log();
console.log(`Ready to invoke: node scripts/generate-book.js --story-path ${path.relative(PROJECT_ROOT, path.join(TARGET_DIR, "story.json"))} --yes`);
