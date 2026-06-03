import { getOrderByStripeSessionId } from '@/db/orders';
import { Body } from '@/components/ui/Body';
import { Heading } from '@/components/ui/Heading';
import { formatPrice } from '@/lib/pricing';

/**
 * Post-payment landing page.
 *
 * Stripe redirects the customer here from Checkout with
 * `?session_id={CHECKOUT_SESSION_ID}` in the URL. The order isn't
 * guaranteed to exist yet — the redirect and the webhook fire
 * independently, and on a fast browser the customer can arrive
 * before our webhook has finished creating the row. We poll for
 * the order via meta refresh:
 *
 *   - Tick every 2 seconds for up to 15 attempts (30s total)
 *   - On each tick we re-render server-side, re-reading the orders
 *     table via session_id
 *   - When the order appears we render the confirmation
 *   - After 15 ticks with no order we surface a "something's taking
 *     longer than expected" panel — Stripe has the payment, so the
 *     customer's money is safe; an email to hello@tuatale.com can
 *     manually reconcile.
 *
 * Meta refresh (vs. a client polling hook) keeps this page a pure
 * Server Component with no JS — works for screen readers, low-end
 * devices, and customers with aggressive ad blockers.
 *
 * The proxy skips this route so it doesn't mint a new cookie + draft
 * pair every refresh. See proxy.ts.
 */

const POLL_INTERVAL_SECONDS = 2;
const MAX_ATTEMPTS = 15;

export default async function SuccessStepPage({
  searchParams,
}: {
  searchParams: Promise<{ session_id?: string; attempt?: string }>;
}) {
  const { session_id, attempt } = await searchParams;
  const attemptNum = Number.parseInt(attempt ?? '0', 10) || 0;

  if (!session_id) {
    return <MissingSessionState />;
  }

  const order = await getOrderByStripeSessionId(session_id);

  if (!order) {
    if (attemptNum >= MAX_ATTEMPTS) {
      return <TookTooLongState sessionId={session_id} />;
    }
    return <ProcessingState sessionId={session_id} nextAttempt={attemptNum + 1} />;
  }

  return <ConfirmationState order={order} />;
}

function ConfirmationState({
  order,
}: {
  order: {
    id: string;
    child_name: string;
    customer_email: string;
    theme: string;
    amount_paid_cents: number;
    currency: string;
  };
}) {
  const themeExcerpt = order.theme.length > 100 ? `${order.theme.slice(0, 100)}…` : order.theme;
  // First eight characters of the UUID — enough for a customer to
  // quote in a support email without leaking the whole id.
  const shortId = order.id.slice(0, 8);

  return (
    <div className="space-y-xl text-center">
      <div className="space-y-md">
        <Heading level="1" italic className="text-near-black">
          {order.child_name}&apos;s book is being made.
        </Heading>
        <Body className="text-warm-grey">
          We&apos;ve received your order. We&apos;re writing the story now — we&apos;ll email you at{' '}
          <span className="text-near-black">{order.customer_email}</span> when it&apos;s ready to
          see. This usually takes 3-5 days.
        </Body>
      </div>

      <div className="border-warm-grey-light bg-cream-deep p-lg space-y-sm rounded-lg border text-left">
        <div className="flex items-baseline justify-between">
          <span className="font-body text-warm-grey text-caption tracking-wider uppercase">
            For
          </span>
          <span className="font-body text-near-black text-body">{order.child_name}</span>
        </div>
        <div className="gap-md flex items-baseline justify-between">
          <span className="font-body text-warm-grey text-caption shrink-0 tracking-wider uppercase">
            Story
          </span>
          <span className="font-body text-near-black text-body text-right">{themeExcerpt}</span>
        </div>
        <div className="flex items-baseline justify-between">
          <span className="font-body text-warm-grey text-caption tracking-wider uppercase">
            Paid
          </span>
          <span className="font-body text-near-black text-body tabular-nums">
            {formatPrice(order.amount_paid_cents, order.currency as 'aud')}
          </span>
        </div>
        <div className="flex items-baseline justify-between">
          <span className="font-body text-warm-grey text-caption tracking-wider uppercase">
            Reference
          </span>
          <span className="font-body text-near-black text-body font-mono tabular-nums">
            {shortId}
          </span>
        </div>
      </div>

      <Body size="caption" className="text-warm-grey">
        Questions? Reply to your confirmation email or write to{' '}
        <a href="mailto:hello@tuatale.com" className="text-iron-oxide hover:underline">
          hello@tuatale.com
        </a>
        .
      </Body>
    </div>
  );
}

function ProcessingState({ sessionId, nextAttempt }: { sessionId: string; nextAttempt: number }) {
  // Server-rendered meta refresh — no JS, no client component. The
  // URL increments `attempt` so the page tracks how long it's been
  // polling without state.
  const url = `/start/success?session_id=${encodeURIComponent(sessionId)}&attempt=${nextAttempt}`;
  return (
    <>
      <meta httpEquiv="refresh" content={`${POLL_INTERVAL_SECONDS};url=${url}`} />
      <div className="space-y-md text-center">
        <Heading level="2" italic className="not-italic">
          Just a moment…
        </Heading>
        <Body className="text-warm-grey">
          We&apos;re finalising the details. This page will refresh on its own.
        </Body>
      </div>
    </>
  );
}

function TookTooLongState({ sessionId }: { sessionId: string }) {
  return (
    <div className="space-y-md text-center">
      <Heading level="2" italic className="not-italic">
        That&apos;s taking longer than expected.
      </Heading>
      <Body className="text-warm-grey">
        We&apos;ve received your payment — your money is safe. If you don&apos;t see a confirmation
        email shortly, please write to{' '}
        <a href="mailto:hello@tuatale.com" className="text-iron-oxide hover:underline">
          hello@tuatale.com
        </a>{' '}
        with this reference, and we&apos;ll look into it:
      </Body>
      <p className="text-near-black text-caption font-mono break-all">{sessionId}</p>
    </div>
  );
}

function MissingSessionState() {
  return (
    <div className="space-y-md text-center">
      <Heading level="2" italic className="not-italic">
        Something&apos;s missing.
      </Heading>
      <Body className="text-warm-grey">
        This page expects a checkout session in its URL — looks like you arrived without one. If you
        just paid and ended up here, please email{' '}
        <a href="mailto:hello@tuatale.com" className="text-iron-oxide hover:underline">
          hello@tuatale.com
        </a>{' '}
        and we&apos;ll help.
      </Body>
    </div>
  );
}
