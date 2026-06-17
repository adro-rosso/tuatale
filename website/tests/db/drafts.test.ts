/**
 * drafts integration tests.
 *
 * Skips entirely when TEST_SUPABASE_URL is not set (CI default). When
 * configured, runs against the tuatale-test Supabase project.
 *
 * Coverage:
 *   - create + read roundtrip
 *   - expires_at default is 30 days out
 *   - getDraftByCookieId returns null for unknown cookie
 *   - update patches fields + updated_at advances via trigger
 *   - markDraftConverted transitions status + records order link
 *   - invalid child_gender rejected by CHECK constraint
 *   - invalid current_step rejected by CHECK constraint
 *   - status transition active → abandoned via update
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import {
  createDraft,
  getDraftByCookieId,
  getDraftById,
  updateDraft,
  markDraftConverted,
} from '@/db/drafts';
import { createTestClient, freshUuid, shouldSkipIntegrationTests, truncateAll } from './helpers';
import { DatabaseError } from '@/db/errors';
import type { TuataleSupabaseClient } from '@/lib/supabase';

const skipSuite = shouldSkipIntegrationTests();
const describeIntegration = skipSuite ? describe.skip : describe;

describeIntegration('drafts integration', () => {
  let client: TuataleSupabaseClient;

  beforeAll(() => {
    client = createTestClient();
  });

  beforeEach(async () => {
    await truncateAll(client);
  });

  it('createDraft inserts a row with defaults populated', async () => {
    const cookieId = freshUuid();
    const draft = await createDraft(cookieId, client);

    expect(draft.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(draft.cookie_id).toBe(cookieId);
    expect(draft.status).toBe('active');
    expect(draft.current_step).toBe('style'); // W-F: 'style' is now the first step
    expect(draft.secondaries).toEqual([]);
    expect(draft.customer_email).toBeNull();
    expect(draft.child_name).toBeNull();
  });

  it('expires_at defaults to ~30 days from creation', async () => {
    const draft = await createDraft(freshUuid(), client);
    const created = new Date(draft.created_at).getTime();
    const expires = new Date(draft.expires_at).getTime();
    const days = (expires - created) / (1000 * 60 * 60 * 24);
    // Allow ±1 day slack for clock skew or interval rounding.
    expect(days).toBeGreaterThan(29);
    expect(days).toBeLessThan(31);
  });

  it('getDraftByCookieId returns null for unknown cookie', async () => {
    const result = await getDraftByCookieId(freshUuid(), client);
    expect(result).toBeNull();
  });

  it('getDraftByCookieId returns the most recent active draft', async () => {
    const cookieId = freshUuid();
    const first = await createDraft(cookieId, client);
    // Mark the first as abandoned so a fresh create owns the active slot.
    await updateDraft(first.id, { status: 'abandoned' }, client);
    const second = await createDraft(cookieId, client);
    const fetched = await getDraftByCookieId(cookieId, client);
    expect(fetched?.id).toBe(second.id);
  });

  it('updateDraft patches fields + updated_at advances via trigger', async () => {
    const draft = await createDraft(freshUuid(), client);
    const originalUpdated = new Date(draft.updated_at).getTime();
    // Brief sleep so the trigger's now() resolves to a later millisecond.
    await new Promise((r) => setTimeout(r, 50));
    const updated = await updateDraft(
      draft.id,
      { child_name: 'Iris', child_age: 6, child_gender: 'girl' },
      client,
    );
    expect(updated.child_name).toBe('Iris');
    expect(updated.child_age).toBe(6);
    expect(updated.child_gender).toBe('girl');
    expect(new Date(updated.updated_at).getTime()).toBeGreaterThan(originalUpdated);
  });

  it('persists + reads back a child_features blob (jsonb round-trip)', async () => {
    const draft = await createDraft(freshUuid(), client);
    const features = {
      hair_colour: 'brown',
      hair_style: 'tousled',
      skin_tone: 'tan',
      eye_colour: 'brown',
      outfit: { tee: 'green', shorts: 'khaki', shoes: 'brown-boots' },
      marks: [{ type: 'mole', side: 'left', region: 'cheek' }],
    };
    const updated = await updateDraft(draft.id, { child_features: features }, client);
    expect(updated.child_features).toEqual(features);
    const fetched = await getDraftById(draft.id, client);
    expect(fetched?.child_features).toEqual(features);
  });

  it('markDraftConverted sets status + records order id', async () => {
    const draft = await createDraft(freshUuid(), client);
    const orderId = freshUuid();
    await markDraftConverted(draft.id, orderId, client);
    const fetched = await getDraftById(draft.id, client);
    expect(fetched?.status).toBe('converted');
    expect(fetched?.converted_to_order_id).toBe(orderId);
  });

  // The CHECK enum columns (child_gender, current_step, status) are typed
  // as plain `string` by the Supabase type generator — Postgres CHECK
  // constraints aren't expressed in the schema metadata. These two cases
  // therefore only fail at the DB layer (runtime), not at compile time.
  // Phase 2.C will add Zod validation at the API boundary so invalid
  // values are rejected before they reach the DB at all.
  it('rejects invalid child_gender at the DB constraint layer', async () => {
    const draft = await createDraft(freshUuid(), client);
    await expect(updateDraft(draft.id, { child_gender: 'mystery' }, client)).rejects.toBeInstanceOf(
      DatabaseError,
    );
  });

  it('rejects invalid current_step at the DB constraint layer', async () => {
    const draft = await createDraft(freshUuid(), client);
    await expect(
      updateDraft(draft.id, { current_step: 'mystery_step' }, client),
    ).rejects.toBeInstanceOf(DatabaseError);
  });
});
