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
// (page-NN.pdf + narrative) into _history/page-NN/<id>/, capped at HISTORY_CAP per page,
// so any prior roll can be restored. The review IMAGE is rasterised from the PDF on
// demand (reviewed == shipped), so no separate screenshot is stored.
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
import { pdf as pdfToImages } from "pdf-to-img";

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
if (!ARGS.dir && !ARGS.order) {
  console.error("FAIL: one of --dir <book-dir> or --order <orderId> is required.");
  console.error("Usage:");
  console.error("  local book : node tools/review-station/server.js --dir output/books/<id> [--port 4600]");
  console.error("  prod book  : node tools/review-station/server.js --order <orderId>       [--port 4600]");
  console.error("               (materialises orders/<id>/review/ from Storage to a TRANSIENT temp dir,");
  console.error("                deleted on close; needs Supabase creds in --env-file, default worker/.env.local)");
  process.exit(1);
}
const PORT = Number(ARGS.port) || 4600;
const ENV_FILE = ARGS["env-file"] || "worker/.env.local";

// Load the env-file into THIS process FIRST — the "Regenerate text" Sonnet call needs
// ANTHROPIC_API_KEY, and --order mode needs NEXT_PUBLIC_SUPABASE_URL +
// SUPABASE_SERVICE_ROLE_KEY (read by worker/src/db.js getClient). The service-role key
// lives ONLY in the operator's local env-file (gitignored) — never embedded here.
const envFileAbs = path.join(PROJECT_ROOT, ENV_FILE);
let envLoaded = false;
if (fs.existsSync(envFileAbs) && typeof process.loadEnvFile === "function") {
  try { process.loadEnvFile(envFileAbs); envLoaded = true; } catch { /* regen will report */ }
}

// ---- Session lifecycle (prod --order mode) ---------------------------------
// ORPHAN SWEEP FIRST, always: clear temp dirs left by any previously-crashed session
// before doing anything else. This is the backstop that makes "transient" true even when
// a prior process was SIGKILLed. (Harmless in --dir mode — nothing to sweep.)
const { sweepOrphanSessions, materializeOrder, startHeartbeat, cleanupSession, cleanupSessionSync } =
  await import("./session.js");
try {
  const { swept, kept } = await sweepOrphanSessions();
  if (swept.length) console.log(`Orphan sweep: removed ${swept.length} crashed session dir(s): ${swept.join(", ")}`);
  if (kept.length) console.log(`Orphan sweep: kept ${kept.length} live session dir(s).`);
} catch (e) {
  console.error(`Orphan sweep FAILED (a crashed session's artifacts may remain): ${e.message}`);
  process.exit(1); // a failed sweep means we can't guarantee transience — refuse to start
}

let SESSION = null; // { dir, heartbeat } in --order mode; null for a durable --dir book
let BOOK_DIR;
if (ARGS.order) {
  const { getClient } = await import("../../worker/src/db.js");
  let client;
  try {
    client = getClient();
  } catch (e) {
    console.error(`FAIL: --order needs Supabase creds in ${ENV_FILE} (${e.message}).`);
    process.exit(1);
  }
  console.log(`Materialising review artifacts for order ${ARGS.order} …`);
  const { dir, count } = await materializeOrder(ARGS.order, client);
  BOOK_DIR = dir;
  const heartbeat = startHeartbeat(dir);
  SESSION = { dir, heartbeat };
  console.log(`  → ${count} object(s) → ${dir} (TRANSIENT — deleted on close)`);
} else {
  BOOK_DIR = path.resolve(ARGS.dir);
}

const STORY_PATH = path.join(BOOK_DIR, "story.json");
const PAGES_DIR = path.join(BOOK_DIR, "pages");
const HISTORY_DIR = path.join(BOOK_DIR, "_history");
const STATE_PATH = path.join(BOOK_DIR, "review-state.json");
const META_PATH = path.join(BOOK_DIR, "meta.json");

if (!fs.existsSync(STORY_PATH)) {
  console.error(`FAIL: no story.json in ${BOOK_DIR}`);
  process.exit(1);
}

