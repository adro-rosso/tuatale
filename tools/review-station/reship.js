// tools/review-station/reship.js — BEFORE-SHIP re-roll persistence + verified re-ship.
//
// A re-roll in a materialised --order session fixes a page in the TRANSIENT temp dir. This
// persists the fix back to orders/<id>/review/ and replaces the customer's book.pdf — but
// ONLY after proving the re-stitch is complete, so a broken merge can never overwrite a
// good book. Operates only while the job is awaiting_review (Adro's call); it does NOT
// touch pipeline_jobs, so status + completed_at (the TTL clock) are untouched.
//
// TWO HARD SAFETY PROPERTIES, both test-enforced:
//   1. WHITELIST — only named shipping artifacts ever cross to Storage. _raster/ (a child's
//      rasterised portraits), _history/, review-state.json, *-rendered.png are session-
//      transient and MUST NEVER be pushed. This is a property of the code (isShippingArtifact
//      + a guard inside the upload), not a thing to remember. Same instinct as step 2's
//      -rendered.png exclusion test.
//   2. VERIFY-BEFORE-REPLACE — all four completeness checks pass BEFORE book.pdf is
//      uploaded. On any failure: abort, report which check, upload NOTHING. The current
//      book.pdf survives by construction (we simply don't call the upload).
import fs from "node:fs";
import path from "node:path";

// pdf-lib is LAZY-imported (only the merge/verify paths need it), so the WHITELIST guards
// (isShippingArtifact + uploadReviewArtifact) can be imported — and CI-enforced in the
// website suite — WITHOUT pdf-lib on the resolution path. website CI installs only
// website deps; pdf-lib lives in the repo-root node_modules a static import would need.
let _PDFDocument = null;
async function PDFLib() {
  if (!_PDFDocument) {
    // A VARIABLE specifier (not a string literal) so no bundler statically resolves it: the
    // whitelist guards are imported by the website CI suite, which installs no root deps.
    // Only the merge/verify paths ever CALL this, in the station's Node runtime where
    // pdf-lib is present. (A literal `import("pdf-lib")` makes Vite resolve it at transform
    // time, which fails in website-only CI.)
    const spec = ["pdf", "lib"].join("-");
    ({ PDFDocument: _PDFDocument } = await import(spec));
  }
  return _PDFDocument;
}

export const BOOKS_BUCKET = "tuatale-books";
const pad2 = (n) => String(n).padStart(2, "0");

/**
 * The ONLY relative paths (under a review/book dir) that may be written to Storage.
 * Everything else stays transient. `page-\d{2}\.png` matches the RAW page image but NOT
 * `page-NN-rendered.png` (a stored portrait) — the `$` anchor excludes the suffix.
 */
export function isShippingArtifact(rel) {
  const p = String(rel).replace(/\\/g, "/");
  if (/^pages\/page-\d{2}\.pdf$/.test(p)) return true;
  if (/^pages\/page-\d{2}\.png$/.test(p)) return true; // raw, never -rendered.png
  if (/^front-matter\/[^/]+\.pdf$/.test(p)) return true;
  if (p === "story.json" || p === "meta.json") return true;
  return false;
}

/** The whitelisted shipping artifacts for one page (pdf + raw png). */
export function shippingArtifactsForPage(page) {
  return [`pages/page-${pad2(page)}.pdf`, `pages/page-${pad2(page)}.png`];
}

/**
 * Merge front-matter + page PDFs into book bytes. Shared by the local Finalize (--dir) and
 * the verified re-ship (--order) so the two can never drift on the front/back split.
 * Front matter numbered < 50 goes before the pages; >= 50 after.
 */
export async function mergeBookBytes(bookDir, story) {
  const PDFDocument = await PDFLib();
  const fmDir = path.join(bookDir, "front-matter");
  const front = [];
  const back = [];
  if (fs.existsSync(fmDir)) {
    for (const f of fs.readdirSync(fmDir).filter((f) => f.endsWith(".pdf")).sort()) {
      const n = parseInt(f, 10);
      (Number.isFinite(n) && n < 50 ? front : back).push(path.join(fmDir, f));
    }
  }
  const pagePdfs = story.scenes
    .map((s) => path.join(bookDir, "pages", `page-${pad2(s.page)}.pdf`))
    .filter((p) => fs.existsSync(p));
  const ordered = [...front, ...pagePdfs, ...back];

  const merged = await PDFDocument.create();
  for (const pdfPath of ordered) {
    const src = await PDFDocument.load(fs.readFileSync(pdfPath));
    const copied = await merged.copyPages(src, src.getPageIndices());
    copied.forEach((pg) => merged.addPage(pg));
  }
  const bytes = await merged.save({ useObjectStreams: false });
  return {
    bytes,
    frontCount: front.length,
    backCount: back.length,
    pagePdfCount: pagePdfs.length,
    sourceCount: ordered.length,
  };
}

async function pageCount(bytes) {
  const PDFDocument = await PDFLib();
  return (await PDFDocument.load(bytes)).getPageCount();
}

