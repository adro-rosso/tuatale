// worker/tests/checkpoint.test.js — R3a checkpoint/restore + the zero-re-mint proof.
// $0: in-memory fake Supabase client (no network), + the real sheet-meta resolver.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { pushCheckpoint, restoreCheckpoint, clearCheckpoint } from "../src/checkpoint.js";
import {
  computeMarkerFingerprint, writeSheetMeta, buildSheetMeta, resolveSheetState, SheetState,
} from "../../src/sheet-meta.js";

// Minimal in-memory stand-in for the Supabase client surface checkpoint.js uses.
function fakeClient() {
  const store = new Map(); // storage key -> Buffer
  let job = { checkpoint: null };
  return {
    storage: {
      from: () => ({
        upload: async (key, buf) => { store.set(key, Buffer.isBuffer(buf) ? buf : Buffer.from(buf)); return { error: null }; },
        download: async (key) => store.has(key)
          ? { data: { arrayBuffer: async () => store.get(key) }, error: null }
          : { data: null, error: { message: "not found" } },
        remove: async (keys) => { for (const k of keys) store.delete(k); return { error: null }; },
      }),
    },
    from: () => ({
      update: (patch) => ({ eq: async () => { job = { ...job, ...patch }; return { error: null }; } }),
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: job, error: null }) }) }),
    }),
    _store: store,
    _job: () => job,
  };
}

let srcDir, dstDir;
beforeEach(() => {
  srcDir = path.join(os.tmpdir(), `ckpt-src-${crypto.randomUUID()}`);
  dstDir = path.join(os.tmpdir(), `ckpt-dst-${crypto.randomUUID()}`);
  fs.mkdirSync(path.join(srcDir, "character-sheets"), { recursive: true });
});
afterEach(() => {
  for (const d of [srcDir, dstDir]) fs.rmSync(d, { recursive: true, force: true });
});

describe("checkpoint push → restore → clear (R3a)", () => {
  it("round-trips story + meta + sheets and clears", async () => {
    const sheets = path.join(srcDir, "character-sheets");
    fs.writeFileSync(path.join(sheets, "sheet-01.png"), Buffer.from("png-1"));
    fs.writeFileSync(path.join(sheets, "sheet-02.png"), Buffer.from("png-2"));
    fs.writeFileSync(path.join(sheets, "protagonist-meta.json"), JSON.stringify({ marker_fingerprint: "fp" }));
    const client = fakeClient();
    const story = { title: "Leo's Treehouse", character: "a boy" };
    const meta = { inputs: { child: { name: "Leo" } }, usage: { input_tokens: 1 } };

    const manifest = await pushCheckpoint({ jobId: "j1", scratchDir: srcDir, story, meta }, { client });
    expect(manifest.sheet_files.sort()).toEqual(["protagonist-meta.json", "sheet-01.png", "sheet-02.png"]);
    expect(client._job().checkpoint.storage_prefix).toBe("checkpoints/j1");

    const restored = await restoreCheckpoint({ jobId: "j1", scratchDir: dstDir }, { client });
    expect(restored.story).toEqual(story);
    expect(restored.meta).toEqual(meta);
    expect(fs.readFileSync(path.join(dstDir, "character-sheets", "sheet-01.png")).toString()).toBe("png-1");
    expect(fs.existsSync(path.join(dstDir, "character-sheets", "protagonist-meta.json"))).toBe(true);

    await clearCheckpoint({ jobId: "j1" }, { client });
    expect(client._job().checkpoint).toBeNull();
    expect(client._store.size).toBe(0);
  });

  it("restore returns null when no checkpoint manifest exists", async () => {
    const client = fakeClient(); // job.checkpoint = null
    expect(await restoreCheckpoint({ jobId: "none", scratchDir: dstDir }, { client })).toBeNull();
  });
});

describe("restored sheets + same story → ZERO re-mint (FULL_SKIP)", () => {
  it("resolveSheetState returns FULL_SKIP for restored sheets whose fingerprint matches the (restored) story", () => {
    const sheets = path.join(srcDir, "character-sheets");
    const subj = { subjectName: "Leo", subjectType: "human", gender: "boy", appearanceDescription: "a boy with a red rocket tee", markers: "" };
    const fp = computeMarkerFingerprint(subj);
    // Restored full sheet set (what restoreCheckpoint writes back) + matching meta.
    for (const n of ["01", "02", "03"]) fs.writeFileSync(path.join(sheets, `sheet-${n}.png`), Buffer.from(`view-${n}`));
    writeSheetMeta(sheets, "protagonist", buildSheetMeta({
      ...subj, fingerprint: fp, sheetPathPrefix: "sheet",
      presentViews: [{ view_index: 1, filename: "sheet-01.png" }], mintedForBook: "t",
    }));

    const r = resolveSheetState({
      subjectId: "protagonist", sheetPathPrefix: "sheet", expectedViewCount: 3,
      currentFingerprint: fp, sheetsDir: sheets,
    });
    // FULL_SKIP → generateBook's mint loop skips all 3 views → zero mint calls.
    expect(r.state).toBe(SheetState.FULL_SKIP);
    expect(r.missingViewIndices).toEqual([]);
    expect(r.fingerprintMatch).toBe(true);
  });

  it("a DIFFERENT story (new fingerprint) → MISMATCH_REMINT (would re-mint) — why story must be checkpointed", () => {
    const sheets = path.join(srcDir, "character-sheets");
    const subj = { subjectName: "Leo", subjectType: "human", gender: "boy", appearanceDescription: "a boy with a red rocket tee", markers: "" };
    for (const n of ["01", "02", "03"]) fs.writeFileSync(path.join(sheets, `sheet-${n}.png`), Buffer.from(`view-${n}`));
    writeSheetMeta(sheets, "protagonist", buildSheetMeta({
      ...subj, fingerprint: computeMarkerFingerprint(subj), sheetPathPrefix: "sheet",
      presentViews: [], mintedForBook: "t",
    }));
    const differentStoryFp = computeMarkerFingerprint({ ...subj, appearanceDescription: "a boy with a blue striped shirt" });
    const r = resolveSheetState({
      subjectId: "protagonist", sheetPathPrefix: "sheet", expectedViewCount: 3,
      currentFingerprint: differentStoryFp, sheetsDir: sheets,
    });
    expect(r.state).toBe(SheetState.MISMATCH_REMINT);
  });
});
