// tools/review-station/server.js — local operator app for reviewing a generated
// book page-by-page: re-roll the IMAGE, re-lay/rewrite the TEXT, and keep the
// better roll via per-page history. Tiny local HTTP server (Node built-in
// `http` — no Express, no install) + one static HTML page. Runs entirely against
// local src/ — no worker deploy needed.
//
// Actions per page:
//   • Approve / Un-approve                    (review-state.json status)
//   • Re-render IMAGE  (~$0.04)               shells generate-book.js --only-pages N
//   • Edit text        ($0)                   save narrative → --only-pages N --text-only
//   • Regenerate text  (~1¢ Sonnet + $0 relay) rewriteNarrative() → save → --text-only
//   • Restore a prior roll ($0)               swap history artifacts + narrative back
//   • Finalize ($0)                           stitch approved pages (+ front matter) → book.pdf
//
// Every re-render (image OR text) first SNAPSHOTS the page's current artifacts
// (page-NN.pdf + page-NN-rendered.png + narrative) into _history/page-NN/<id>/,
// capped at HISTORY_CAP per page, so any prior roll can be restored.
//
// Launch:  node tools/review-station/server.js --dir output/books/<id> [--port 4600]
// See tools/review-station/README.md.

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { PDFDocument } from "pdf-lib";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
const PUBLIC_DIR = path.join(__dirname, "public");
const TEMPLATES_DIR = path.join(PROJECT_ROOT, "templates");
const GEMINI_USD_PER_ROLL = 0.04; // image re-roll (1 Gemini call)
const SONNET_USD_PER_REGEN = 0.01; // text regen (~1¢ Sonnet, estimate)
const HISTORY_CAP = 10;

// ---- Args ------------------------------------------------------------------
function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const eq = a.indexOf("=");
    if (eq >= 0) { args[a.slice(2, eq)] = a.slice(eq + 1); continue; }
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) { args[key] = true; }
    else { args[key] = next; i++; }
  }
  return args;
}

const ARGS = parseArgs(process.argv.slice(2));
if (!ARGS.dir) {
  console.error("FAIL: --dir <book-dir> is required.");
  console.error("Usage: node tools/review-station/server.js --dir output/books/<id> [--port 4600] [--env-file worker/.env.local]");
  process.exit(1);
}
const BOOK_DIR = path.resolve(ARGS.dir);
const PORT = Number(ARGS.port) || 4600;
const ENV_FILE = ARGS["env-file"] || "worker/.env.local";
const STORY_PATH = path.join(BOOK_DIR, "story.json");
const PAGES_DIR = path.join(BOOK_DIR, "pages");
const HISTORY_DIR = path.join(BOOK_DIR, "_history");
const STATE_PATH = path.join(BOOK_DIR, "review-state.json");

if (!fs.existsSync(STORY_PATH)) {
  console.error(`FAIL: no story.json in ${BOOK_DIR}`);
  process.exit(1);
}

// Load the env-file into THIS process so the "Regenerate text" Sonnet call has
// ANTHROPIC_API_KEY. Best-effort — if it fails, regen errors gracefully later;
// image/text re-renders shell a child that loads the env-file itself.
const envFileAbs = path.join(PROJECT_ROOT, ENV_FILE);
let envLoaded = false;
if (fs.existsSync(envFileAbs) && typeof process.loadEnvFile === "function") {
  try { process.loadEnvFile(envFileAbs); envLoaded = true; } catch { /* regen will report */ }
}

// ---- Small utils -----------------------------------------------------------
const pad2 = (n) => String(n).padStart(2, "0");
const readStory = () => JSON.parse(fs.readFileSync(STORY_PATH, "utf8"));
const livePng = (page) => path.join(PAGES_DIR, `page-${pad2(page)}-rendered.png`);
const livePdf = (page) => path.join(PAGES_DIR, `page-${pad2(page)}.pdf`);
const rawPng = (page) => path.join(PAGES_DIR, `page-${pad2(page)}.png`);

let idCounter = 0;
const nextId = () => `${Date.now()}-${(idCounter++).toString(36)}`;

// IMAGE-provenance hash: image-relevant scene fields ONLY (EXCLUDES
// narrative_text) so a text edit never falsely flags the image stale.
function imageHash(scene, story) {
  return crypto.createHash("sha256").update(JSON.stringify({
    action: scene.action ?? "",
    subjects_present: scene.subjects_present ?? [],
    template_id: scene.layout_intent?.template_id ?? null,
    style: story.pageStyle ?? story.style ?? "",
  })).digest("hex").slice(0, 16);
}

