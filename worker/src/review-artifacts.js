// worker/src/review-artifacts.js — retain the MINIMUM per-page artifact set so a prod
// book can be reviewed page-by-page after its scratch dir is deleted.
//
// LIFECYCLE (deliberately bounded to the review window, NOT a fixed retention period):
//   written   here, at job completion, as the job becomes awaiting_review
//   deleted   on ship (clearReviewArtifacts, wired into the ship transition — step 3)
//   erasable  the E4 path was fixed FIRST to prefix-delete orders/<id>/, so these are
//             covered by an erasure request (fix(privacy) 4340985).
// So a child's page illustrations + character portraits exist only while review earns
// their keep, in the same bucket + controls as book.pdf, and never past ship.
//
// FLAG-GATED (FEATURES_REVIEW_RETENTION, default off): retention WITHOUT the ship-delete
// would accumulate forever, so the pair is inert until deliberately enabled together.
//
// THE MINIMUM SET — each inclusion earns its place against the review station's actual
// operations (tools/review-station/server.js); the exclusions are re-derivable:
//   story.json         — every station operation; NOT re-derivable (Sonnet output)
//   meta.json          — child age (text regen), the customer-inputs panel
//   character-sheets/* — the render REFS. Re-rolling a page without them re-mints the
//                        sheets and CHANGES THE CHILD'S FACE (observed 2026-07-22). The
//                        fingerprint meta rides along so reuse still matches. Not cheaply
//                        re-derivable ($ + drift).
//   pages/page-NN.pdf  — reused for the 11 un-rolled pages AND the finalize merge
//   pages/page-NN.png  — the RAW render, for the $0 text re-lay (--text-only)
//   front-matter/*.pdf — the finalize merge stitches these; without them a re-stitched
//                        book loses its cover / dedication / colophon
// EXCLUDED (re-derivable → ~12.6 MB/book saved):
//   pages/*-rendered.png — rasterise the page PDF instead (also lands the banked
//                          review-sidecar "reviewed == shipped" fidelity fix, step 5)
//   front-matter/*.png   — intermediate render products; the merge uses the PDFs
//   book.pdf             — already retained by uploadBookPdf()
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { getClient } from "./db.js";
import { BUCKET } from "./storage.js";

/** Storage prefix owning one order's retained review artifacts. */
export const reviewPrefix = (orderId) => `orders/${orderId}/review`;

/** True when review retention is enabled. Default OFF — see the flag note above. */
export function reviewRetentionEnabled() {
  return process.env.FEATURES_REVIEW_RETENTION === "on";
}

function contentTypeFor(name) {
  if (name.endsWith(".pdf")) return "application/pdf";
  if (name.endsWith(".png")) return "image/png";
  if (name.endsWith(".json")) return "application/json";
  return "application/octet-stream";
}

/**
 * Upload a local directory tree to a destination prefix, keeping relative paths, applying
 * `filter(relPath)` to decide what rides along. Returns the number uploaded. A missing
 * source dir → 0 (a book without front matter simply has none to retain).
 */
async function uploadTree(sb, localDir, destPrefix, filter) {
  if (!fs.existsSync(localDir)) return 0;
  let n = 0;
  const walk = async (dir, rel) => {
    for (const entry of await fsp.readdir(dir, { withFileTypes: true })) {
      const localPath = path.join(dir, entry.name);
      const relPath = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await walk(localPath, relPath);
        continue;
      }
      if (!filter(relPath)) continue;
      const buf = await fsp.readFile(localPath);
      const { error } = await sb.storage
        .from(BUCKET)
        .upload(`${destPrefix}/${relPath}`, buf, { contentType: contentTypeFor(relPath), upsert: true });
      if (error) throw new Error(`review upload ${relPath}: ${error.message}`);
      n++;
    }
  };
  await walk(localDir, "");
  return n;
}

/**
 * Retain the minimum review set under orders/<orderId>/review/. story + meta come from the
 * in-memory objects (prod never writes them to scratch); sheets, page PDFs/raw-PNGs and
 * front-matter PDFs come from the scratch dir, which is still intact at the call site.
 *
 * @returns {Promise<{ prefix: string, count: number }>}
 */
export async function pushReviewArtifacts({ orderId, scratchDir, story, meta }, deps = {}) {
  const sb = deps.client ?? getClient();
  const prefix = reviewPrefix(orderId);

  const put = async (key, buf) => {
    const { error } = await sb.storage
      .from(BUCKET)
      .upload(`${prefix}/${key}`, buf, { contentType: contentTypeFor(key), upsert: true });
    if (error) throw new Error(`review upload ${key}: ${error.message}`);
  };

  await put("story.json", Buffer.from(JSON.stringify(story)));
  await put("meta.json", Buffer.from(JSON.stringify(meta)));
  let count = 2;

  count += await uploadTree(sb, path.join(scratchDir, "character-sheets"), `${prefix}/character-sheets`, () => true);
  count += await uploadTree(
    sb,
    path.join(scratchDir, "pages"),
    `${prefix}/pages`,
    (rel) => rel.endsWith(".pdf") || (rel.endsWith(".png") && !rel.endsWith("-rendered.png")),
  );
  count += await uploadTree(sb, path.join(scratchDir, "front-matter"), `${prefix}/front-matter`, (rel) =>
    rel.endsWith(".pdf"),
  );

  return { prefix, count };
}
