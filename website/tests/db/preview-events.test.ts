/**
 * preview_events integration tests.
 *
 * Skips entirely when TEST_SUPABASE_URL is not set (CI default).
 *
 * Coverage:
 *   - insert with IP only
 *   - insert with IP + email
 *   - countByIpRecent over a 24h window
 *   - countByEmailRecent over a 24h window
 *   - countByEmailLifetime ignores window
 *   - getFlaggedEvents returns only flagged rows, newest-first
 *   - threshold-state denormalization round-trips through the DB
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import {
  insertEvent,
  countByIpRecent,
  countByEmailRecent,
  countByEmailLifetime,
  getFlaggedEvents,
} from '@/db/preview-events';
import { createTestClient, freshUuid, shouldSkipIntegrationTests, truncateAll } from './helpers';
import type { PreviewEventInsert } from '@/types/database';
import type { TuataleSupabaseClient } from '@/lib/supabase';

const skipSuite = shouldSkipIntegrationTests();
const describeIntegration = skipSuite ? describe.skip : describe;

function ipEventPayload(overrides: Partial<PreviewEventInsert> = {}): PreviewEventInsert {
  return {
    ip_address: '203.0.113.7',
    event_type: 'preview_requested',
    allowed: true,
    ...overrides,
  };
}

describeIntegration('preview_events integration', () => {
  let client: TuataleSupabaseClient;

  beforeAll(() => {
    client = createTestClient();
  });

  beforeEach(async () => {
    await truncateAll(client);
  });

  it('insert with IP only', async () => {
    const row = await insertEvent(ipEventPayload(), client);
    expect(row.ip_address).toBe('203.0.113.7');
    expect(row.customer_email).toBeNull();
    expect(row.allowed).toBe(true);
    expect(row.flagged).toBe(false);
  });

  it('insert with IP + email + threshold state', async () => {
    const row = await insertEvent(
      ipEventPayload({
        customer_email: 'preview@example.com',
        draft_id: freshUuid(),
        ip_count_24h: 3,
        email_count_24h: 1,
        email_count_lifetime: 4,
        estimated_cost_cents: 8,
      }),
      client,
    );
    expect(row.customer_email).toBe('preview@example.com');
    expect(row.ip_count_24h).toBe(3);
    expect(row.email_count_24h).toBe(1);
    expect(row.email_count_lifetime).toBe(4);
    expect(row.estimated_cost_cents).toBe(8);
  });

  it('countByIpRecent counts events in the window for that IP only', async () => {
    const ip = '198.51.100.42';
    await insertEvent(ipEventPayload({ ip_address: ip }), client);
    await insertEvent(ipEventPayload({ ip_address: ip }), client);
    await insertEvent(ipEventPayload({ ip_address: '198.51.100.99' }), client);
    expect(await countByIpRecent(ip, 24, client)).toBe(2);
    expect(await countByIpRecent('198.51.100.99', 24, client)).toBe(1);
    expect(await countByIpRecent('203.0.113.250', 24, client)).toBe(0);
  });

  it('countByEmailRecent counts events for that email only', async () => {
    const email = 'rate-limit@example.com';
    await insertEvent(ipEventPayload({ customer_email: email }), client);
    await insertEvent(ipEventPayload({ customer_email: email }), client);
    await insertEvent(ipEventPayload({ customer_email: 'other@example.com' }), client);
    expect(await countByEmailRecent(email, 24, client)).toBe(2);
  });

  it('countByEmailLifetime ignores the 24h window', async () => {
    const email = 'lifetime@example.com';
    for (let i = 0; i < 5; i++) {
      await insertEvent(ipEventPayload({ customer_email: email }), client);
    }
    expect(await countByEmailLifetime(email, client)).toBe(5);
  });

  it('getFlaggedEvents returns only flagged rows, newest-first', async () => {
    const unflagged = await insertEvent(ipEventPayload(), client);
    await new Promise((r) => setTimeout(r, 30));
    const flaggedOld = await insertEvent(ipEventPayload({ flagged: true }), client);
    await new Promise((r) => setTimeout(r, 30));
    const flaggedNew = await insertEvent(ipEventPayload({ flagged: true }), client);

    const flagged = await getFlaggedEvents(50, client);
    expect(flagged.map((e) => e.id)).toEqual([flaggedNew.id, flaggedOld.id]);
    expect(flagged.map((e) => e.id)).not.toContain(unflagged.id);
  });
});
