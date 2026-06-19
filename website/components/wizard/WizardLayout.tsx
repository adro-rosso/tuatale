import type { ReactNode } from 'react';
import { Wordmark } from '@/components/Wordmark';
import { Container } from '@/components/ui/Container';
import { ProgressIndicator } from './ProgressIndicator';
import { StepHeader } from './StepHeader';
import { WizardNav } from './WizardNav';
import { PricePanel } from './PricePanel';

interface WizardLayoutProps {
  children: ReactNode;
  // Both come from the parent layout's getDraft() call. Null until the
  // customer has typed a name (step 1) and started recording state.
  childName: string | null;
  secondariesForPricing: ReadonlyArray<{ extra_care?: boolean }>;
}

/**
 * Visual chrome for the wizard.
 *
 * Two-column on desktop (main content + sticky price sidebar). Single
 * column on mobile / tablet: header → progress → step header → form →
 * price panel → nav. Layout intentionally renders the price panel
 * BELOW the form on mobile so customers see the form first, price
 * second.
 */
export function WizardLayout({ children, childName, secondariesForPricing }: WizardLayoutProps) {
  return (
    <main className="bg-cream flex min-h-screen flex-col">
      <header className="border-warm-grey-light bg-cream/95 sticky top-0 z-30 border-b backdrop-blur-sm">
        <div className="px-lg py-sm flex items-center">
          <Wordmark size="sm" />
        </div>
      </header>
      <ProgressIndicator />
      <StepHeader childName={childName} />

      <section className="flex-1">
        <Container className="py-xl">
          <div className="gap-lg desktop:grid-cols-[1fr_280px] grid grid-cols-1">
            <div>{children}</div>
            <div className="desktop:sticky desktop:top-lg desktop:self-start">
              <PricePanel secondaries={secondariesForPricing} />
            </div>
          </div>
        </Container>
      </section>

      <WizardNav />
    </main>
  );
}
