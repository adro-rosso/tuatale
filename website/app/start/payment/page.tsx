import { getDraft } from '@/lib/draft-fetch';
import { Body } from '@/components/ui/Body';
import { Heading } from '@/components/ui/Heading';
import { calculatePrice, formatPrice } from '@/lib/pricing';

/**
 * Step 6 — payment. Placeholder for Phase 2.E, which wires Stripe
 * Checkout. For Phase 2.C the page shows the final price prominently
 * and a "checkout coming soon" message; the layout's WizardNav still
 * provides ← Back so customers can return to review.
 */
export default async function PaymentStepPage() {
  const result = await getDraft();
  const draft = result.kind === 'found' ? result.draft : null;

  const secondaries = Array.isArray(draft?.secondaries)
    ? (draft.secondaries as Array<{ extra_care?: boolean }>).map((s) => ({
        extra_care: s.extra_care === true,
      }))
    : [];

  const price = calculatePrice({ secondaries });

  return (
    <div className="space-y-xl text-center">
      <div className="space-y-sm">
        <Body size="caption" className="tracking-wider uppercase">
          Your book — total
        </Body>
        <Heading level="1" italic className="text-iron-oxide tabular-nums">
          {formatPrice(price.total)}
        </Heading>
        <Body size="caption">
          {price.secondaries_count === 0
            ? 'One main character.'
            : `One main character plus ${price.secondaries_count} ${
                price.secondaries_count === 1 ? 'companion' : 'companions'
              }.`}
          {price.extra_care_count > 0 && ` ${price.extra_care_count} rendered with extra care.`}
        </Body>
      </div>

      <div className="border-warm-grey-light bg-cream p-lg rounded-lg border">
        <Body className="text-warm-grey">
          Stripe Checkout opens here in the next phase. We charge once, and you&apos;ll have already
          seen your book before printing — no surprises.
        </Body>
      </div>
    </div>
  );
}
