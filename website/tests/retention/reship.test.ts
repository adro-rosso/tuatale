// @vitest-environment node
// (pure-node PDF/fs logic — the default jsdom env gives cross-realm Uint8Array that
//  pdf-lib's instanceof checks reject.)
//
// Guards for the review-station verified re-ship (tools/review-station/reship.js).
// Lives in website/tests because CI runs the WEBSITE suite (ci.yml working-directory:
// website), so these are the ones actually enforced. Two HARD safety properties, red-test
// style, plus the completeness checks and orderId scoping.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PDFDocument } from 'pdf-lib';
// Plain-ESM station module. Imported loosely (`as any`) so JSDoc-inferred param types
// (e.g. dirtyPages defaulting to never[]) don't fight the test call sites.
import * as reshipModule from '../../../tools/review-station/reship.js';
const { isShippingArtifact, shippingArtifactsForPage, uploadReviewArtifact, mergeBookBytes, verifyAndReship } =
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  reshipModule as any;

// --- 1. WHITELIST (red test): a child's portraits + session state NEVER cross to Storage --
describe('isShippingArtifact — the transient↔persisted boundary', () => {
  it('ACCEPTS only the named shipping artifacts', () => {
    for (const ok of [
      'pages/page-01.pdf',
      'pages/page-12.png', // raw
      'front-matter/00-cover.pdf',
      'story.json',
      'meta.json',
    ]) {
      expect(isShippingArtifact(ok)).toBe(true);
    }
  });

  it('REFUSES _raster/ (a child’s portraits), _history/, review-state.json, -rendered.png', () => {
    for (const forbidden of [
      '_raster/page-01-1699999999.png',
      '_history/page-07/abc/page.pdf',
      'review-state.json',
      'pages/page-01-rendered.png', // the stored portrait — must never push
      '.heartbeat',
      'book.pdf', // replaced via a DIFFERENT path, never as a review artifact
      'pages/../book.pdf',
    ]) {
      expect(isShippingArtifact(forbidden)).toBe(false);
    }
  });

  it('uploadReviewArtifact THROWS before writing a non-whitelisted path (defence in depth)', async () => {
    const calls: string[] = [];
    const client = { storage: { from: () => ({ upload: async (k: string) => { calls.push(k); return { error: null }; } }) } };
    await expect(uploadReviewArtifact(client, 'ORD1', '_raster/x.png', Buffer.from('x'))).rejects.toThrow(/non-shipping/);
    expect(calls).toEqual([]); // nothing was written
  });

  it('shippingArtifactsForPage is exactly the pdf + raw png (never -rendered.png)', () => {
    expect(shippingArtifactsForPage(7)).toEqual(['pages/page-07.pdf', 'pages/page-07.png']);
  });
});

// --- fixtures: a tiny real book dir (1-page PDFs) --------------------------------------
async function onePagePdf(): Promise<Buffer> {
  const d = await PDFDocument.create();
  d.addPage([200, 200]);
  return Buffer.from(await d.save());
}
async function makeBook(scenes = 2): Promise<string> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reship-fix-'));
  fs.mkdirSync(path.join(dir, 'pages'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'front-matter'), { recursive: true });
  const story = { title: 'T', scenes: Array.from({ length: scenes }, (_, i) => ({ page: i + 1, narrative_text: 'x' })) };
  fs.writeFileSync(path.join(dir, 'story.json'), JSON.stringify(story));
  for (let p = 1; p <= scenes; p++) fs.writeFileSync(path.join(dir, 'pages', `page-${String(p).padStart(2, '0')}.pdf`), await onePagePdf());
  fs.writeFileSync(path.join(dir, 'front-matter', '00-cover.pdf'), await onePagePdf());
  fs.writeFileSync(path.join(dir, 'front-matter', '99-colophon.pdf'), await onePagePdf());
  return dir;
}
function recordingClient(currentBookPages: number | null = null) {
  const uploads: string[] = [];
  return {
    uploads,
    storage: {
      from: () => ({
        upload: async (key: string) => { uploads.push(key); return { error: null }; },
        download: async () => {
          if (currentBookPages === null) return { data: null, error: { message: 'not found' } };
          const d = await PDFDocument.create();
          for (let i = 0; i < currentBookPages; i++) d.addPage([200, 200]);
          const bytes = await d.save();
          return { data: { arrayBuffer: async () => Uint8Array.from(bytes).buffer }, error: null };
        },
      }),
    },
  };
}