// VERIFIED DELETE-ON-CLOSE. Graceful exits (SIGINT/SIGTERM/normal) delete the temp dir and
// VERIFY it is gone; a SIGKILL/crash runs nothing here and is caught by the next startup's
// orphan sweep. Only armed in --order mode (a --dir book is durable and never deleted).
if (SESSION) {
  let cleaned = false;
  const graceful = async (signal) => {
    if (cleaned) return;
    cleaned = true;
    SESSION.heartbeat.stop();
    try {
      const { removed } = await cleanupSession(SESSION.dir);
      console.log(`\n${signal}: session temp dir ${removed ? "deleted + verified gone" : "already gone"} (${SESSION.dir}).`);
    } catch (e) {
      console.error(`\n${signal}: session cleanup FAILED — ${e.message}. Next startup's sweep will retry.`);
    }
    process.exit(0);
  };
  process.on("SIGINT", () => graceful("SIGINT")); // Ctrl+C
  process.on("SIGTERM", () => graceful("SIGTERM"));
  process.on("SIGBREAK", () => graceful("SIGBREAK")); // Windows Ctrl+Break
  // Synchronous backstop for a plain process.exit()/uncaught path (no async here).
  process.on("exit", () => { if (!cleaned) cleanupSessionSync(SESSION.dir); });
}

// ---- Small utils -----------------------------------------------------------
const pad2 = (n) => String(n).padStart(2, "0");
const readStory = () => JSON.parse(fs.readFileSync(STORY_PATH, "utf8"));
const livePdf = (page) => path.join(PAGES_DIR, `page-${pad2(page)}.pdf`);
const rawPng = (page) => path.join(PAGES_DIR, `page-${pad2(page)}.png`);

let idCounter = 0;
const nextId = () => `${Date.now()}-${(idCounter++).toString(36)}`;

