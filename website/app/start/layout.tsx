import type { ReactNode } from 'react';
import { WizardLayout } from '@/components/wizard/WizardLayout';
import { getDraft } from '@/lib/draft-fetch';

/**
 * Layout for the /start/* route group.
 *
 * Fetches the current draft via React.cache (dedupes across components
 * that ask for it in the same render — currently StepHeader and
 * PricePanel both need fields from it).
 *
 * The proxy ensures a draft exists before this layout renders, so
 * `getDraft()` should always return kind:'found' on the happy path.
 * For the rare race window (proxy threw, cookie cleared between
 * requests, etc.), we render the wizard chrome with neutral fallbacks
 * — the layout will look fine; only personalised copy + live price
 * will be at their defaults. The customer can recover by visiting
 * /start/reset.
 */
export default async function StartLayout({ children }: { children: ReactNode }) {
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

  return (
    <WizardLayout
      childName={draft?.child_name ?? null}
      secondariesForPricing={secondariesForPricing}
    >
      {children}
    </WizardLayout>
  );
}
