// worker/src/checkpoint.js — R3a: persist + restore a job's in-progress work so a
// RESUMED run reuses completed sheets instead of re-minting from scratch.
//
// Bytes  → Supabase Storage (tuatale-books bucket, checkpoints/{jobId}/ prefix).
// Index  → pipeline_jobs.checkpoint jsonb manifest.
//
// CRITICAL: we checkpoint story.json + meta.json TOO, not just sheets. Sheet reuse
// keys on a fingerprint that includes the story's appearance prose (sheet-meta.js
// computeMarkerFingerprint); Sonnet is non-deterministic, so a resumed run must
// reuse the SAME story or every fingerprint mismatches → full re-mint (defeating
// the checkpoint). On resume we restore the story and SKIP generateStory.
//
// `deps.client` overrides the Supabase client for tests; production uses db.js getClient().
import fs from "node:fs";
import path from "node:path";
import { getClient } from "./db.js";
import { BUCKET } from "./storage.js";

const SHEETS = "character-sheets";
const prefixFor = (jobId) => `checkpoints/${jobId}`;

async function downloadBuf(sb, key) {
  const { data, error } = await sb.storage.from(BUCKET).download(key);
  if (error) throw new Error(`checkpoint download failed (${key}): ${error.message}`);
  return Buffer.from(await data.arrayBuffer());
}

/**
 * Push story + meta + completed sheets to Storage and write the manifest. Called
 * on a (potentially resumable) failure, BEFORE the scratch dir is deleted.
 */
export async function pushCheckpoint({ jobId, scratchDir, story, meta, spendDelta = 0 }, deps = {}) {
  const sb = deps.client ?? getClient();
  const prefix = prefixFor(jobId);
  const up = (key, buf, ct) => sb.storage.from(BUCKET).upload(`${prefix}/${key}`, buf, { contentType: ct, upsert: true });

  await up("story.json", Buffer.from(JSON.stringify(story)), "application/json");
  await up("meta.json", Buffer.from(JSON.stringify(meta)), "application/json");

  const sheetsDir = path.join(scratchDir, SHEETS);
  const sheetFiles = fs.existsSync(sheetsDir) ? fs.readdirSync(sheetsDir) : [];
  for (const f of sheetFiles) {
    const buf = fs.readFileSync(path.join(sheetsDir, f));
    const { error } = await up(`${SHEETS}/${f}`, buf, f.endsWith(".json") ? "application/json" : "image/png");
    if (error) throw new Error(`checkpoint sheet upload failed (${f}): ${error.message}`);
  }

  // R3b: accumulate cumulative Gemini spend across resume attempts (the $2 cap).
  const { data: prior } = await sb.from("pipeline_jobs").select("checkpoint").eq("id", jobId).maybeSingle();
  const spend = Number(((prior?.checkpoint?.spend ?? 0) + (spendDelta ?? 0)).toFixed(4));

  const manifest = { storage_prefix: prefix, sheet_files: sheetFiles, spend, checkpointed_at: new Date().toISOString() };
  const { error } = await sb.from("pipeline_jobs").update({ checkpoint: manifest }).eq("id", jobId);
  if (error) throw new Error(`checkpoint manifest write failed: ${error.message}`);
  return manifest;
}

/**
 * Restore a job's checkpoint into a fresh scratch dir. Returns { story, meta,
 * sheetFiles } when a checkpoint exists (caller skips generateStory + lets
 * generateBook's fingerprint reuse skip the restored sheets), or null otherwise.
 */
export async function restoreCheckpoint({ jobId, scratchDir }, deps = {}) {
  const sb = deps.client ?? getClient();
  const { data: job, error } = await sb.from("pipeline_jobs").select("checkpoint").eq("id", jobId).maybeSingle();
  if (error) throw new Error(`checkpoint read failed: ${error.message}`);
  const m = job?.checkpoint;
  if (!m?.storage_prefix) return null;

  const story = JSON.parse((await downloadBuf(sb, `${m.storage_prefix}/story.json`)).toString());
  const meta = JSON.parse((await downloadBuf(sb, `${m.storage_prefix}/meta.json`)).toString());

  const sheetsDir = path.join(scratchDir, SHEETS);
  fs.mkdirSync(sheetsDir, { recursive: true });
  for (const f of m.sheet_files ?? []) {
    fs.writeFileSync(path.join(sheetsDir, f), await downloadBuf(sb, `${m.storage_prefix}/${SHEETS}/${f}`));
  }
  return { story, meta, sheetFiles: m.sheet_files ?? [] };
}

/** Drop a job's checkpoint (Storage objects + manifest) — called on success or terminal failure. */
export async function clearCheckpoint({ jobId }, deps = {}) {
  const sb = deps.client ?? getClient();
  const { data: job } = await sb.from("pipeline_jobs").select("checkpoint").eq("id", jobId).maybeSingle();
  const m = job?.checkpoint;
  if (m?.storage_prefix) {
    const keys = [
      `${m.storage_prefix}/story.json`,
      `${m.storage_prefix}/meta.json`,
      ...(m.sheet_files ?? []).map((f) => `${m.storage_prefix}/${SHEETS}/${f}`),
    ];
    try { await sb.storage.from(BUCKET).remove(keys); } catch { /* best-effort */ }
  }
  await sb.from("pipeline_jobs").update({ checkpoint: null }).eq("id", jobId);
}
