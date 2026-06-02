// src/index.js
// Entry point for the spike. Run with:  node src/index.js  (or: npm start)
//
// Two responsibilities only:
//   1. Load environment variables from .env (so GEMINI_API_KEY is available).
//   2. Kick off the pipeline and report total elapsed time.
//
// All real work lives in src/pipeline.js — this file is just glue.

import "dotenv/config"; // MUST come first; populates process.env before
                        // src/pipeline.js → src/gemini.js reads GEMINI_API_KEY.
import { runPipeline } from "./pipeline.js";

const start = Date.now();
try {
  await runPipeline();
  const elapsedSec = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`\nTotal elapsed: ${elapsedSec}s.`);
} catch (err) {
  console.error("\nPipeline failed:");
  console.error(err);
  process.exit(1);
}
