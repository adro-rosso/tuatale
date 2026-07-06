/**
 * reading_level column integration test (drafts + orders).
 *
 * Verifies the additive nullable column added by
 * 20260706120000_add_reading_level.sql: default NULL, and a concrete override
 * round-trips. Skips when TEST_SUPABASE_URL is not set (CI default); runs against
 * tuatale-test. reading_level isn't in the generated Database types yet (cast
 * pattern, like art_style/background), so writes/reads go through the raw client
 * with a narrow cast.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { createDraft } from '@/db/drafts';
import { createOrder } from '@/db/orders';
import { createTestClient, freshUuid, shouldSkipIntegrationTests, truncateAll } from './helpers';
import type { TablesInsert } from '@/types/database';
import type { TuataleSupabaseClient } from '@/lib/supabase';

const describeIntegration = shouldSkipIntegrationTests() ? describe.skip : describe;

function validOrderPayload(overrides: Record<string, unknown> = {}): TablesInsert<'orders'> {
  return {
    customer_email: 'test@example.com',
    child_name: 'Iris',
    child_age: 6,
    child_gender: 'girl',
    child_appearance: 'short brown hair, blue shirt',
    theme: 'a quiet afternoon at the park',
    age_range: '5-7',
    stripe_session_id: `cs_test_${freshUuid()}`,
    amount_paid_cents: 4500,
    paid_at: new Date().toISOString(),
    ...overrides,
  } as TablesInsert<'orders'>;
}

describeIntegration('reading_level column (drafts + orders)', () => {
  let client: TuataleSupabaseClient;
  beforeAll(() => {
    client = createTestClient();
  });
  beforeEach(async () => {
    await truncateAll(client);
  });

  it('drafts: defaults to NULL, and a concrete override round-trips', async () => {
    const draft = await createDraft(freshUuid(), client);
    expect((draft as { reading_level?: string | null }).reading_level ?? null).toBeNull();

    const { error } = await client
      .from('drafts')
      .update({ reading_level: 'advanced' } as never)
      .eq('id', draft.id);
    expect(error).toBeNull();

    const { data } = await client.from('drafts').select('reading_level').eq('id', draft.id).single();
    expect((data as unknown as { reading_level: string | null }).reading_level).toBe('advanced');
  });

  it('orders: NULL when untouched, and a concrete override round-trips', async () => {
    // Untouched → NULL (worker derives from the age band).
    const plain = await createOrder(validOrderPayload(), client);
    const { data: d1 } = await client.from('orders').select('reading_level').eq('id', plain.id).single();
    expect((d1 as unknown as { reading_level: string | null }).reading_level).toBeNull();

    // Overridden → snapshotted verbatim.
    const overridden = await createOrder(
      validOrderPayload({ reading_level: 'simplest' }),
      client,
    );
    const { data: d2 } = await client.from('orders').select('reading_level').eq('id', overridden.id).single();
    expect((d2 as unknown as { reading_level: string | null }).reading_level).toBe('simplest');
  });
});