// Template character cap (null → "any length"). Read straight from the template
// config's selection_metadata.max_narrative_chars.
const _maxCharsCache = {};
function maxCharsForTemplate(templateId) {
  if (!templateId) return null;
  if (templateId in _maxCharsCache) return _maxCharsCache[templateId];
  let v = null;
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(TEMPLATES_DIR, templateId, "config.json"), "utf8"));
    v = cfg?.selection_metadata?.max_narrative_chars ?? null;
  } catch { v = null; }
  _maxCharsCache[templateId] = v;
  return v;
}

function readState() {
  if (fs.existsSync(STATE_PATH)) {
    try { return JSON.parse(fs.readFileSync(STATE_PATH, "utf8")); }
    catch { /* fall through */ }
  }
  return { book_dir: path.basename(BOOK_DIR), pages: {}, review_notes: {}, rerolls: 0, text_regens: 0, est_cost_usd: 0 };
}
function writeState(state) {
  state.updated_at = new Date().toISOString();
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

function setNarrative(page, text) {
  const story = readStory();
  const scene = story.scenes.find((s) => s.page === Number(page));
  if (!scene) throw new Error(`no scene for page ${page}`);
  scene.narrative_text = String(text ?? "");
  fs.writeFileSync(STORY_PATH, JSON.stringify(story, null, 2));
  return scene;
}

// ---- History: snapshot + restore ------------------------------------------
// Snapshot the page's CURRENT live artifacts (pdf + rendered png + narrative)
// into _history/page-NN/<id>/ BEFORE it is replaced. Caps at HISTORY_CAP.
function snapshotPage(page, source) {
  const pdf = livePdf(page), png = livePng(page);
  if (!fs.existsSync(pdf) && !fs.existsSync(png)) return null; // nothing to keep
  const story = readStory();
  const scene = story.scenes.find((s) => s.page === Number(page));
  const id = nextId();
  const dir = path.join(HISTORY_DIR, `page-${pad2(page)}`, id);
  fs.mkdirSync(dir, { recursive: true });
  if (fs.existsSync(pdf)) fs.copyFileSync(pdf, path.join(dir, "page.pdf"));
  if (fs.existsSync(png)) fs.copyFileSync(png, path.join(dir, "rendered.png"));
  const narrative = scene?.narrative_text ?? "";
  const entry = {
    id, source, created_at: new Date().toISOString(),
    template_id: scene?.layout_intent?.template_id ?? null,
    narrative_text: narrative, chars: narrative.length,
  };
  fs.writeFileSync(path.join(dir, "entry.json"), JSON.stringify(entry, null, 2));

  const state = readState();
  const key = String(page);
  state.pages[key] = state.pages[key] || {};
  const hist = state.pages[key].history || [];
  hist.unshift({ id, source, created_at: entry.created_at, chars: entry.chars, template_id: entry.template_id });
  // Cap: drop oldest beyond HISTORY_CAP and remove their dirs.
  while (hist.length > HISTORY_CAP) {
    const drop = hist.pop();
    try { fs.rmSync(path.join(HISTORY_DIR, `page-${pad2(page)}`, drop.id), { recursive: true, force: true }); } catch { /* ignore */ }
  }
  state.pages[key].history = hist;
  writeState(state);
  return id;
}

function restorePage(page, id) {
  const dir = path.join(HISTORY_DIR, `page-${pad2(page)}`, id);
  const entryPath = path.join(dir, "entry.json");
  if (!fs.existsSync(entryPath)) throw new Error(`history entry not found: page ${page} / ${id}`);
  const entry = JSON.parse(fs.readFileSync(entryPath, "utf8"));
  // Snapshot the current live version first so restoring never loses it.
  snapshotPage(page, "pre-restore");
  const srcPdf = path.join(dir, "page.pdf"), srcPng = path.join(dir, "rendered.png");
  if (fs.existsSync(srcPdf)) fs.copyFileSync(srcPdf, livePdf(page));
  if (fs.existsSync(srcPng)) fs.copyFileSync(srcPng, livePng(page));
  setNarrative(page, entry.narrative_text);
  const state = readState();
  const key = String(page);
  state.pages[key] = state.pages[key] || {};
  state.pages[key].keeper = id;
  state.pages[key].status = "pending"; // restored version needs re-approval
  writeState(state);
  return entry;
}

// ---- View model ------------------------------------------------------------
function buildViewModel() {
  const story = readStory();
  const state = readState();
  let mutated = false;
  const pages = [];
  for (const scene of story.scenes) {
    const p = scene.page, key = String(p);
    const png = livePng(p);
    const hasImg = fs.existsSync(png);
    const mtime = hasImg ? Math.floor(fs.statSync(png).mtimeMs) : 0;
    const curImgHash = imageHash(scene, story);

    const ps = state.pages[key] || {};
    if (ps.image_hash === undefined) { ps.image_hash = curImgHash; mutated = true; } // baseline
    if (ps.status === undefined) { ps.status = "pending"; mutated = true; }
    if (ps.history === undefined) { ps.history = []; mutated = true; }
    state.pages[key] = ps;

    const templateId = scene.layout_intent?.template_id ?? null;
    const narrative = scene.narrative_text ?? "";
    pages.push({
      page: p,
      template_id: templateId,
      narrative_text: narrative,
      chars: narrative.length,
      maxChars: maxCharsForTemplate(templateId), // null = any length
      subjects_present: Array.isArray(scene.subjects_present) ? scene.subjects_present : [],
      hasImage: hasImg,
      mtime,
      status: ps.status,
      note: state.review_notes[key] ?? "",
      stale: ps.image_hash !== curImgHash,          // IMAGE stale only
      keeper: ps.keeper ?? null,
      history: (ps.history || []).map((h) => ({ ...h })),
    });
  }
  if (mutated) writeState(state);

  const approved = pages.filter((p) => p.status === "approved").length;
  return {
    title: story.title ?? path.basename(BOOK_DIR),
    dir: path.basename(BOOK_DIR),
    envLoaded,
    pages,
    summary: {
      approved, total: pages.length,
      allApproved: approved === pages.length && pages.length > 0,
      rerolls: state.rerolls ?? 0,
      textRegens: state.text_regens ?? 0,
      estCost: Number((state.est_cost_usd ?? 0).toFixed(2)),
    },
  };
}

// ---- Shell the pipeline ----------------------------------------------------
function runGenerateBook(extraArgs) {
  return new Promise((resolve) => {
    const relDir = path.relative(PROJECT_ROOT, BOOK_DIR).replace(/\\/g, "/");
    const nodeArgs = [];
    if (fs.existsSync(envFileAbs)) nodeArgs.push(`--env-file=${ENV_FILE}`);
    nodeArgs.push("scripts/generate-book.js", "--book-dir", relDir, ...extraArgs, "--yes");
    const child = spawn(process.execPath, nodeArgs, { cwd: PROJECT_ROOT, env: process.env });
    let out = "";
    child.stdout.on("data", (d) => { out += d.toString(); });
    child.stderr.on("data", (d) => { out += d.toString(); });
    child.on("close", (code) => resolve({ code, log: out.slice(-4000) }));
    child.on("error", (err) => resolve({ code: -1, log: `spawn error: ${err.message}` }));
  });
}
const rerenderImage = (page) => runGenerateBook(["--only-pages", String(page)]);
const relayText = (page) => runGenerateBook(["--only-pages", String(page), "--text-only"]);

// ---- Finalize / stitch -----------------------------------------------------
// Merge front-matter (< 50 = front, >= 50 = back) + page PDFs → book.pdf,
// useObjectStreams:false (matches src/book-pipeline.js). $0 — reuses on-disk PDFs.
async function stitchBook() {
  const story = readStory();
  const pagePdfs = story.scenes.map((s) => livePdf(s.page)).filter((p) => fs.existsSync(p));
  const fmDir = path.join(BOOK_DIR, "front-matter");
  let front = [], back = [];
  if (fs.existsSync(fmDir)) {
    for (const f of fs.readdirSync(fmDir).filter((f) => f.endsWith(".pdf")).sort()) {
      const n = parseInt(f, 10);
      (Number.isFinite(n) && n < 50 ? front : back).push(path.join(fmDir, f));
    }
  }
  const ordered = [...front, ...pagePdfs, ...back];
  const merged = await PDFDocument.create();
  for (const pdfPath of ordered) {
    const src = await PDFDocument.load(fs.readFileSync(pdfPath));
    const copied = await merged.copyPages(src, src.getPageIndices());
    copied.forEach((pg) => merged.addPage(pg));
  }
  const bytes = await merged.save({ useObjectStreams: false });
  const outPath = path.join(BOOK_DIR, "book.pdf");
  fs.writeFileSync(outPath, bytes);
  return { path: outPath, pages: ordered.length, bytes: bytes.length };
}

// ---- HTTP helpers ----------------------------------------------------------
function sendJSON(res, code, obj) {
  res.writeHead(code, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(obj));
}
function sendPng(res, filePath) {
  if (!fs.existsSync(filePath)) { res.writeHead(404); return res.end("no image"); }
  res.writeHead(200, { "content-type": "image/png", "cache-control": "no-store" });
  res.end(fs.readFileSync(filePath));
}
function readBody(req) {
  return new Promise((resolve) => {
    let b = "";
    req.on("data", (c) => { b += c; });
    req.on("end", () => { try { resolve(b ? JSON.parse(b) : {}); } catch { resolve({}); } });
  });
}
function bumpCost(delta, field) {
  const s = readState();
  s.est_cost_usd = Number(((s.est_cost_usd ?? 0) + delta).toFixed(2));
  if (field) s[field] = (s[field] ?? 0) + 1;
  writeState(s);
}
function setImageHashCurrent(page) {
  const story = readStory();
  const scene = story.scenes.find((s) => s.page === Number(page));
  if (!scene) return;
  const s = readState();
  s.pages[String(page)] = s.pages[String(page)] || {};
  s.pages[String(page)].image_hash = imageHash(scene, story);
  s.pages[String(page)].status = "pending";
  writeState(s);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = url.pathname;
  try {
    // Static index
    if (req.method === "GET" && (pathname === "/" || pathname === "/index.html")) {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      return res.end(fs.readFileSync(path.join(PUBLIC_DIR, "index.html")));
    }
    // State
    if (req.method === "GET" && pathname === "/api/state") {
      return sendJSON(res, 200, buildViewModel());
    }
    // Live rendered page image
    if (req.method === "GET" && pathname.startsWith("/img/")) {
      const page = parseInt(pathname.slice("/img/".length), 10);
      return sendPng(res, livePng(page));
    }
    // History thumbnail: /hist/:page/:id
    if (req.method === "GET" && pathname.startsWith("/hist/")) {
      const [, , pageStr, id] = pathname.split("/");
      const page = parseInt(pageStr, 10);
      if (!Number.isFinite(page) || !id) { res.writeHead(404); return res.end("bad"); }
      return sendPng(res, path.join(HISTORY_DIR, `page-${pad2(page)}`, id, "rendered.png"));
    }
    // Save image-render note (no render)
    if (req.method === "POST" && pathname === "/api/note") {
      const { page, note } = await readBody(req);
      const s = readState();
      s.review_notes[String(page)] = String(note ?? "");
      writeState(s);
      return sendJSON(res, 200, { ok: true });
    }
    // Approve / unapprove
    if (req.method === "POST" && (pathname === "/api/approve" || pathname === "/api/unapprove")) {
      const { page } = await readBody(req);
      const s = readState();
      s.pages[String(page)] = s.pages[String(page)] || {};
      s.pages[String(page)].status = pathname === "/api/approve" ? "approved" : "pending";
      writeState(s);
      return sendJSON(res, 200, { ok: true });
    }
    // Re-render IMAGE (~$0.04). Snapshot first.
    if (req.method === "POST" && pathname === "/api/rerender") {
      const { page, note } = await readBody(req);
      const s = readState();
      if (note !== undefined) s.review_notes[String(page)] = String(note ?? "");
      writeState(s);
      snapshotPage(page, "image");
      const { code, log } = await rerenderImage(page);
      if (code === 0) { bumpCost(GEMINI_USD_PER_ROLL, "rerolls"); setImageHashCurrent(page); }
      const mtime = fs.existsSync(livePng(page)) ? Math.floor(fs.statSync(livePng(page)).mtimeMs) : 0;
      return sendJSON(res, code === 0 ? 200 : 500, { ok: code === 0, code, mtime, log });
    }
    // Edit text directly ($0 re-lay). Snapshot first, save narrative, re-lay.
    if (req.method === "POST" && pathname === "/api/text-edit") {
      const { page, text } = await readBody(req);
      const story = readStory();
      const scene = story.scenes.find((sc) => sc.page === Number(page));
      const maxChars = maxCharsForTemplate(scene?.layout_intent?.template_id);
      const chars = String(text ?? "").length;
      const overflow = Number.isFinite(maxChars) && chars > maxChars;
      snapshotPage(page, "text-edit");
      setNarrative(page, text);
      const { code, log } = await relayText(page);
      if (code === 0) setImageHashCurrent(page); // status→pending (image unchanged)
      const mtime = fs.existsSync(livePng(page)) ? Math.floor(fs.statSync(livePng(page)).mtimeMs) : 0;
      return sendJSON(res, code === 0 ? 200 : 500, { ok: code === 0, code, chars, maxChars, overflow, mtime, log });
    }
    // Regenerate text via Sonnet (~1¢) then $0 re-lay. Snapshot first.
    if (req.method === "POST" && pathname === "/api/text-regen") {
      const { page, note } = await readBody(req);
      if (!envLoaded && !process.env.ANTHROPIC_API_KEY) {
        return sendJSON(res, 500, { ok: false, error: `ANTHROPIC_API_KEY not available (env-file ${ENV_FILE} not loaded). Launch with a valid --env-file.` });
      }
      const story = readStory();
      const scene = story.scenes.find((sc) => sc.page === Number(page));
      if (!scene) return sendJSON(res, 400, { ok: false, error: `no scene for page ${page}` });
      const maxChars = maxCharsForTemplate(scene.layout_intent?.template_id);
      let age = story.age ?? story.child_age ?? undefined;
      if (!Number.isFinite(age)) {
        try { age = JSON.parse(fs.readFileSync(path.join(BOOK_DIR, "meta.json"), "utf8"))?.inputs?.child?.age; }
        catch { /* age stays undefined → generic young-child wording */ }
      }
      let rewrite;
      try {
        const { rewriteNarrative } = await import("../../src/anthropic.js");
        rewrite = await rewriteNarrative({ currentText: scene.narrative_text, note, age, maxChars });
      } catch (err) {
        return sendJSON(res, 500, { ok: false, error: `Sonnet rewrite failed: ${err.message}` });
      }
      snapshotPage(page, "text-regen");
      setNarrative(page, rewrite.text);
      const { code, log } = await relayText(page);
      if (code === 0) { bumpCost(SONNET_USD_PER_REGEN, "text_regens"); setImageHashCurrent(page); }
      const mtime = fs.existsSync(livePng(page)) ? Math.floor(fs.statSync(livePng(page)).mtimeMs) : 0;
      return sendJSON(res, code === 0 ? 200 : 500, {
        ok: code === 0, code, newText: rewrite.text, chars: rewrite.text.length, maxChars,
        overflow: rewrite.overflow, mtime, log,
      });
    }
    // Restore a prior roll ($0). Snapshot current, swap artifacts + narrative, re-stitch.
    if (req.method === "POST" && pathname === "/api/restore") {
      const { page, id } = await readBody(req);
      let entry;
      try { entry = restorePage(page, id); }
      catch (err) { return sendJSON(res, 400, { ok: false, error: err.message }); }
      try { await stitchBook(); } catch { /* book.pdf refresh best-effort */ }
      const mtime = fs.existsSync(livePng(page)) ? Math.floor(fs.statSync(livePng(page)).mtimeMs) : 0;
      return sendJSON(res, 200, { ok: true, restored: entry.id, chars: entry.chars, mtime });
    }
    // Finalize (gated) → stitch
    if (req.method === "POST" && pathname === "/api/finalize") {
      const vm = buildViewModel();
      if (!vm.summary.allApproved) {
        return sendJSON(res, 400, { ok: false, error: `Not all pages approved (${vm.summary.approved}/${vm.summary.total}).` });
      }
      const out = await stitchBook();
      return sendJSON(res, 200, { ok: true, ...out });
    }

    res.writeHead(404); res.end("not found");
  } catch (err) {
    sendJSON(res, 500, { ok: false, error: String(err?.message ?? err) });
  }
});

server.listen(PORT, () => {
  console.log(`Review station → http://localhost:${PORT}`);
  console.log(`  book dir : ${BOOK_DIR}`);
  console.log(`  env-file : ${ENV_FILE}${envLoaded ? " (loaded — text regen enabled)" : " (NOT loaded — text regen will be disabled; image/text-relay still work)"}`);
  console.log(`  state    : ${STATE_PATH}`);
});
