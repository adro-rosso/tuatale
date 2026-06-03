/**
 * orders integration tests.
 *
 * Skips entirely when TEST_SUPABASE_URL is not set (CI default).
 *
 * Coverage:
 *   - create from draft-shaped data
 *   - getOrderById + getOrderByStripeSessionId roundtrip
 *   - stripe_session_id uniqueness enforced
 *   - cannot insert negative amount_paid_cents
 *   - cannot insert invalid pipeline_status
 *   - updateOrderPipelineStatus mutates only the pipeline fields
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import {
  createOrder,
  getOrderById,
  getOrderByStripeSessionId,
  getOrdersByEmail,
  updateOrderPipelineStatus,
} from '@/db/orders';
import { DatabaseError } from '@/db/errors';
import { createTestClient, freshUuid, shouldSkipIntegrationTests, truncateAll } from './helpers';
import type { TablesInsert } from '@/types/database';
import type { TuataleSupabaseClient } from '@/lib/supabase';

type OrderInsert = TablesInsert<'orders'>;

const skipSuite = shouldSkipIntegrationTests();
const describeIntegration = skipSuite ? describe.skip : describe;

function validOrderPayload(overrides: Partial<OrderInsert> = {}): OrderInsert {
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
  };
}

describeIntegration('orders integration', () => {
  let client: TuataleSupabaseClient;

  beforeAll(() => {
    client = createTestClient();
  });

  beforeEach(async () => {
    await truncateAll(client);
  });

  it('createOrder inserts a row with defaults populated', async () => {
    const order = await createOrder(validOrderPayload(), client);
    expect(order.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(order.pipeline_status).toBe('queued');
    expect(order.currency).toBe('aud');
    expect(order.secondaries).toEqual([]);
    expect(order.book_pdf_url).toBeNull();
  });

  it('getOrderById + getOrderByStripeSessionId roundtrip', async () => {
    const stripeSessionId = `cs_test_${freshUuid()}`;
    const order = await createOrder(
      validOrderPayload({ stripe_session_id: stripeSessionId }),
      client,
    );
    expect((await getOrderById(order.id, client))?.id).toBe(order.id);
    expect((await getOrderByStripeSessionId(stripeSessionId, client))?.id).toBe(order.id);
  });

  it('getOrdersByEmail returns newest-first', async () => {
    const email = 'multi@example.com';
    const first = await createOrder(validOrderPayload({ customer_email: email }), client);
    await new Promise((r) => setTimeout(r, 30));
    const second = await createOrder(validOrderPayload({ customer_email: email }), client);
    const list = await getOrdersByEmail(email, client);
    expect(list.map((o) => o.id)).toEqual([second.id, first.id]);
  });

  it('rejects duplicate stripe_session_id (unique constraint)', async () => {
    const sessionId = `cs_test_${freshUuid()}`;
    await createOrder(validOrderPayload({ stripe_session_id: sessionId }), client);
    await expect(
      createOrder(validOrderPayload({ stripe_session_id: sessionId }), client),
    ).rejects.toBeInstanceOf(DatabaseError);
  });

  it('rejects negative amount_paid_cents (CHECK constraint)', async () => {
    await expect(
      createOrder(validOrderPayload({ amount_paid_cents: -100 }), client),
    ).rejects.toBeInstanceOf(DatabaseError);
  });

  it('rejects invalid pipeline_status (CHECK constraint)', async () => {
    // pipeline_status types as plain `string` post-gen (CHECK constraints
    // aren't represented in the Supabase types), so this is a runtime
    // assertion only — same pattern as the drafts gender/step tests.
    await expect(
      createOrder(validOrderPayload({ pipeline_status: 'mystery_state' }), client),
    ).rejects.toBeInstanceOf(DatabaseError);
  });

  it('updateOrderPipelineStatus mutates only pipeline fields', async () => {
    const order = await createOrder(validOrderPayload(), client);
    const completedAt = new Date().toISOString();
    const updated = await updateOrderPipelineStatus(
      order.id,
      {
        pipeline_status: 'complete',
        pipeline_completed_at: completedAt,
        book_pdf_url: 'https://example.com/book.pdf',
      },
      client,
    );
    expect(updated.pipeline_status).toBe('complete');
    expect(updated.pipeline_completed_at).toBe(completedAt);
    expect(updated.book_pdf_url).toBe('https://example.com/book.pdf');
    // Customer/child fields preserved.
    expect(updated.customer_email).toBe(order.customer_email);
    expect(updated.child_name).toBe(order.child_name);
  });
});
