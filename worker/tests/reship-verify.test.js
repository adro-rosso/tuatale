// PDF-dependent guards for the review-station verified re-ship (merge order, the four
// completeness checks, verify-before-replace, orderId scoping). These need root pdf-lib and
// so cannot run in the website-only CI — they live here with the other worker-suite tests
// that aren't CI-run yet (e.g. review-artifacts.test.js's -rendered.png exclusion). The
// WHITELIST guard is CI-enforced separately in website/tests/retention/reship.test.ts.
//
// FOLLOW-UP: when a worker/tools CI job is added (ci.yml only runs website today), it should
// cover BOTH this file and the step-2 exclusion test.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PDFDocument } from "pdf-lib";
import { mergeBookBytes, verifyAndReship } from "../../tools/review-station/reship.js";

async function onePagePdf() {
  const d = await PDFDocument.create();
  d.addPage([200, 200]);
  return Buffer.from(await d.save());
}
async function makeBook(scenes = 2) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "reship-fix-"));
  fs.mkdirSync(path.join(dir, "pages"), { recursive: true });
  fs.mkdirSync(path.join(dir, "front-matter"), { recursive: true });
  const story = { title: "T", scenes: Array.from({ length: scenes }, (_, i) => ({ page: i + 1, narrative_text: "x" })) };
  fs.writeFileSync(path.join(dir, "story.json"), JSON.stringify(story));
  for (let p = 1; p <= scenes; p++) fs.writeFileSync(path.join(dir, "pages", `page-${String(p).padStart(2, "0")}.pdf`), await onePagePdf());
  fs.writeFileSync(path.join(dir, "front-matter", "00-cover.pdf"), await onePagePdf());
  fs.writeFileSync(path.join(dir, "front-matter", "99-colophon.pdf"), await onePagePdf());
  return dir;
}
function recordingClient(currentBookPages = null) {
  const uploads = [];
  return {
    uploads,
    storage: {
      from: () => ({
        upload: async (key) => { uploads.push(key); return { error: null }; },
        download: async () => {
          if (currentBookPages === null) return { data: null, error: { message: "not found" } };
          const d = await PDFDocument.create();
          for (let i = 0; i < currentBookPages; i++) d.addPage([200, 200]);
          const bytes = await d.save();
          return { data: { arrayBuffer: async () => Uint8Array.from(bytes).buffer }, error: null };
        },
      }),
    },
  };
}

describe("mergeBookBytes", () => {
  it("orders front (<50) → pages → back (>=50)", async () => {
    const dir = await makeBook(2);
    const story = JSON.parse(fs.readFileSync(path.join(dir, "story.json"), "utf8"));
    const m = await mergeBookBytes(dir, story);
    expect(m.frontCount).toBe(1);
    expect(m.backCount).toBe(1);
    expect(m.pagePdfCount).toBe(2);
    expect((await PDFDocument.load(m.bytes)).getPageCount()).toBe(4);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe("verifyAndReship", () => {
  it("happy: verifies, pushes ONLY under orders/<orderId>/, replaces book.pdf LAST", async () => {
    const dir = await makeBook(2);
    const client = recordingClient(3);
    const res = await verifyAndReship({ orderId: "ORDER-A", bookDir: dir, client, dirtyPages: [1], storyDirty: true });
    expect(res.ok).toBe(true);
    expect(res.uploaded).toBe(true);
    expect(res.checks.every((c) => c.pass)).toBe(true);
    expect(client.uploads.every((k) => k.startsWith("orders/ORDER-A/"))).toBe(true); // scoping
    expect(client.uploads.at(-1)).toBe("orders/ORDER-A/book.pdf"); // book replaced LAST
    expect(client.uploads).toContain("orders/ORDER-A/review/pages/page-01.pdf");
    expect(client.uploads).toContain("orders/ORDER-A/review/story.json");
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("ABORTS + writes NOTHING when a page is missing (book survives by construction)", async () => {
    const dir = await makeBook(2);
    fs.rmSync(path.join(dir, "pages", "page-02.pdf"));
    const client = recordingClient(3);
    const res = await verifyAndReship({ orderId: "ORDER-B", bookDir: dir, client, dirtyPages: [1] });
    expect(res.ok).toBe(false);
    expect(res.uploaded).toBe(false);
    expect(client.uploads).toEqual([]);
    expect(res.checks.filter((c) => !c.pass).map((c) => c.name)).toContain("all story pages present");
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("ABORTS when the re-stitch is SHORTER than the current book (regression guard)", async () => {
    const dir = await makeBook(2);
    const client = recordingClient(5);
    const res = await verifyAndReship({ orderId: "ORDER-C", bookDir: dir, client, dirtyPages: [] });
    expect(res.ok).toBe(false);
    expect(client.uploads).toEqual([]);
    expect(res.checks.find((c) => c.name === "not shorter than current book")?.pass).toBe(false);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("ABORTS when front matter (cover) is absent", async () => {
    const dir = await makeBook(2);
    fs.rmSync(path.join(dir, "front-matter"), { recursive: true, force: true });
    const client = recordingClient(3);
    const res = await verifyAndReship({ orderId: "ORDER-D", bookDir: dir, client, dirtyPages: [] });
    expect(res.ok).toBe(false);
    expect(client.uploads).toEqual([]);
    expect(res.checks.find((c) => c.name.startsWith("front matter"))?.pass).toBe(false);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
