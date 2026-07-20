// E4 — OPERATOR ERASURE. Deletes everything we hold for one person: uploaded photos,
// rendered previews, book PDFs, and the rows themselves.
//
// Two rules, inherited from E1 (lib/retention/reap-drafts.ts) and from a real incident:
//
//   1. DELETE FROM THE ROW'S OWN PATH LIST — NEVER BY SWEEPING THE BUCKET. Every
//      object deleted here is named by a row we resolved for this subject.
//   2. REFERENTIAL CHECK. Legacy paths are `uploads/<contenthash>.png`, named by
//      CONTENT — two customers who uploaded identical bytes share one object. This
//      script's own ancestor (_cleanup-prod-test-photos.mjs) skipped this check and
//      left order ae04d56c pointing at three files that no longer exist. So a path is
//      only deleted once no row OUTSIDE this subject still references it; anything
//      shared is reported as RETAINED-SHARED rather than silently kept or silently
//      deleted.
//
// D's per-draft namespacing (uploads/<draftId>/…) makes erasure a prefix delete for
// anything uploaded after 2026-07-20; the path-list walk covers the legacy objects too.
//
// DRY-RUN BY DEFAULT — prints the exact object list and row list, deletes nothing.
//   node scripts/_erase-customer.mjs --email someone@example.com
//   node scripts/_erase-customer.mjs --draft <uuid>
//   node scripts/_erase-customer.mjs --email someone@example.com --apply
//   ...add --test to run against tuatale-test instead of PROD.
import fs from "node:fs";

const argv = process.argv.slice(2);
const arg = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : null; };
const APPLY = argv.includes("--apply");
const TEST = argv.includes("--test");
const EMAIL = arg("--email");
const DRAFT_ID = arg("--draft");

if (!EMAIL && !DRAFT_ID) {
  console.error("Usage: node scripts/_erase-customer.mjs (--email <addr> | --draft <uuid>) [--apply] [--test]");
  process.exit(1);
}

const env = fs.readFileSync("website/.env.local", "utf8");
const grab = (k) => (env.match(new RegExp("^" + k + "\\s*=\\s*(\\S+)", "m")) || [])[1];
// PROD values are preserved as `# PROD <KEY>=<value>` comments when .env.local is
// repointed at test; read BOTH from the same source so a URL/key mismatch is impossible.
const grabProd = (k) => (env.match(new RegExp("^#\\s*PROD\\b.*?\\b" + k + "\\s*=\\s*(\\S+)", "m")) || [])[1];

const PROD_REF = "xffkmkxsmvqpmspzihha";
const TEST_REF = "zdtnrsjvbyivawetorxt";
const WANT_REF = TEST ? TEST_REF : PROD_REF;

let URL = grab("NEXT_PUBLIC_SUPABASE_URL");
let KEY = grab("SUPABASE_SERVICE_ROLE_KEY");
if (!URL?.includes(WANT_REF)) {
  URL = grabProd("NEXT_PUBLIC_SUPABASE_URL");
  KEY = grabProd("SUPABASE_SERVICE_ROLE_KEY");
}
if (!URL?.includes(WANT_REF)) {
  console.error(`ABORT: could not resolve credentials for ${TEST ? "TEST" : "PROD"} (${WANT_REF}).`);
  process.exit(1);
}
process.env.NEXT_PUBLIC_SUPABASE_URL = URL;
process.env.SUPABASE_SERVICE_ROLE_KEY = KEY;
const { getClient } = await import("../worker/src/db.js");
const sb = getClient();

const PREVIEW_BUCKET = "tuatale-previews";
const BOOKS_BUCKET = "tuatale-books";
console.log(`TARGET: ${TEST ? "TEST" : "PROD"} (${URL})   mode=${APPLY ? "APPLY (DELETE)" : "DRY-RUN"}`);
console.log(`SUBJECT: ${EMAIL ? `email=${EMAIL}` : `draft=${DRAFT_ID}`}\n`);

