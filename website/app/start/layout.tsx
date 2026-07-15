import type { ReactNode } from 'react';
import { headers } from 'next/headers';
import { Wordmark } from '@/components/Wordmark';
import { Container } from '@/components/ui/Container';
import { WizardLayout } from '@/components/wizard/WizardLayout';
import { getDraft } from '@/lib/draft-fetch';

/**
 * Layout for the /start/* route group.
 *
 * Two render modes:
 *
 *  1. Wizard chrome (default) — for every /start/<step> page that's
 *     part of the form flow. Fetches the draft via React.cache
 *     (dedupes across components that ask for it in the same render)
 *     and renders ProgressIndicator + StepHeader + PricePanel + Back
 *     button around the page content.
 *
 *  2. Bare chrome — for /start/success. The customer's draft has
 *     already been converted to an order; the wizard's progress dots,
 *     price sidebar, and Back button would all be misleading. We
 *     render just the wordmark + the centered content.
 *
 * The proxy stashes the active pathname on the `x-pathname` header so
 * this Server Component can branch without a client-only hook
 * (useSelectedLayoutSegment).
 */
export default async function StartLayout({ children }: { children: ReactNode }) {
  const pathname = (await headers()).get('x-pathname') ?? '';

  if (pathname === '/start/success') {
    return (
      <main className="bg-cream flex min-h-screen flex-col">
        <div className="px-lg py-md">
          <Wordmark size="sm" />
        </div>
        <section className="flex-1">
          <Container className="py-xl">{children}</Container>
        </section>
      </main>
    );
  }

  const result = await getDraft();
  const draft = result.kind === 'found' ? result.draft : null;

  // jsonb columns come back as `unknown`/`Json` from the generated
  // types. The secondaries we PUT in are always an array of
  // {name, ..., extra_care?: boolean}; the slice we need for pricing
  // is just the boolean flag per element.
  const secondariesForPricing = Array.isArray(draft?.secondaries)
    ? (draft.secondaries as Array<{ extra_care?: boolean }>).map((s) => ({
        extra_care: s.extra_care === true,
      }))
    : [];

  const bookType = (draft as { book_type?: string | null } | null)?.book_type ?? 'child';

  return (
    <WizardLayout
      childName={draft?.child_name ?? null}
      bookType={bookType}
      secondariesForPricing={secondariesForPricing}
    >
      {children}
    </WizardLayout>
  );
}
