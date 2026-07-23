// worker/tests/review-artifacts.test.js — the retained minimum set is EXACT.
// This is privacy-relevant: -rendered.png must never be retained (re-derivable, and it
// is a child's face outside story context), and book.pdf must not be swept into review/.
// A stub Supabase client records upload keys; no network, no filesystem writes to Storage.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pushReviewArtifacts, reviewRetentionEnabled } from "../src/review-artifacts.js";

function stubClient() {
  const uploads = [];
  return {
    uploads,
    storage: {
      from: () => ({
        upload: async (key, _buf, _opts) => {
          uploads.push(key);
          return { error: null };
        },
      }),
    },
  };
}

let scratch;
beforeEach(() => {
  scratch = fs.mkdtempSync(path.join(os.tmpdir(), "review-artifacts-test-"));
  const mk = (rel) => {
    const p = path.join(scratch, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, "x");
  };
  mk("character-sheets/sheet-01.png");
  mk("character-sheets/protagonist-meta.json");
  for (const n of ["01", "02"]) {
    mk(`pages/page-${n}.pdf`);
    mk(`pages/page-${n}.png`); // raw → retained
    mk(`pages/page-${n}-rendered.png`); // → EXCLUDED
  }
  mk("front-matter/00-cover.pdf");
  mk("front-matter/00-cover.png"); // → EXCLUDED
  mk("book.pdf"); // → must NOT be swept in
});
afterEach(() => fs.rmSync(scratch, { recursive: true, force: true }));

describe("pushReviewArtifacts", () => {
  it("retains exactly the minimum set, keyed under orders/<id>/review/", async () => {
    const client = stubClient();
    const { count, prefix } = await pushReviewArtifacts(
      { orderId: "ORDER1", scratchDir: scratch, story: { title: "T" }, meta: { inputs: {} } },
      { client },
    );
    const keys = client.uploads.map((k) => k.replace(`${prefix}/`, "")).sort();
    expect(prefix).toBe("orders/ORDER1/review");
    expect(keys).toEqual(
      [
        "story.json",
        "meta.json",
        "character-sheets/sheet-01.png",
        "character-sheets/protagonist-meta.json",
        "pages/page-01.pdf",
        "pages/page-01.png",
        "pages/page-02.pdf",
        "pages/page-02.png",
        "front-matter/00-cover.pdf",
      ].sort(),
    );
    expect(count).toBe(9);
  });

  it("NEVER retains a -rendered.png (re-derivable; a child's face out of context)", async () => {
    const client = stubClient();
    await pushReviewArtifacts(
      { orderId: "O", scratchDir: scratch, story: {}, meta: {} },
      { client },
    );
    expect(client.uploads.some((k) => k.endsWith("-rendered.png"))).toBe(false);
  });

  it("does not sweep book.pdf or front-matter PNGs into the review prefix", async () => {
    const client = stubClient();
    const { prefix } = await pushReviewArtifacts(
      { orderId: "O", scratchDir: scratch, story: {}, meta: {} },
      { client },
    );
    expect(client.uploads).not.toContain(`${prefix}/book.pdf`);
    expect(client.uploads.some((k) => k.startsWith(`${prefix}/front-matter/`) && k.endsWith(".png"))).toBe(false);
  });

  it("a book with no front-matter dir simply retains none (no throw)", async () => {
    fs.rmSync(path.join(scratch, "front-matter"), { recursive: true, force: true });
    const client = stubClient();
    const { count } = await pushReviewArtifacts(
      { orderId: "O", scratchDir: scratch, story: {}, meta: {} },
      { client },
    );
    expect(count).toBe(8); // the cover pdf drops out
    expect(client.uploads.some((k) => k.includes("/front-matter/"))).toBe(false);
  });

  it("is flag-gated and default OFF", () => {
    const prev = process.env.FEATURES_REVIEW_RETENTION;
    delete process.env.FEATURES_REVIEW_RETENTION;
    expect(reviewRetentionEnabled()).toBe(false);
    process.env.FEATURES_REVIEW_RETENTION = "on";
    expect(reviewRetentionEnabled()).toBe(true);
    process.env.FEATURES_REVIEW_RETENTION = "1"; // only "on" enables
    expect(reviewRetentionEnabled()).toBe(false);
    if (prev === undefined) delete process.env.FEATURES_REVIEW_RETENTION;
    else process.env.FEATURES_REVIEW_RETENTION = prev;
  });
});