/** Pull every uploads/ path out of a photo_urls jsonb (array for child, {pet:[…]} for pet).
 *  `_`-prefixed keys are metadata (e.g. `_dangling_photos`, objects already gone), not
 *  live references — mirrors lib/retention/reap-drafts.ts. */
function collectPhotoPaths(v, out = new Set()) {
  if (typeof v === "string") { if (v.startsWith("uploads/")) out.add(v); return out; }
  if (Array.isArray(v)) { v.forEach((x) => collectPhotoPaths(x, out)); return out; }
  if (v && typeof v === "object") {
    for (const [k, val] of Object.entries(v)) { if (!k.startsWith("_")) collectPhotoPaths(val, out); }
    return out;
  }
  return out;
}

/**
 * Verify deletion via list() — NEVER via download().
 *
 * Measured on 2026-07-20: an object that had been downloaded BEFORE deletion still
 * returned bytes afterwards, while one never downloaded returned GONE immediately;
 * list() reported it absent in both cases. The delete is real either way, but the read
 * path can serve a stale copy for some unmeasured window. We must never tell a person
 * "your data is erased" on the strength of a read that can lie in the reassuring
 * direction — so list() is the authority here, and a download check is not used at all.
 */
async function verifyGone(bucket, paths) {
  const remaining = [];
  for (const p of paths) {
    const prefix = p.slice(0, p.lastIndexOf("/"));
    const name = p.slice(p.lastIndexOf("/") + 1);
    const { data } = await sb.storage.from(bucket).list(prefix, { search: name });
    if ((data ?? []).some((o) => o.name === name)) remaining.push(p);
  }
  return remaining;
}

// ── 1. Resolve the subject's rows ─────────────────────────────────────────
const { data: orders, error: oErr } = EMAIL
  ? await sb.from("orders").select("id, customer_email, photo_urls, book_pdf_url, converted_from_draft_id, created_at").eq("customer_email", EMAIL)
  : { data: [], error: null };
if (oErr) throw oErr;

const draftIds = new Set(DRAFT_ID ? [DRAFT_ID] : []);
for (const o of orders ?? []) if (o.converted_from_draft_id) draftIds.add(o.converted_from_draft_id);

const { data: drafts, error: dErr } = draftIds.size
  ? await sb.from("drafts").select("id, child_name, book_type, photo_urls, created_at").in("id", [...draftIds])
  : { data: [], error: null };
if (dErr) throw dErr;

const orderIds = new Set((orders ?? []).map((o) => o.id));
const { data: previews, error: pErr } = draftIds.size
  ? await sb.from("preview_jobs").select("id, draft_id, image_url").in("draft_id", [...draftIds])
  : { data: [], error: null };
if (pErr) throw pErr;

console.log(`ROWS: ${orders?.length ?? 0} order(s), ${drafts?.length ?? 0} draft(s), ${previews?.length ?? 0} preview job(s)`);
for (const o of orders ?? []) console.log(`  order  ${o.id}  ${String(o.created_at).slice(0, 10)}  ${o.customer_email}`);
for (const d of drafts ?? []) console.log(`  draft  ${d.id}  ${String(d.created_at).slice(0, 10)}  ${d.book_type} "${d.child_name}"`);

// ── 2. Candidate objects, FROM THE ROWS' OWN PATH LISTS ───────────────────
const photoPaths = new Set();
for (const r of [...(orders ?? []), ...(drafts ?? [])]) collectPhotoPaths(r.photo_urls, photoPaths);
// Books are namespaced by order id already — a prefix delete, no cross-row sharing.
const bookPaths = [...orderIds].map((id) => `orders/${id}/book.pdf`);
// Preview renders are per-job UUIDs (never content-shared).
const previewPaths = (previews ?? [])
  .map((p) => (p.image_url || "").split(`${PREVIEW_BUCKET}/`)[1])
  .filter(Boolean);

// ── 3. RULE 2 — referential check against everything OUTSIDE this subject ──
const { data: allDrafts } = await sb.from("drafts").select("id, photo_urls");
const { data: allOrders } = await sb.from("orders").select("id, photo_urls");
const outsideRefs = new Set();
for (const d of allDrafts ?? []) if (!draftIds.has(d.id)) collectPhotoPaths(d.photo_urls, outsideRefs);
for (const o of allOrders ?? []) if (!orderIds.has(o.id)) collectPhotoPaths(o.photo_urls, outsideRefs);

