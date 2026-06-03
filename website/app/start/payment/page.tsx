import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getDraft } from '@/lib/draft-fetch';
import { Body } from '@/components/ui/Body';
import { Heading } from '@/components/ui/Heading';
import { calculatePrice, formatPrice } from '@/lib/pricing';
import { checkDraftCompleteness } from '@/lib/checkout/draft-complete';
import { createCheckoutSession } from '@/app/start/_actions/create-checkout-session';
import { PayButton } from './PayButton';

/**
 * Step 6 — payment.
 *
 * Renders the order summary + the Stripe Checkout button. The actual
 * checkout session is created by the Server Action on submit; this
 * page is read-only on the way in.
 *
 * Two guards:
 *   1. If the draft lookup fails (cookie missing / stale), bounce to
 *      /start/reset so the proxy mints a fresh cookie + draft pair.
 *   2. If the draft is missing required fields the customer must have
 *      skipped past somehow, redirect back to /start/review with the
 *      missing-fields list visible there. Phase 2.C's per-step
 *      validation should prevent this in normal flow.
 */
export default async function PaymentStepPage() {
  const result = await getDraft();
  if (result.kind !== 'found') {
    redirect('/start/reset');
  }
  const draft = result.draft;

  const { complete, missing } = checkDraftCompleteness(draft);
  if (!complete) {
    // Defence-in-depth: the per-step Server Actions never let an
    // incomplete draft reach /start/payment in normal flow. If we're
    // here, something jumped the line — send them back to review so
    // they can see and fix what's missing.
    return (
      <div className="space-y-lg text-center">
        <Heading level="2" italic className="not-italic">
          Let&apos;s finish the details first
        </Heading>
        <Body className="text-warm-grey">
          We need a few more things before checkout — head back to the review page and you&apos;ll
          see what&apos;s left.
        </Body>
        <Body size="caption" className="text-warm-grey">
          Missing: {missing.join(', ')}.
        </Body>
        <div className="pt-md">
          <Link
            href="/start/review"
            className="font-body text-iron-oxide text-body hover:underline"
          >
            ← Back to review
          </Link>
        </div>
      </div>
    );
  }

  const secondaries = Array.isArray(draft.secondaries)
    ? (draft.secondaries as Array<{ extra_care?: boolean }>).map((s) => ({
        extra_care: s.extra_care === true,
      }))
    : [];
  const price = calculatePrice({ secondaries });

  // Both have been guarded above.
  const childName = draft.child_name as string;
  const theme = draft.theme as string;

  return (
    <div className="space-y-xl">
      <div className="space-y-sm text-center">
        <Body size="caption" className="text-warm-grey tracking-wider uppercase">
          Almost there
        </Body>
        <Heading level="1" italic className="text-near-black">
          A book for {childName}
        </Heading>
      </div>

      <div className="border-warm-grey-light bg-cream-deep p-lg space-y-md rounded-lg border">
        <Body className="text-near-black whitespace-pre-wrap">
          {theme.length > 200 ? `${theme.slice(0, 200)}…` : theme}
        </Body>

        <hr className="border-warm-grey-light" />

        <ul className="space-y-sm">
          {price.line_items.map((item) => (
            <li key={item.label} className="text-body flex items-center justify-between">
              <span className="text-near-black">{item.label}</span>
              <span className="text-near-black tabular-nums">{formatPrice(item.cents)}</span>
            </li>
          ))}
        </ul>

        <div className="border-warm-grey-light pt-md flex items-center justify-between border-t">
          <span className="font-body text-near-black text-body font-medium">Total</span>
          <span className="font-heading text-iron-oxide text-h2 tabular-nums">
            {formatPrice(price.total)}
          </span>
        </div>
      </div>

      <form action={createCheckoutSession} className="flex justify-center">
        <PayButton label={`Pay ${formatPrice(price.total)}`} />
      </form>

      <Body size="caption" className="text-warm-grey text-center">
        Secure payment via Stripe. We charge once. You&apos;ll see your book before we print it.
      </Body>
    </div>
  );
}
