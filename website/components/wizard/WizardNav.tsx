'use client';

import { useSelectedLayoutSegment } from 'next/navigation';
import { isWizardStep, previousStep } from '@/lib/wizard-steps';
import { goBack } from '@/app/start/_actions/navigation';
import { Button } from '@/components/ui/Button';

/**
 * Back button row pinned to the bottom of the wizard layout.
 *
 * Phase 2.B had a generic "Continue →" button here that called
 * advanceStep. Phase 2.C moved Continue ownership into each step page
 * (each form has its own submit button that validates THAT step's
 * data before advancing). So WizardNav now renders only Back.
 *
 * - First step (/start/child): no Back button.
 * - All other steps: Back button visible.
 */
export function WizardNav() {
  const segment = useSelectedLayoutSegment();
  if (!segment || !isWizardStep(segment)) return null;

  const canBack = previousStep(segment) !== null;
  if (!canBack) return null;
  const back = goBack.bind(null, segment);

  return (
    <footer className="border-warm-grey-light bg-cream border-t">
      <div className="px-lg py-lg mx-auto flex max-w-[720px] items-center justify-start">
        <form action={back}>
          <Button variant="ghost" type="submit">
            ← Back
          </Button>
        </form>
      </div>
    </footer>
  );
}
