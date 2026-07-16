import type { ReactNode } from 'react';
import { SiteHeader } from '@/components/SiteHeader';
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
  bookType: string;
  secondariesForPricing: ReadonlyArray<{ extra_care?: boolean }>;
  /** Whether to show the price sidebar. Off on the payment step, which renders
   *  its own full order summary (so the price isn't shown twice). */
  showPrice?: boolean;
}

/**
 * Visual chrome for the wizard.
 *
 * Two-column on desktop (main content + sticky price sidebar), vertically
 * centred so sparse steps fill the frame instead of floating at the top.
 * Single column on mobile / tablet, where the price panel is ordered ABOVE
 * the form so it never lands beneath a step's own Continue button (the
 * per-step Continue lives at the foot of each form).
 */
export function WizardLayout({
  children,
  childName,
  bookType,
  secondariesForPricing,
  showPrice = true,
}: WizardLayoutProps) {
  return (
    <main className="bg-cream flex min-h-screen flex-col">
      <SiteHeader />
      <ProgressIndicator />
      <StepHeader childName={childName} bookType={bookType} />

      <section className="desktop:justify-center flex flex-1 flex-col">
        <Container className="py-xl tablet:py-2xl">
          {showPrice ? (
            <div className="gap-lg desktop:grid-cols-[1fr_300px] desktop:items-start grid grid-cols-1">
              <div className="order-2 desktop:order-1">{children}</div>
              <div className="order-1 desktop:order-2 desktop:sticky desktop:top-lg desktop:self-start">
                <PricePanel secondaries={secondariesForPricing} />
              </div>
            </div>
          ) : (
            children
          )}
        </Container>
      </section>

      <WizardNav />
    </main>
  );
}