const deletablePhotos = [...photoPaths].filter((p) => !outsideRefs.has(p));
const sharedPhotos = [...photoPaths].filter((p) => outsideRefs.has(p));

console.log(`\nPHOTOS to delete (${deletablePhotos.length}):`);
deletablePhotos.forEach((p) => console.log(`  ${p}`));
if (sharedPhotos.length) {
  console.log(`\n!! RETAINED-SHARED (${sharedPhotos.length}) — a row outside this subject still references these`);
  console.log("   content-hashed objects. Deleting them would strand that row (the ae04d56c failure).");
  console.log("   An erasure request that must cover these needs a manual decision.");
  sharedPhotos.forEach((p) => console.log(`  ${p}`));
}
console.log(`\nBOOK PDFs to delete (${bookPaths.length}):`);
bookPaths.forEach((p) => console.log(`  ${p}`));
console.log(`\nPREVIEW RENDERS to delete (${previewPaths.length}):`);
previewPaths.forEach((p) => console.log(`  ${p}`));

if (!APPLY) {
  console.log("\nDRY-RUN: nothing deleted. Re-run with --apply to erase.");
  process.exit(0);
}

// ── 4. Apply: objects FIRST, rows last ────────────────────────────────────
// Same ordering rule as E1: the rows are the only record of which objects belong to
// this person, so losing them before the objects go creates a permanent orphan.
async function rm(bucket, paths) {
  if (!paths.length) return;
  const { error } = await sb.storage.from(bucket).remove(paths);
  if (error) throw new Error(`remove from ${bucket}: ${error.message}`);
  console.log(`✓ removed ${paths.length} object(s) from ${bucket}`);
}
await rm(PREVIEW_BUCKET, [...deletablePhotos, ...previewPaths]);
await rm(BOOKS_BUCKET, bookPaths);

// Confirm against the bucket listing, not a read. A delete that reported success but
// left the object listed is a failed erasure, and the operator must know before
// telling anyone otherwise.
const stillThere = [
  ...(await verifyGone(PREVIEW_BUCKET, [...deletablePhotos, ...previewPaths])),
  ...(await verifyGone(BOOKS_BUCKET, bookPaths)),
];
if (stillThere.length) {
  console.error(`\n!! VERIFICATION FAILED — ${stillThere.length} object(s) still listed:`);
  stillThere.forEach((p) => console.error(`   ${p}`));
  console.error("Rows have NOT been deleted (they are the only record of these objects).");
  console.error("Do not report this erasure as complete. Re-run after investigating.");
  process.exit(1);
}
console.log("✓ verified absent from the bucket listing");

if (previews?.length) {
  const { error } = await sb.from("preview_jobs").delete().in("id", previews.map((p) => p.id));
  if (error) throw error;
  console.log(`✓ deleted ${previews.length} preview job row(s)`);
}
if (orderIds.size) {
  // pipeline_jobs references orders with `on delete restrict` — clear it first.
  const { error: jErr } = await sb.from("pipeline_jobs").delete().in("order_id", [...orderIds]);
  if (jErr) throw jErr;
  const { error } = await sb.from("orders").delete().in("id", [...orderIds]);
  if (error) throw error;
  console.log(`✓ deleted ${orderIds.size} order(s)`);
}
if (draftIds.size) {
  const { error } = await sb.from("drafts").delete().in("id", [...draftIds]);
  if (error) throw error;
  console.log(`✓ deleted ${draftIds.size} draft(s)`);
}
console.log("\nERASURE COMPLETE — objects confirmed absent from the bucket listing, rows deleted.");
console.log(
  "CAVEAT: a previously-downloaded object can still be served from cache for some\n" +
  "window after a real delete (measured 2026-07-20; window length not yet established).\n" +
  "The object IS deleted. If you must state a timing guarantee to a customer, establish\n" +
  "that window first rather than inferring it from this run.",
);