// --- 2. VERIFY-BEFORE-REPLACE + orderId scoping ---------------------------------------
describe('verifyAndReship', () => {
  it('happy path: verifies, pushes ONLY under orders/<orderId>/, replaces book.pdf LAST', async () => {
    const dir = await makeBook(2);
    const client = recordingClient(3); // current book has 3 pages (cover+2); merge also 3
    const res = await verifyAndReship({ orderId: 'ORDER-A', bookDir: dir, client, dirtyPages: [1], storyDirty: true });
    expect(res.ok).toBe(true);
    expect(res.uploaded).toBe(true);
    expect(res.checks.every((c: { pass: boolean }) => c.pass)).toBe(true);
    // EVERY write confined to this order (orderId is not caller-influenced).
    expect(client.uploads.every((k) => k.startsWith('orders/ORDER-A/'))).toBe(true);
    // book.pdf replaced, and it is the LAST write (verified-complete gate).
    expect(client.uploads.at(-1)).toBe('orders/ORDER-A/book.pdf');
    // dirty page 1 pushed its pdf + raw png; story.json pushed.
    expect(client.uploads).toContain('orders/ORDER-A/review/pages/page-01.pdf');
    expect(client.uploads).toContain('orders/ORDER-A/review/story.json');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('ABORTS + writes NOTHING when a page is missing (book survives by construction)', async () => {
    const dir = await makeBook(2);
    fs.rmSync(path.join(dir, 'pages', 'page-02.pdf')); // force an incomplete book
    const client = recordingClient(3);
    const res = await verifyAndReship({ orderId: 'ORDER-B', bookDir: dir, client, dirtyPages: [1] });
    expect(res.ok).toBe(false);
    expect(res.uploaded).toBe(false);
    expect(client.uploads).toEqual([]); // the current book.pdf was never touched
    const failed = res.checks.filter((c: { pass: boolean }) => !c.pass).map((c: { name: string }) => c.name);
    expect(failed).toContain('all story pages present');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('ABORTS when the re-stitch is SHORTER than the current book (regression guard)', async () => {
    const dir = await makeBook(2); // merges to 3 pages
    const client = recordingClient(5); // current book claims 5 pages → 3 < 5 → abort
    const res = await verifyAndReship({ orderId: 'ORDER-C', bookDir: dir, client, dirtyPages: [] });
    expect(res.ok).toBe(false);
    expect(client.uploads).toEqual([]);
    expect(res.checks.find((c: { name: string }) => c.name === 'not shorter than current book')?.pass).toBe(false);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('ABORTS when front matter (cover) is absent', async () => {
    const dir = await makeBook(2);
    fs.rmSync(path.join(dir, 'front-matter'), { recursive: true, force: true });
    const client = recordingClient(3);
    const res = await verifyAndReship({ orderId: 'ORDER-D', bookDir: dir, client, dirtyPages: [] });
    expect(res.ok).toBe(false);
    expect(client.uploads).toEqual([]);
    expect(res.checks.find((c: { name: string }) => c.name.startsWith('front matter'))?.pass).toBe(false);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('mergeBookBytes orders front (<50) → pages → back (>=50)', async () => {
    const dir = await makeBook(2);
    const story = JSON.parse(fs.readFileSync(path.join(dir, 'story.json'), 'utf8'));
    const m = await mergeBookBytes(dir, story);
    expect(m.frontCount).toBe(1); // 00-cover
    expect(m.backCount).toBe(1); // 99-colophon
    expect(m.pagePdfCount).toBe(2);
    expect((await PDFDocument.load(m.bytes)).getPageCount()).toBe(4);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
