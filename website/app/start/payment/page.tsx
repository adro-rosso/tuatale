import { Body } from '@/components/ui/Body';

/**
 * Step 6 — payment. Placeholder. Phase 2.E wires Stripe Checkout from
 * here. Note the layout's WizardNav hides the "Continue" button on
 * this route (nextStep('payment') === null), so the customer sees only
 * "← Back" until checkout lands.
 */
export default function PaymentStepPage() {
  return (
    <div className="text-center">
      <Body>
        This is where you’ll pay for the book. Stripe Checkout opens in Phase 2.E — for now, this
        step is a placeholder.
      </Body>
    </div>
  );
}
