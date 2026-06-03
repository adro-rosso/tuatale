import type { ReactNode } from 'react';
import { Wordmark } from '@/components/Wordmark';
import { Container } from '@/components/ui/Container';
import { ProgressIndicator } from './ProgressIndicator';
import { StepHeader } from './StepHeader';
import { WizardNav } from './WizardNav';

/**
 * Visual chrome for the wizard. Renders:
 *
 *   ┌──────────────────────────────────────┐
 *   │  [wordmark, sm, top-left]            │
 *   │  ● ─ ─ ─ ─ ─    <- ProgressIndicator │
 *   │  Step 1 of 6                         │
 *   │  About your child   <- StepHeader    │
 *   │                                      │
 *   │  ┌─ children ──────────────┐         │
 *   │  │  per-step page content  │         │
 *   │  └─────────────────────────┘         │
 *   │                                      │
 *   │  [← Back]         [Continue →]       │
 *   └──────────────────────────────────────┘
 *
 * Server Component — no client state of its own. ProgressIndicator,
 * StepHeader, and WizardNav are client components that each read the
 * current segment via useSelectedLayoutSegment, so the chrome stays in
 * sync with the URL without prop threading.
 */
export function WizardLayout({ children }: { children: ReactNode }) {
  return (
    <main className="bg-cream flex min-h-screen flex-col">
      <div className="px-lg py-md">
        <Wordmark size="sm" />
      </div>
      <ProgressIndicator />
      <StepHeader />
      <section className="flex-1">
        <Container className="py-xl">{children}</Container>
      </section>
      <WizardNav />
    </main>
  );
}