// ---- PDF → image rasteriser (review display) -------------------------------
// "REVIEWED == SHIPPED": the review image is RASTERISED FROM THE PAGE PDF, not read from a
// separate page-NN-rendered.png screenshot that could drift from the PDF that actually
// ships (and, for POD, prints). It also drops a stored rendered PORTRAIT artifact — the
// review/ retention set (worker/src/review-artifacts.js) deliberately excludes
// -rendered.png for exactly this reason, so a materialised prod book has only the PDF.
//
// Cached (mtime-keyed) under BOOK_DIR/_raster. For a --order prod book BOOK_DIR IS the
// swept session temp dir, so the cache is TRANSIENT and orphan-swept; for a --dir local
// book it sits beside an already-durable book (no new exposure). In-flight dedup so the
// UI firing 12 /img requests at once doesn't rasterise the same page twice.
const RASTER_CACHE = path.join(BOOK_DIR, "_raster");
const rasterInflight = new Map();
async function rasterisePage(pdfPath, key) {
  if (!pdfPath || !fs.existsSync(pdfPath)) return null;
  const mtime = Math.floor(fs.statSync(pdfPath).mtimeMs);
  const cacheFile = path.join(RASTER_CACHE, `${key}-${mtime}.png`);
  if (fs.existsSync(cacheFile)) return cacheFile;
  if (rasterInflight.has(cacheFile)) return rasterInflight.get(cacheFile);
  const job = (async () => {
    fs.mkdirSync(RASTER_CACHE, { recursive: true });
    const doc = await pdfToImages(pdfPath, { scale: 1.5 });
    let buf = null;
    for await (const pageBuf of doc) { buf = pageBuf; break; } // page-NN.pdf is one page
    if (!buf) return null;
    const tmp = `${cacheFile}.tmp${process.pid}`;
    fs.writeFileSync(tmp, buf);
    fs.renameSync(tmp, cacheFile);
    // Drop stale rasters for this key (a re-roll bumped the PDF mtime → new cache name).
    for (const f of fs.readdirSync(RASTER_CACHE)) {
      if (f.startsWith(`${key}-`) && f !== path.basename(cacheFile)) {
        try { fs.rmSync(path.join(RASTER_CACHE, f), { force: true }); } catch { /* ignore */ }
      }
    }
    return cacheFile;
  })().finally(() => rasterInflight.delete(cacheFile));
  rasterInflight.set(cacheFile, job);
  return job;
}

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
// Snapshot the page's CURRENT live artifacts (page.pdf + narrative) into
// _history/page-NN/<id>/ BEFORE it is replaced. Caps at HISTORY_CAP. The thumbnail is
// rasterised from the snapshotted PDF on demand.
function snapshotPage(page, source) {
  const pdf = livePdf(page);
  if (!fs.existsSync(pdf)) return null; // nothing to keep (the PDF is the artifact; the
                                        // thumbnail is rasterised from it on demand)
  const story = readStory();
  const scene = story.scenes.find((s) => s.page === Number(page));
  const id = nextId();
  const dir = path.join(HISTORY_DIR, `page-${pad2(page)}`, id);
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(pdf, path.join(dir, "page.pdf"));
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
  const srcPdf = path.join(dir, "page.pdf");
  if (fs.existsSync(srcPdf)) fs.copyFileSync(srcPdf, livePdf(page)); // bumps the PDF mtime
                                                                     // → raster cache re-mints
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
// ---- Customer inputs (Feature A) -------------------------------------------
// The station judges "did we honour the input", which is impossible if what the
// CUSTOMER GAVE is mixed with what the PIPELINE DERIVED. So provenance is explicit:
//   given[]   — from meta.json inputs (the customer's own words + choices)
//   derived[] — from story.json (Sonnet-written descriptions, resolved style)
//   photos[]  — reference photos, each with an explicit availability state
// A field the pipeline never recorded is reported as MISSING rather than omitted:
// silent absence reads as "the customer didn't say", which is a different — and
// review-corrupting — claim from "we didn't capture it".
const readMeta = () => {
  try { return JSON.parse(fs.readFileSync(META_PATH, "utf8")); } catch { return null; }
};

// Photo keys are whitelisted from meta (never taken from the request), so /photo/:key
// cannot be pointed at an arbitrary path.
function photoEntries(meta) {
  const out = [];
  const push = (key, label, p) => { if (p) out.push({ key, label, path: p }); };
  const c = meta?.inputs?.child;
  if (c) {
    push("child", `${c.name ?? "Protagonist"} — reference photo`, c.photoPath);
    if (Array.isArray(c.photo_paths)) {
      c.photo_paths.forEach((p, i) => push(`child-${i}`, `${c.name ?? "Pet"} — photo ${i + 1}`, p));
    }
  }
  (meta?.inputs?.secondaries ?? []).forEach((s, i) => {
    push(`sec-${i}`, `${s.name ?? `Secondary ${i + 1}`} — reference photo`, s.photoPath);
    if (Array.isArray(s.photo_paths)) {
      s.photo_paths.forEach((p, j) => push(`sec-${i}-${j}`, `${s.name ?? "Secondary"} — photo ${j + 1}`, p));
    }
  });
  return out;
}

function buildInputsModel(story) {
  const meta = readMeta();
  if (!meta) {
    return {
      metaPresent: false,
      note: "No meta.json in this book directory — the customer's inputs were never recorded here.",
      given: [], derived: [], photos: [],
    };
  }
  const I = meta.inputs ?? {};
  const c = I.child ?? {};
  // present(v) distinguishes "recorded and empty" from "never recorded" (undefined).
  const f = (label, value, hint = "") => ({
    label, hint,
    value: value === undefined || value === null || value === "" ? null : String(value),
    missing: value === undefined || value === null || value === "",
  });

  const given = [
    f("Name", c.name),
    f("Age", c.age),
    f("Gender", c.gender),
    f("Book type", I.book_type, "child / pet / adult"),
    f("Art style", I.art_style, "the style the customer picked"),
    f("Reading level", I.reading_level),
    f("Age band", I.ageRange),
    f("Vibe", I.vibe, "pet + adult books only"),
    f("Animal kind", c.animal_kind, "pet books"),
    f("Appearance (their words)", c.appearance),
    f("Background / heritage", c.background),
    f("Theme (their words)", I.theme),
    f("Dedication", I.dedication_message, "blank → the auto-default renders"),
  ];

  const secondaries = (I.secondaries ?? []).map((s) => ({
    name: s.name ?? "(unnamed)",
    fields: [
      f("Age", s.age), f("Gender", s.gender), f("Relationship", s.relationship),
      f("Subject type", s.subject_type), f("Appearance (their words)", s.appearance_markers),
    ],
  }));

  // DERIVED — what the pipeline wrote from the above. This is the comparison target.
  const derived = [
    f("Title", story?.title),
    f("Resolved art style", story?.style),
    f("Protagonist description (Sonnet)", story?.character),
  ];
  (story?.companion_characters ?? []).forEach((cc) => {
    derived.push(f(`${cc.name ?? "Companion"} description (Sonnet)`, cc.description ?? cc.character_description));
  });

  const photos = photoEntries(meta).map((p) => {
    const exists = (() => { try { return fs.existsSync(p.path); } catch { return false; } })();
    return { key: p.key, label: p.label, path: p.path, available: exists };
  });

  return { metaPresent: true, given, secondaries, derived, photos };
}

function buildViewModel() {
  const story = readStory();
  const state = readState();
  let mutated = false;
  const pages = [];
  for (const scene of story.scenes) {
    const p = scene.page, key = String(p);
    const pdfPath = livePdf(p); // the page image is rasterised from this on /img request
    const hasImg = fs.existsSync(pdfPath);
    const mtime = hasImg ? Math.floor(fs.statSync(pdfPath).mtimeMs) : 0;
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
    inputs: buildInputsModel(story),
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
    // Live page image — RASTERISED from the page PDF (reviewed == shipped), not a
    // separate screenshot. Cached; ~470ms/page cold, instant warm.
    if (req.method === "GET" && pathname.startsWith("/img/")) {
      const page = parseInt(pathname.slice("/img/".length), 10);
      const raster = await rasterisePage(livePdf(page), `page-${pad2(page)}`);
      if (!raster) { res.writeHead(404); return res.end("no page pdf"); }
      return sendPng(res, raster);
    }
    // Reference photo: /photo/:key. The key is looked up in the meta-derived
    // whitelist, so no caller-supplied path is ever read. A photo the pipeline
    // referenced but that no longer exists on this machine 404s, and the UI shows
    // an explicit unavailable state rather than a blank frame.
    if (req.method === "GET" && pathname.startsWith("/photo/")) {
      const key = decodeURIComponent(pathname.slice("/photo/".length));
      const entry = photoEntries(readMeta()).find((p) => p.key === key);
      if (!entry) { res.writeHead(404); return res.end("unknown photo key"); }
      if (!fs.existsSync(entry.path)) { res.writeHead(404); return res.end("photo not available locally"); }
      const ext = path.extname(entry.path).toLowerCase();
      const ct = ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : "image/jpeg";
      res.writeHead(200, { "content-type": ct, "cache-control": "no-store" });
      return res.end(fs.readFileSync(entry.path));
    }
    // History thumbnail: /hist/:page/:id — rasterised from the snapshotted page PDF.
    if (req.method === "GET" && pathname.startsWith("/hist/")) {
      const [, , pageStr, id] = pathname.split("/");
      const page = parseInt(pageStr, 10);
      if (!Number.isFinite(page) || !id) { res.writeHead(404); return res.end("bad"); }
      const histPdf = path.join(HISTORY_DIR, `page-${pad2(page)}`, id, "page.pdf");
      const raster = await rasterisePage(histPdf, `hist-${pad2(page)}-${id}`);
      if (!raster) { res.writeHead(404); return res.end("no history pdf"); }
      return sendPng(res, raster);
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
      const mtime = fs.existsSync(livePdf(page)) ? Math.floor(fs.statSync(livePdf(page)).mtimeMs) : 0;
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
      const mtime = fs.existsSync(livePdf(page)) ? Math.floor(fs.statSync(livePdf(page)).mtimeMs) : 0;
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
      const mtime = fs.existsSync(livePdf(page)) ? Math.floor(fs.statSync(livePdf(page)).mtimeMs) : 0;
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
      const mtime = fs.existsSync(livePdf(page)) ? Math.floor(fs.statSync(livePdf(page)).mtimeMs) : 0;
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
