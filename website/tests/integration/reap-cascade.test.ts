/**
 * E1 cascade — INTEGRATION proof against the real tuatale-test project.
 *
 * Why this exists on top of the unit tests: the production dry-run came back empty
 * (nothing is expired yet), so it proved auth + wiring but exercised NO rule-2 path.
 * The unit tests use a hand-rolled Supabase double, so they prove our logic against
 * our own assumptions about the client. This runs the real reaper against a real
 * Postgres + real Storage, with the exact shape that is live in prod today:
 *
 *   pet draft 546be16f ("Benji") holds LEGACY content-hashed uploads — paths that
 *   carry no draft linkage and can be shared by value with another row.
 *
 * The load-bearing assertion is that an expired draft sharing such a path with a
 * surviving row does NOT take that object down with it, and that the object is still
 * downloadable afterwards. That is the ae04d56c failure mode, checked against real
 * bytes rather than a mock's bookkeeping.
 */
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { createTestClient, shouldSkipIntegrationTests, truncateAll, freshUuid } from '../db/helpers';
import { reapExpiredDrafts } from '@/lib/retention/reap-drafts';

const BUCKET = 'tuatale-previews';
// Mirrors the real prod paths: bare content hash, no draft namespace (pre-fix D).
const SHARED = `uploads/${'b70f8885'.repeat(8)}.png`;
const LONELY = `uploads/${'2058ffb3'.repeat(8)}.png`;
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const client = shouldSkipIntegrationTests() ? null : createTestClient();
const yesterday = new Date(Date.now() - 86_400_000).toISOString();
const nextMonth = new Date(Date.now() + 30 * 86_400_000).toISOString();

async function putObject(path: string): Promise<void> {
  const { error } = await client!.storage.from(BUCKET).upload(path, PNG, {
    contentType: 'image/png',
    upsert: true,
  });
  if (error) throw new Error(`seed upload ${path}: ${error.message}`);
}
/**
 * Existence via list(), NOT download().
 *
 * download() is not authoritative here: a probe showed that an object which had been
 * downloaded before deletion still returns bytes afterwards (cached), while one never
 * downloaded returns GONE immediately — list() reported 0 in both cases. So a
 * download-based assertion would have failed this suite for a cache artefact and,
 * worse, could pass on a delete that never happened. list() reflects the bucket.
 */
async function exists(path: string): Promise<boolean> {
  const prefix = path.slice(0, path.lastIndexOf('/'));
  const name = path.slice(path.lastIndexOf('/') + 1);
  const { data } = await client!.storage.from(BUCKET).list(prefix, { search: name });
  return (data ?? []).some((o) => o.name === name);
}

// Real network round-trips (Postgres + Storage up/download) — the 5s default is too
// tight for a multi-object seed.
describe.skipIf(shouldSkipIntegrationTests())('E1 cascade (integration)', { timeout: 60_000 }, () => {
  beforeEach(async () => {
    await truncateAll(client!);
    await client!.storage.from(BUCKET).remove([SHARED, LONELY]);
  });

  afterAll(async () => {
    if (!client) return;
    await truncateAll(client);
    await client.storage.from(BUCKET).remove([SHARED, LONELY]);
  });

  it('RULE 2: an expired draft does NOT delete a legacy path a SURVIVING draft still holds', async () => {
    await putObject(SHARED);
    await putObject(LONELY);

    const expiredId = freshUuid();
    const survivorId = freshUuid();
    // The expired draft holds both: one shared with a survivor, one of its own.
    const { error: e1 } = await client!.from('drafts').insert([
      {
        id: expiredId,
        cookie_id: freshUuid(),
        status: 'active',
        expires_at: yesterday,
        photo_urls: { pet: [SHARED, LONELY] },
      },
      {
        id: survivorId,
        cookie_id: freshUuid(),
        status: 'active',
        expires_at: nextMonth,
        photo_urls: { pet: [SHARED] },
      },
    ] as never);
    if (e1) throw e1;

    const report = await reapExpiredDrafts({ dryRun: false }, client!);

    expect(report.errors).toEqual([]);
    expect(report.draftsReaped).toBe(1);
    // The shared object survives — retained, with the reason recorded.
    expect(report.photosRetained.map((p) => p.path)).toEqual([SHARED]);
    expect(await exists(SHARED)).toBe(true);
    // The object only the expired draft held is genuinely gone.
    expect(report.photosDeleted).toEqual([LONELY]);
    expect(await exists(LONELY)).toBe(false);

    // Rows: the expired one is gone, the survivor untouched and still resolvable.
    const { data: left } = await client!.from('drafts').select('id');
    expect(left?.map((d) => d.id)).toEqual([survivorId]);
  });

  it('RULE 2: a path a paid ORDER references survives its draft being reaped', async () => {
    await putObject(SHARED);
    const draftId = freshUuid();
    const { error: e1 } = await client!.from('drafts').insert({
      id: draftId,
      cookie_id: freshUuid(),
      status: 'active',
      expires_at: yesterday,
      photo_urls: { pet: [SHARED] },
    } as never);
    if (e1) throw e1;
    const { error: e2 } = await client!.from('orders').insert({
      customer_email: 'reap-test@example.com',
      child_name: 'Benji',
      child_age: 6,
      child_gender: 'boy',
      child_appearance: 'a scruffy terrier',
      theme: 'a walk in the park',
      age_range: '5-7',
      stripe_session_id: `cs_test_${freshUuid()}`,
      amount_paid_cents: 7900,
      paid_at: new Date().toISOString(),
      photo_urls: { pet: [SHARED] },
    } as never);
    if (e2) throw e2;

    const report = await reapExpiredDrafts({ dryRun: false }, client!);

    expect(report.draftsReaped).toBe(1);
    expect(report.photosDeleted).toEqual([]);
    // A reprint against that order still finds its source photo.
    expect(await exists(SHARED)).toBe(true);
  });

  it('DRY-RUN touches nothing: object and row both survive', async () => {
    await putObject(LONELY);
    const draftId = freshUuid();
    const { error } = await client!.from('drafts').insert({
      id: draftId,
      cookie_id: freshUuid(),
      status: 'active',
      expires_at: yesterday,
      photo_urls: { pet: [LONELY] },
    } as never);
    if (error) throw error;

    const report = await reapExpiredDrafts({}, client!);

    expect(report.dryRun).toBe(true);
    expect(report.photosDeleted).toEqual([LONELY]); // "would delete"
    expect(await exists(LONELY)).toBe(true);        // but did not
    const { data: left } = await client!.from('drafts').select('id');
    expect(left?.map((d) => d.id)).toEqual([draftId]);
  });

  it('a CONVERTED draft is never reaped, even when expired (it became an order)', async () => {
    await putObject(LONELY);
    const { error } = await client!.from('drafts').insert({
      cookie_id: freshUuid(),
      status: 'converted',
      expires_at: yesterday,
      photo_urls: { pet: [LONELY] },
    } as never);
    if (error) throw error;

    const report = await reapExpiredDrafts({ dryRun: false }, client!);

    expect(report.draftsReaped).toBe(0);
    expect(await exists(LONELY)).toBe(true);
  });
});
