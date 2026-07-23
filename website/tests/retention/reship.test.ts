// WHITELIST red-test for the review-station re-ship (tools/review-station/reship.js).
//
// Lives in the WEBSITE suite because CI runs only website (ci.yml working-directory:
// website), and the "never push a child's portrait" property MUST gate merges. It needs no
// pdf-lib (reship.js lazy-imports pdf-lib only in its merge/verify paths), so it runs in
// the website-only CI environment. The pdf-dependent merge/verify tests live locally in
// tests/local/ (they need root pdf-lib, which website CI does not install) — see the note
// there and the "add worker/tools test job to CI" follow-up.
import { describe, it, expect } from 'vitest';
// Plain-ESM station module. Imported loosely (`as any`) so JSDoc-inferred types don't
// fight the call sites. Only the whitelist functions are exercised here — no pdf-lib.
import * as reshipModule from '../../../tools/review-station/reship.js';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const { isShippingArtifact, shippingArtifactsForPage, uploadReviewArtifact } = reshipModule as any;

describe('isShippingArtifact — the transient↔persisted boundary (privacy guard)', () => {
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
      'book.pdf', // replaced via a different path, never as a review artifact
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
