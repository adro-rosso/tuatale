/**
 * Seeds a fully-populated draft into tuatale-test that's ready for
 * payment (every field the orders snapshot will need, plus a
 * representative secondary). Bypasses the wizard UI entirely — the
 * full-funnel e2e is about the payment-to-shipped chain, not the
 * form-filling, which Phase 2.B/C already cover.
 *
 * Returns the draft id + cookie id + customer-facing fields the
 * e2e test will assert against later.
 */
import { randomUUID } from 'node:crypto';
import { createTestClient } from '../../db/helpers';
import { calculatePrice } from '@/lib/pricing';
import type { Json, TablesInsert } from '@/types/database';

export interface DraftFixtureInput {
  customerEmail?: string;
  childName?: string;
}

export interface DraftFixture {
  draftId: string;
  cookieId: string;
  customerEmail: string;
  childName: string;
  estimatedPriceCents: number;
}

interface SecondaryFixture {
  name: string;
  subject_type: 'human' | 'non_human';
  gender?: 'boy' | 'girl' | 'non_binary';
  relationship: string;
  appearance: string;
  extra_care: boolean;
}

const fixtureSecondary: SecondaryFixture = {
  name: 'Mochi',
  subject_type: 'non_human',
  relationship: 'family pet',
  appearance:
    'A small calico cat with a white chest and orange-and-black patches. Round amber eyes. Often sits perched on the windowsill.',
  extra_care: false,
};

export async function createCompletedDraft(
  input: DraftFixtureInput = {},
): Promise<DraftFixture> {
  const customerEmail = input.customerEmail ?? 'e2e-test@tuatale.test';
  const childName = input.childName ?? 'Iris';
  const cookieId = randomUUID();

  // Use the same pricing primitive the customer-facing wizard uses so
  // the order's amount_paid_cents stays consistent with what the
  // calculator would have shown the customer.
  const price = calculatePrice({ secondaries: [fixtureSecondary] });

  const payload: TablesInsert<'drafts'> = {
    cookie_id: cookieId,
    customer_email: customerEmail,
    child_name: childName,
    age_range: '5-7',
    child_gender: 'girl',
    child_appearance:
      'Curly brown hair just past her shoulders, brown eyes, a small gap between her two front teeth, often wearing a yellow raincoat.',
    secondaries: [fixtureSecondary] as unknown as Json,
    theme:
      'Iris finds a tiny door at the back of the garden shed. Mochi noticed it first. Together they figure out who lives behind it.',
    theme_template_id: 'adventure_hidden_world',
    estimated_price_cents: price.total,
    current_step: 'review',
    status: 'active',
  };

  const client = createTestClient();
  const { data, error } = await client
    .from('drafts')
    .insert(payload)
    .select()
    .single();
  if (error) throw new Error(`draft-fixture.createCompletedDraft: ${error.message}`);

  return {
    draftId: data.id,
    cookieId,
    customerEmail,
    childName,
    estimatedPriceCents: price.total,
  };
}