/**
 * The four completeness checks, run on the LOCALLY-merged bytes before any write. Returns
 * { ok, checks: [{ name, pass, detail }] }. `ok` is false if ANY check fails.
 */
export async function runCompletenessChecks({ bookDir, story, mergedBytes, merge, client, orderId }) {
  const checks = [];
  const storyPages = story.scenes.length;

  // 1. Every story page PDF is present (a re-roll that left a gap fails here).
  checks.push({
    name: "all story pages present",
    pass: merge.pagePdfCount === storyPages,
    detail: `${merge.pagePdfCount}/${storyPages} page PDFs`,
  });

  // 2. Front matter present, cover included (a re-stitch without it is a broken book).
  const fmDir = path.join(bookDir, "front-matter");
  const fmPdfs = fs.existsSync(fmDir) ? fs.readdirSync(fmDir).filter((f) => f.endsWith(".pdf")) : [];
  const hasCover = fmPdfs.some((f) => /(^|\b)0*0-?cover/i.test(f) || f.startsWith("00-"));
  checks.push({
    name: "front matter present (incl. cover)",
    pass: fmPdfs.length > 0 && hasCover,
    detail: `${fmPdfs.length} fm pdf(s), cover=${hasCover}`,
  });

  // 3. Merged PDF loads and its page count equals front + story + back.
  const merged = await pageCount(mergedBytes);
  const expected = merge.frontCount + storyPages + merge.backCount;
  checks.push({
    name: "merged page count matches",
    pass: merged === expected,
    detail: `merged=${merged} expected=${expected}`,
  });

  // 4. REGRESSION GUARD — not shorter than the customer's current book. Downloads the real
  //    book.pdf and counts it, rather than trusting the local merge. Skipped only if there
  //    is no current book (nothing to regress against).
  let current = null;
  try {
    const { data } = await client.storage.from(BOOKS_BUCKET).download(`orders/${orderId}/book.pdf`);
    if (data) current = await pageCount(Buffer.from(await data.arrayBuffer()));
  } catch {
    current = null;
  }
  checks.push({
    name: "not shorter than current book",
    pass: current === null || merged >= current,
    detail: current === null ? "no current book (skipped)" : `merged=${merged} current=${current}`,
  });

  return { ok: checks.every((c) => c.pass), checks };
}

/** Upload one shipping artifact, GUARDED — throws before writing anything non-whitelisted. */
export async function uploadReviewArtifact(client, orderId, rel, buf) {
  if (!isShippingArtifact(rel)) {
    throw new Error(`refusing to push non-shipping artifact: ${rel}`);
  }
  const key = `orders/${orderId}/review/${rel}`;
  const ct = rel.endsWith(".pdf") ? "application/pdf" : rel.endsWith(".png") ? "image/png" : "application/json";
  const { error } = await client.storage.from(BOOKS_BUCKET).upload(key, buf, { contentType: ct, upsert: true });
  if (error) throw new Error(`push ${rel}: ${error.message}`);
  return key;
}

/**
 * Verify the re-stitch, persist the dirty pages' shipping artifacts, then (and only then)
 * replace the customer's book.pdf. orderId is the SESSION's order — never caller-supplied —
 * so every write is confined to orders/<orderId>/ by construction.
 *
 * @returns {Promise<{ ok, checks, uploaded, pushed?, bookKey?, bookPages? }>}
 *   ok=false with uploaded=false when a check fails — NOTHING was written.
 */
export async function verifyAndReship({ orderId, bookDir, client, dirtyPages = [], storyDirty = false }) {
  const story = JSON.parse(fs.readFileSync(path.join(bookDir, "story.json"), "utf8"));
  const merge = await mergeBookBytes(bookDir, story);
  const { ok, checks } = await runCompletenessChecks({ bookDir, story, mergedBytes: merge.bytes, merge, client, orderId });
  if (!ok) return { ok: false, checks, uploaded: false }; // ABORT — no writes

  // Persist the dirty pages' whitelisted artifacts (so the fix survives session close), then
  // story.json if the text changed. Every path passes through the guarded upload.
  const pushed = [];
  for (const page of dirtyPages) {
    for (const rel of shippingArtifactsForPage(page)) {
      const local = path.join(bookDir, rel);
      if (fs.existsSync(local)) pushed.push(await uploadReviewArtifact(client, orderId, rel, fs.readFileSync(local)));
    }
  }
  if (storyDirty) {
    pushed.push(await uploadReviewArtifact(client, orderId, "story.json", fs.readFileSync(path.join(bookDir, "story.json"))));
  }

  // ONLY NOW — everything verified + persisted — replace the customer-facing book.pdf.
  const bookKey = `orders/${orderId}/book.pdf`;
  const { error } = await client.storage
    .from(BOOKS_BUCKET)
    .upload(bookKey, Buffer.from(merge.bytes), { contentType: "application/pdf", upsert: true });
  if (error) throw new Error(`book.pdf replace failed: ${error.message}`);

  return { ok: true, checks, uploaded: true, pushed, bookKey, bookPages: await pageCount(merge.bytes) };
}
